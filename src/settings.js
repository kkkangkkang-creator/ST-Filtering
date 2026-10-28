import { RULE_MODES } from './engine.js';

export const SETTINGS_KEY = 'st-filtering';
export const LEGACY_KEY = 'word-filter';
export const SETTINGS_VERSION = 1;

export function defaultSettings() {
    return {
        version: SETTINGS_VERSION,
        enabled: true,
        applyToDisplay: true,
        applyToPrompt: true,
        includeUser: false,
        includeCode: false,
        caseSensitive: false,
        tidySpaces: true,
        extraSelectors: '',
        rules: [],
        legacyChecked: false,
    };
}

export function createId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeRule(raw) {
    const find = String(raw?.find ?? '');
    if (!find.trim()) return null;
    return {
        id: String(raw?.id || createId()),
        find: raw?.mode === 'regex' ? find : find.trim(),
        replace: String(raw?.replace ?? ''),
        mode: RULE_MODES.includes(raw?.mode) ? raw.mode : 'auto',
        enabled: raw?.enabled !== false,
    };
}

export function normalizeSettings(raw) {
    const base = defaultSettings();
    const source = raw && typeof raw === 'object' ? raw : {};
    for (const key of Object.keys(base)) {
        if (key === 'rules' || key === 'version') continue;
        if (typeof source[key] === typeof base[key]) base[key] = source[key];
    }
    base.rules = (Array.isArray(source.rules) ? source.rules : []).map(normalizeRule).filter(Boolean);
    return base;
}

export function ruleKey(rule, caseSensitive) {
    const find = caseSensitive ? rule.find : rule.find.toLocaleLowerCase();
    return `${rule.mode}\u0000${find}`;
}

/** Adds rules that are not already present. Returns how many were added. */
export function mergeRules(settings, incoming) {
    const existing = new Set(settings.rules.map(rule => ruleKey(rule, settings.caseSensitive)));
    let added = 0;
    for (const raw of incoming) {
        const rule = normalizeRule(raw);
        if (!rule) continue;
        const key = ruleKey(rule, settings.caseSensitive);
        if (existing.has(key)) continue;
        existing.add(key);
        settings.rules.push(rule);
        added += 1;
    }
    return added;
}

/**
 * Converts the old Word Filter settings (any version) into rules. Its
 * replacements ran before its deletions, so they come first here as well.
 */
export function rulesFromLegacy(legacy) {
    if (!legacy || typeof legacy !== 'object') return [];
    const pick = (...keys) => keys.map(key => legacy[key]).find(Array.isArray) ?? [];
    const rules = [];
    for (const item of pick('replaceRules', 'replaceList')) {
        const find = String(item?.from ?? '').trim();
        if (find) rules.push({ find, replace: String(item?.to ?? ''), mode: 'auto' });
    }
    for (const item of pick('deleteRules', 'deleteList')) {
        const find = String(typeof item === 'string' ? item : (item?.text ?? item?.word ?? '')).trim();
        if (find) rules.push({ find, replace: '', mode: 'auto' });
    }
    return rules;
}

/** Accepts this extension's export file, a bare settings object, or a Word Filter backup. */
export function parseImport(json) {
    const parsed = JSON.parse(json);
    if (parsed?.format === 'st-filtering' && parsed.settings) return { kind: 'settings', settings: normalizeSettings(parsed.settings) };
    if (Array.isArray(parsed?.rules)) return { kind: 'settings', settings: normalizeSettings(parsed) };
    const legacy = parsed?.format === 'word-filter-backup' ? parsed.settings : parsed;
    const rules = rulesFromLegacy(legacy);
    if (rules.length) return { kind: 'legacy', rules };
    throw new Error('No ST Filtering or Word Filter rules found');
}

export function exportPayload(settings) {
    return {
        format: 'st-filtering',
        version: SETTINGS_VERSION,
        exportedAt: new Date().toISOString(),
        settings,
    };
}
