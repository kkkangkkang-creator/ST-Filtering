import { createEngine } from './src/engine.js';
import { DomFilter } from './src/dom-filter.js';
import {
    LEGACY_KEY,
    SETTINGS_KEY,
    defaultSettings,
    mergeRules,
    normalizeSettings,
    rulesFromLegacy,
} from './src/settings.js';
import { mountSettingsPanel } from './src/ui.js';

const LOG_PREFIX = '[ST Filtering]';
const BASE_ROOTS = ['.mes_text', '.mes_reasoning'];

let settings = null;
let engine = createEngine();
let observer = null;
let frame = null;
let panel = null;
const dom = new DomFilter();
const pending = new Set();

function getContext() {
    return globalThis.SillyTavern.getContext();
}

function getSettings() {
    if (settings) return settings;
    const context = getContext();
    const stored = context.extensionSettings[SETTINGS_KEY];
    settings = stored ? normalizeSettings(stored) : defaultSettings();
    context.extensionSettings[SETTINGS_KEY] = settings;
    return settings;
}

function saveSettings() {
    getContext().saveSettingsDebounced();
}

function isActive() {
    const current = getSettings();
    return current.enabled && engine.hasRules;
}

// ---------------------------------------------------------------------------
// Display: filter rendered text, including translations drawn by other
// extensions. Driven entirely by a MutationObserver on #chat, so streaming,
// swipes, edits, translation toggles and chat switches are all picked up
// without depending on which event each extension emits.
// ---------------------------------------------------------------------------

function rootSelector() {
    const extra = getSettings().extraSelectors
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    return [...BASE_ROOTS, ...extra].join(',');
}

function findRoots(mes) {
    let candidates;
    try {
        candidates = [...mes.querySelectorAll(rootSelector())];
    } catch {
        // An invalid custom selector must not break the base roots.
        candidates = [...mes.querySelectorAll(BASE_ROOTS.join(','))];
    }
    return candidates.filter(element => !candidates.some(other => other !== element && other.contains(element)));
}

function isFilterableMessage(message) {
    if (!message) return false;
    if (message.is_user) return getSettings().includeUser;
    // SillyTavern's own notices (help, welcome, …) are system messages without
    // swipes. Hidden AI turns are also is_system but keep their swipes.
    if (message.is_system && !Array.isArray(message.swipes)) return false;
    return true;
}

function processMessage(mes) {
    if (!mes.isConnected) return;
    const current = getSettings();
    const message = getContext().chat?.[Number(mes.getAttribute('mesid'))];
    const filter = isActive() && current.applyToDisplay && isFilterableMessage(message);

    for (const root of findRoots(mes)) {
        if (!filter) {
            dom.restore(root);
            continue;
        }
        // "..." is the placeholder of a swipe being generated. Translators
        // look for exactly this text, so leave it alone.
        if (root.textContent.trim() === '...') continue;
        dom.filterRoot(root, engine, { includeCode: current.includeCode });
    }
}

function flush() {
    frame = null;
    const items = [...pending];
    pending.clear();
    for (const mes of items) {
        try {
            processMessage(mes);
        } catch (error) {
            console.error(LOG_PREFIX, 'Failed to filter message', error);
        }
    }
    // Drop the characterData records caused by our own writes.
    observer?.takeRecords();
}

function schedule() {
    if (frame === null && pending.size > 0) frame = requestAnimationFrame(flush);
}

function queueMessagesIn(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches('.mes')) pending.add(node);
    else node.querySelectorAll('.mes').forEach(mes => pending.add(mes));
}

function onMutations(mutations) {
    for (const mutation of mutations) {
        const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
        const mes = target?.closest?.('.mes');
        if (mes) pending.add(mes);
        else mutation.addedNodes.forEach(queueMessagesIn);
    }
    schedule();
}

