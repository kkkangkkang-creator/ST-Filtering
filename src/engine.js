/**
 * Rule engine. Pure functions only (no DOM, no SillyTavern), so it can be
 * shared by the display filter and the prompt interceptor and tested in Node.
 *
 * Rule shape: { id, find, replace, mode: 'auto' | 'text' | 'word' | 'regex', enabled }
 */

export const RULE_MODES = Object.freeze(['auto', 'text', 'word', 'regex']);

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const ASCII_ONLY = /^[\x20-\x7E]+$/u;
const NOT_AFTER_WORD = '(?<![\\p{L}\\p{N}_])';
const NOT_BEFORE_WORD = '(?![\\p{L}\\p{N}_])';
// Characters that should not be preceded by a space once the word before them is deleted.
const CLOSING_PUNCTUATION = /[,.!?;:…)\]}」』”’]/u;

export function escapeRegex(value) {
    // `/` is escaped too so patterns survive `/pattern/flags` notation.
    return String(value).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function resolveMode(rule) {
    const mode = RULE_MODES.includes(rule?.mode) ? rule.mode : 'auto';
    if (mode !== 'auto') return mode;
    // ASCII terms ("very", "don't") get word boundaries so "rhythmic" leaves
    // "rhythmically" alone. Everything else (Hangul, kana, symbols) is a plain
    // substring, so "그녀" also matches "그녀는".
    return ASCII_ONLY.test(String(rule?.find ?? '')) ? 'word' : 'text';
}

export function buildPattern(rule) {
    const find = String(rule?.find ?? '');
    if (!find) return '';
    const mode = resolveMode(rule);
    if (mode === 'regex') return find;

    const escaped = escapeRegex(find);
    if (mode === 'text') return escaped;
    // Boundaries only apply to ends that are word characters, so "e.g." or
    // "...hmm" still work in word mode.
    const head = WORD_CHAR.test(find[0]) ? NOT_AFTER_WORD : '';
    const tail = WORD_CHAR.test(find[find.length - 1]) ? NOT_BEFORE_WORD : '';
    return `${head}${escaped}${tail}`;
}

export function compileRules(rules, { caseSensitive = false } = {}) {
    const compiled = [];
    const invalid = [];
    for (const rule of Array.isArray(rules) ? rules : []) {
        if (!rule || rule.enabled === false || !String(rule.find ?? '')) continue;
        const pattern = buildPattern(rule);
        try {
            compiled.push({
                rule,
                regex: new RegExp(pattern, caseSensitive ? 'gu' : 'giu'),
                literal: resolveMode(rule) !== 'regex',
                replace: String(rule.replace ?? ''),
            });
        } catch (error) {
            invalid.push({ rule, error: error.message });
        }
    }
    return { compiled, invalid };
}

/**
 * Expands $&, $1…$99, $<name> and $$ in a regex rule's replacement.
 */
export function expandReplacement(template, match) {
    return String(template).replace(/\$(\$|&|<([^>]+)>|(\d{1,2}))/g, (whole, token, name, digits) => {
        if (token === '$') return '$';
        if (token === '&') return match[0];
        if (name !== undefined) return match.groups?.[name] ?? '';
        const index = Number(digits);
        if (index > 0 && index < match.length) return match[index] ?? '';
        return whole;
    });
}

function nextMatch(entry, text, from) {
    const { regex } = entry;
    regex.lastIndex = from;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match[0].length > 0) return match;
        // Skip empty matches (e.g. a user regex like `a*`).
        regex.lastIndex = match.index + 1;
    }
    return null;
}

/**
 * Finds non-overlapping matches in one left-to-right pass over all rules.
 * At the same position the longer match wins, then the earlier rule. The
 * output of one rule is never fed to another rule, so rules cannot chain.
 */
export function findMatches(text, compiled) {
    const source = String(text ?? '');
    const matches = [];
    if (!source || !compiled?.length) return matches;

    const states = compiled.map(entry => ({ entry, match: nextMatch(entry, source, 0) }));
    let cursor = 0;
    for (;;) {
        let best = null;
        for (const state of states) {
            if (state.match && state.match.index < cursor) state.match = nextMatch(state.entry, source, cursor);
            const match = state.match;
            if (!match) continue;
            if (!best
                || match.index < best.match.index
                || (match.index === best.match.index && match[0].length > best.match[0].length)) {
                best = state;
            }
        }
        if (!best) break;

        const { entry, match } = best;
        matches.push({
            start: match.index,
            end: match.index + match[0].length,
            replacement: entry.literal ? entry.replace : expandReplacement(entry.replace, match),
            rule: entry.rule,
        });
        cursor = match.index + match[0].length;
    }
    return matches;
}

