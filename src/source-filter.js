/**
 * Optional "filter before translation" mode. Translators (LLM Translator,
 * Interpres, built-in Translate) read `message.mes` directly, so the only way
 * they see filtered text is to filter the stored message itself.
 *
 * The unfiltered text is kept next to it so it can be restored. SillyTavern
 * keeps a separate `extra` per swipe (in `swipe_info[i].extra`) and swaps it
 * into `message.extra` when swiping, so the record is written to both.
 */

export const SOURCE_KEY = 'stf_original';

export function hashText(value) {
    const text = String(value ?? '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function activeSwipe(message) {
    const id = Number(message?.swipe_id);
    return Array.isArray(message?.swipes) && Number.isInteger(id) && id >= 0 && id < message.swipes.length ? id : null;
}

function swipeExtra(message, index, create = false) {
    const info = Array.isArray(message.swipe_info) ? message.swipe_info[index] : null;
    if (!info || typeof info !== 'object') return null;
    if (!info.extra || typeof info.extra !== 'object') {
        if (!create) return null;
        info.extra = {};
    }
    return info.extra;
}

/**
 * The record for the shown text: the one in message.extra or in the active
 * swipe's swipe_info, whichever still matches the text exactly.
 */
function findRecord(message, index, text) {
    const hash = hashText(text);
    const candidates = [index === activeSwipe(message) ? message.extra?.[SOURCE_KEY] : null];
    if (index !== null) candidates.push(swipeExtra(message, index)?.[SOURCE_KEY]);
    return candidates.find(record => record && record.filtered === hash) ?? null;
}

function hasAnyRecord(message, index) {
    return Boolean((index === activeSwipe(message) && message.extra?.[SOURCE_KEY])
        || (index !== null && swipeExtra(message, index)?.[SOURCE_KEY]));
}

function writeRecord(message, record) {
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    message.extra[SOURCE_KEY] = record;
    const swipe = activeSwipe(message);
    if (swipe !== null) {
        const extra = swipeExtra(message, swipe, true);
        if (extra) extra[SOURCE_KEY] = record;
    }
}

function clearRecord(extra) {
    if (extra && Object.prototype.hasOwnProperty.call(extra, SOURCE_KEY)) delete extra[SOURCE_KEY];
}

function setText(message, text) {
    message.mes = text;
    const swipe = activeSwipe(message);
    if (swipe !== null) message.swipes[swipe] = text;
}

/**
 * Filters the shown variant of a message in place. Returns true if the text
 * changed. Running it again (same event twice, or after rules change) starts
 * from the stored original, so deletions never compound.
 */
export function applyToSource(message, engine, { includeCode = false } = {}) {
    if (!message || typeof message.mes !== 'string') return false;
    const current = message.mes;
    const swipe = activeSwipe(message);
    // A record only counts while the text is still exactly what we wrote.
    // After a user edit, the edited text is the new original.
    const record = findRecord(message, swipe, current);
    const original = record ? String(record.original) : current;

    const filtered = engine.applyMarkup(original, { includeCode }).text;
    if (filtered === original) {
        if (hasAnyRecord(message, swipe)) {
            clearRecord(message.extra);
            if (swipe !== null) clearRecord(swipeExtra(message, swipe));
        }
        if (current !== original) setText(message, original);
        return current !== original;
    }

    writeRecord(message, { original, filtered: hashText(filtered) });
    if (current !== filtered) setText(message, filtered);
    return current !== filtered;
}

/** Puts back every original this extension stored for a message. */
export function restoreSource(message) {
    const result = { restored: 0, conflicts: 0, changed: false };
    if (!message || typeof message !== 'object') return result;

    const active = activeSwipe(message);
    if (Array.isArray(message.swipes) && message.swipes.length) {
        message.swipes.forEach((text, index) => {
            const extra = swipeExtra(message, index);
            const record = findRecord(message, index, text);
            if (!record) {
                if (hasAnyRecord(message, index)) result.conflicts += 1;
                return;
            }
            message.swipes[index] = String(record.original);
            if (index === active) {
                message.mes = message.swipes[index];
                clearRecord(message.extra);
            }
            clearRecord(extra);
            result.restored += 1;
            result.changed = true;
        });
        return result;
    }

    const record = message.extra?.[SOURCE_KEY];
    if (!record) return result;
    if (record.filtered !== hashText(message.mes)) {
        result.conflicts += 1;
        return result;
    }
    message.mes = String(record.original);
    clearRecord(message.extra);
    result.restored = 1;
    result.changed = true;
    return result;
}