/** Re-filters every rendered message now (same task, so nothing flickers). */
function refreshAll({ restoreFirst = false } = {}) {
    const chat = document.getElementById('chat');
    if (!chat) return;
    if (restoreFirst) dom.restore(chat);
    chat.querySelectorAll('.mes').forEach(mes => pending.add(mes));
    if (frame !== null) cancelAnimationFrame(frame);
    flush();
}

function startObserver() {
    const chat = document.getElementById('chat');
    if (!chat || observer) return;
    observer = new MutationObserver(onMutations);
    observer.observe(chat, { childList: true, subtree: true, characterData: true });
    refreshAll();
}

// ---------------------------------------------------------------------------
// Prompt: SillyTavern calls this (manifest `generate_interceptor`) with the
// messages about to be sent. Each entry is a copy (`{ ...chatItem, mes }`),
// so changing `mes` here never touches the saved chat.
// ---------------------------------------------------------------------------

globalThis.stFilteringInterceptor = async function stFilteringInterceptor(chat) {
    try {
        if (!settings || !isActive() || !settings.applyToPrompt || !Array.isArray(chat)) return;
        // Guard against a future SillyTavern passing the live chat objects.
        const live = new Set(getContext().chat ?? []);
        for (const message of chat) {
            if (!message || typeof message.mes !== 'string' || live.has(message)) continue;
            if (message.is_user && !settings.includeUser) continue;
            message.mes = engine.applyMarkup(message.mes, { includeCode: settings.includeCode }).text;
        }
    } catch (error) {
        console.error(LOG_PREFIX, 'Prompt filter failed; the prompt was sent unchanged', error);
    }
};

// ---------------------------------------------------------------------------

function rebuild({ restoreFirst = false } = {}) {
    engine = createEngine(getSettings());
    panel?.render();
    refreshAll({ restoreFirst });
}

function onSettingsChanged({ selectorsChanged = false } = {}) {
    saveSettings();
    rebuild({ restoreFirst: selectorsChanged });
}

function getLegacyRules() {
    return rulesFromLegacy(getContext().extensionSettings[LEGACY_KEY]);
}

function importLegacyOnFirstRun() {
    const current = getSettings();
    if (current.legacyChecked) return;
    current.legacyChecked = true;
    if (current.rules.length === 0) {
        const added = mergeRules(current, getLegacyRules());
        if (added > 0) {
            toastr.info(`Word Filter 규칙 ${added}개를 가져왔습니다. 이중 적용을 막으려면 Word Filter는 꺼 주세요.`, 'ST 필터링', { timeOut: 8000 });
        }
    }
    saveSettings();
}

function registerSlashCommand() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = getContext();
    if (!SlashCommandParser?.addCommandObject) return;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'stfilter',
        helpString: 'ST 필터링을 켜거나 끕니다. 인자가 없으면 현재 상태(on/off)를 반환합니다.',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'on | off | toggle',
                typeList: [ARGUMENT_TYPE.STRING],
                enumList: ['on', 'off', 'toggle'],
                isRequired: false,
            }),
        ],
        callback: (_named, value) => {
            const current = getSettings();
            const command = String(value ?? '').trim().toLowerCase();
            if (command === 'on' || command === 'off' || command === 'toggle') {
                current.enabled = command === 'toggle' ? !current.enabled : command === 'on';
                onSettingsChanged();
            }
            return current.enabled ? 'on' : 'off';
        },
    }));
}

function init() {
    try {
        getSettings();
        importLegacyOnFirstRun();
        engine = createEngine(settings);
        panel = mountSettingsPanel({
            getSettings,
            getEngine: () => engine,
            getLegacyRules,
            onChange: onSettingsChanged,
        });
        registerSlashCommand();
        startObserver();
    } catch (error) {
        console.error(LOG_PREFIX, 'Initialization failed', error);
        toastr.error('ST 필터링을 초기화하지 못했습니다. 브라우저 콘솔을 확인해 주세요.', 'ST 필터링');
    }
}

// Extension settings are loaded before extensions are imported, so start
// right away. The settings panel is placed in the order extensions attach
// theirs; waiting for APP_READY would push it to the bottom of the list.
init();