/**
 * Widens deletions so they do not leave double spaces or a space before
 * punctuation: "it very much." minus "very much" becomes "it." rather than
 * "it  ." Only the seams of deletions are touched.
 */
export function tidyDeletionSeams(text, matches) {
    const source = String(text ?? '');
    const result = matches.map(match => ({ ...match }));
    for (let index = 0; index < result.length; index += 1) {
        const match = result[index];
        if (match.replacement !== '') continue;
        const previousEnd = index > 0 ? result[index - 1].end : 0;
        const nextStart = index + 1 < result.length ? result[index + 1].start : source.length;
        const before = source[match.start - 1];
        const after = source[match.end];
        const lineStart = match.start === 0 || before === '\n';

        if ((before === ' ' || lineStart) && after === ' ' && match.end + 1 <= nextStart) {
            match.end += 1;
        } else if (before === ' ' && match.start - 1 >= previousEnd
            && (after === undefined || after === '\n' || CLOSING_PUNCTUATION.test(after))) {
            match.start -= 1;
        }
    }
    return result;
}

export function applyMatches(text, matches) {
    const source = String(text ?? '');
    if (!matches.length) return source;
    let output = '';
    let cursor = 0;
    for (const match of matches) {
        output += source.slice(cursor, match.start) + match.replacement;
        cursor = match.end;
    }
    return output + source.slice(cursor);
}

// Always protected in raw prompt text: HTML comments, <style>/<script> blocks
// and tags (so attributes are never edited). Code is protected unless
// includeCode is on.
const MARKUP = String.raw`<!--[\s\S]*?(?:-->|$)|<(style|script)\b[\s\S]*?<\/\1\s*>|<\/?[A-Za-z][^<>]*>`;
const CODE = String.raw`\x60\x60\x60[\s\S]*?(?:\x60\x60\x60|$)|~~~[\s\S]*?(?:~~~|$)|\x60[^\x60\n]+\x60`;
const PROTECT_ALL = new RegExp(`${CODE}|${MARKUP}`, 'giu');
const PROTECT_MARKUP = new RegExp(MARKUP, 'giu');

export function splitProtected(text, { includeCode = false } = {}) {
    const source = String(text ?? '');
    const regex = includeCode ? PROTECT_MARKUP : PROTECT_ALL;
    const segments = [];
    let cursor = 0;
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source)) !== null) {
        if (!match[0]) {
            regex.lastIndex += 1;
            continue;
        }
        if (match.index > cursor) segments.push({ text: source.slice(cursor, match.index), protected: false });
        segments.push({ text: match[0], protected: true });
        cursor = match.index + match[0].length;
    }
    if (cursor < source.length) segments.push({ text: source.slice(cursor), protected: false });
    return segments;
}

export function createEngine(settings = {}) {
    const { compiled, invalid } = compileRules(settings.rules, { caseSensitive: Boolean(settings.caseSensitive) });
    const tidy = settings.tidySpaces !== false;

    const matchText = text => {
        const matches = findMatches(text, compiled);
        return tidy ? tidyDeletionSeams(text, matches) : matches;
    };

    return Object.freeze({
        hasRules: compiled.length > 0,
        invalid,
        matchText,
        /** Plain string, no markup awareness (used for rendered DOM text). */
        applyPlain(text) {
            const matches = matchText(text);
            return { text: applyMatches(text, matches), count: matches.length };
        },
        /** Raw message source (Markdown/HTML), used for the outgoing prompt. */
        applyMarkup(text, { includeCode = false } = {}) {
            let count = 0;
            const output = splitProtected(text, { includeCode }).map(segment => {
                if (segment.protected) return segment.text;
                const matches = matchText(segment.text);
                count += matches.length;
                return applyMatches(segment.text, matches);
            }).join('');
            return { text: output, count };
        },
    });
}
