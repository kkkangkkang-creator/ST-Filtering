/**
 * Filters text that is already rendered on screen, including translations
 * that other extensions draw into the message (LLM Translator, Interpres and
 * SillyTavern's own Translate all render through `.mes_text`).
 *
 * Only `Text.nodeValue` is changed. No element is added, removed or
 * re-rendered, so other extensions' MutationObservers (which watch childList
 * and attributes) are not triggered, and HTML attributes can never be broken.
 */

// Never touched: editors, scripts, frames and Tavern Helper (JS-Slash-Runner)
// renders, whose source text must stay intact.
const ALWAYS_SKIP = [
    'script', 'style', 'textarea', 'input', 'select', 'option', 'iframe', 'noscript', 'svg', 'math',
    '[contenteditable=""]', '[contenteditable="true"]', '.TH-render', '.stf-skip',
].join(',');
const CODE_SKIP = 'pre,code';

// Text never matches across these. `.translated_text` / `.original_text` are
// LLM Translator's spans, which sit side by side inside one paragraph.
const BOUNDARY = [
    'p', 'div', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'details', 'summary', 'section', 'article', 'aside',
    'header', 'footer', 'figure', 'figcaption', 'hr', 'pre', 'code', '.translated_text', '.original_text',
].join(',');

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Splits a root element into runs of text nodes that read as one continuous
 * string. A phrase such as "very <em>much</em>" is matched across nodes, but
 * never across a paragraph, a <br>, or a skipped element.
 */
export function collectTextRuns(root, { includeCode = false } = {}) {
    const skip = includeCode ? ALWAYS_SKIP : `${ALWAYS_SKIP},${CODE_SKIP}`;
    const runs = [];
    let current = [];
    let currentKey = null;

    const flush = () => {
        if (current.length) runs.push(current);
        current = [];
        currentKey = null;
    };
    const boundaryOf = node => {
        for (let element = node.parentElement; element && element !== root; element = element.parentElement) {
            if (element.matches(BOUNDARY)) return element;
        }
        return root;
    };
    const visit = parent => {
        for (let child = parent.firstChild; child; child = child.nextSibling) {
            if (child.nodeType === TEXT_NODE) {
                const key = boundaryOf(child);
                if (key !== currentKey) {
                    flush();
                    currentKey = key;
                }
                current.push(child);
            } else if (child.nodeType === ELEMENT_NODE) {
                if (child.tagName === 'BR' || child.matches(skip)) {
                    flush();
                    continue;
                }
                visit(child);
            }
        }
    };

    visit(root);
    flush();
    return runs;
}

/**
 * Maps matches found in the joined text of a run back onto its nodes. A
 * replacement goes into the node where its match starts; the rest of the
 * match is removed from the following nodes.
 */
export function distributeMatches(sources, matches) {
    const outputs = [];
    let offset = 0;
    let index = 0;
    for (const source of sources) {
        const start = offset;
        const end = offset + source.length;
        let output = '';
        let position = start;
        while (position < end) {
            while (index < matches.length && matches[index].end <= position) index += 1;
            const match = matches[index];
            if (!match || match.start >= end) {
                output += source.slice(position - start);
                break;
            }
            if (match.start > position) {
                output += source.slice(position - start, match.start - start);
                position = match.start;
            }
            if (match.start === position) output += match.replacement;
            position = Math.min(match.end, end);
        }
        outputs.push(output);
        offset = end;
    }
    return outputs;
}

export class DomFilter {
    constructor() {
        /** @type {WeakMap<Text, { input: string, output: string }>} */
        this.records = new WeakMap();
    }

    /** The unfiltered text of a node, even if this filter already changed it. */
    sourceOf(node) {
        const record = this.records.get(node);
        return record && node.nodeValue === record.output ? record.input : node.nodeValue;
    }

    /**
     * Filters one root. Re-running it is safe: every pass starts from the
     * original text, so a rule whose output matches itself cannot grow the
     * text, and a pass with unchanged rules writes nothing.
     */
    filterRoot(root, engine, { includeCode = false } = {}) {
        let count = 0;
        for (const run of collectTextRuns(root, { includeCode })) {
            const sources = run.map(node => this.sourceOf(node));
            const matches = engine.matchText(sources.join(''));
            count += matches.length;
            const outputs = matches.length ? distributeMatches(sources, matches) : sources;
            run.forEach((node, i) => this.write(node, sources[i], outputs[i]));
        }
        return count;
    }

    write(node, input, output) {
        if (output === input) {
            if (this.records.has(node)) {
                if (node.nodeValue !== input) node.nodeValue = input;
                this.records.delete(node);
            }
            return;
        }
        this.records.set(node, { input, output });
        if (node.nodeValue !== output) node.nodeValue = output;
    }

    /** Puts back the original text of every node this filter changed under root. */
    restore(root) {
        const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const record = this.records.get(node);
            if (!record) continue;
            if (node.nodeValue === record.output) node.nodeValue = record.input;
            this.records.delete(node);
        }
    }
}
