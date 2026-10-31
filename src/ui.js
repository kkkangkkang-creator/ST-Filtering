import { RULE_MODES } from './engine.js';
import { exportPayload, mergeRules, normalizeRule, parseImport, ruleKey } from './settings.js';

const TITLE = '필터링';

const MODE_LABELS = {
    auto: '자동',
    text: '부분',
    word: '단어',
    regex: '정규식',
};

const MODE_HELP = '자동: 영문은 단어 단위, 한글·기호는 부분 일치 · 부분: 단어 안쪽까지 · 단어: 앞뒤가 다른 글자와 붙어 있으면 제외 · 정규식: 바꿀 표현에 $1 사용 가능';

const OPTIONS = [
    ['includeUser', '유저 메시지에도 적용', '내가 보낸 메시지도 화면과 AI 전송 내용에서 필터합니다.'],
    ['includeCode', '코드블록 안에도 적용', 'Interpres처럼 코드블록 안까지 번역하는 경우에 켭니다.'],
    ['caseSensitive', '대소문자 구분', '끄면 Very와 very를 같은 표현으로 봅니다.'],
    ['tidySpaces', '삭제 후 공백 정리', '“I like it very much.”에서 very much를 지우면 “I like it.”이 됩니다.'],
];

const MANAGER_HTML = `
<div class="stf">
    <header class="stf-head">
        <div>
            <h3 class="stf-title">${TITLE}</h3>
            <div class="stf-meta" data-stf="meta"></div>
        </div>
        <label class="stf-master"><input type="checkbox" data-key="enabled"> 사용</label>
    </header>

    <div class="stf-scope">
        <span class="stf-scope-label">적용</span>
        <label><input type="checkbox" data-key="applyToDisplay"> 화면 · 번역문</label>
        <label><input type="checkbox" data-key="applyToPrompt"> AI에게 보내는 내용</label>
        <label title="번역 확장이 읽기 전에 저장된 원문에서 지웁니다. 백업 탭에서 되돌릴 수 있습니다."><input type="checkbox" data-key="applyToSource"> 번역 전 원문</label>
    </div>

    <p class="stf-notice" data-stf="legacy-warning" hidden>Word Filter가 켜져 있어 같은 규칙이 두 번 적용될 수 있습니다. 확장 관리에서 Word Filter를 꺼 주세요.</p>

    <nav class="stf-tabs" role="tablist">
        <button type="button" class="stf-tab" role="tab" data-tab="rules">규칙</button>
        <button type="button" class="stf-tab" role="tab" data-tab="test">미리보기</button>
        <button type="button" class="stf-tab" role="tab" data-tab="options">설정</button>
        <button type="button" class="stf-tab" role="tab" data-tab="backup">백업</button>
    </nav>

    <section class="stf-pane" data-pane="rules">
        <div class="stf-add">
            <textarea class="text_pole" data-stf="add-find" rows="1" placeholder="찾을 표현"></textarea>
            <input class="text_pole" data-stf="add-replace" type="text" placeholder="바꿀 표현 · 비우면 삭제">
            <select class="text_pole" data-stf="add-mode" title="${MODE_HELP}"></select>
            <button type="button" class="menu_button stf-add-button" data-stf="add">추가</button>
        </div>
        <p class="stf-hint">Enter로 추가, Shift+Enter로 줄을 바꿔 여러 개를 한꺼번에 넣을 수 있습니다.</p>

        <div class="stf-toolbar" data-stf="toolbar">
            <span class="stf-toolbar-label">목록</span>
            <input class="text_pole stf-search" data-stf="search" type="search" placeholder="검색">
        </div>
        <div class="stf-table" data-stf="table">
            <div class="stf-row stf-row-head" data-stf="table-head">
                <span></span><span>찾을 표현</span><span>바꿀 표현</span><span>방식</span><span></span>
            </div>
            <div data-stf="rules"></div>
        </div>
        <p class="stf-empty" data-stf="empty"></p>
    </section>

    <section class="stf-pane" data-pane="test" hidden>
        <p class="stf-hint">문장을 붙여 넣으면 지금 규칙으로 바뀐 결과를 보여줍니다. 꺼 둔 규칙은 적용하지 않습니다.</p>
        <textarea class="text_pole stf-test-input" data-stf="test-input" rows="4" placeholder="예: She smiled mechanically, her voice very much calm."></textarea>
        <div class="stf-test-result">
            <div class="stf-test-label" data-stf="test-count">결과</div>
            <div class="stf-test-output" data-stf="test-output"></div>
        </div>
    </section>

    <section class="stf-pane" data-pane="options" hidden>
        <div class="stf-options" data-stf="options"></div>
        <div class="stf-field">
            <label for="stf-selectors">추가로 필터할 영역</label>
            <textarea id="stf-selectors" class="text_pole" data-stf="selectors" rows="2" placeholder=".my-translation-box"></textarea>
            <p class="stf-hint">CSS 선택자를 줄마다 하나씩 넣습니다. 메시지 본문과 추론은 항상 포함되고, LLM Translator · Interpres 번역문도 본문 안에 있어 따로 넣지 않아도 됩니다.</p>
        </div>
    </section>

    <section class="stf-pane" data-pane="backup" hidden>
        <div class="stf-actions">
            <div class="stf-action">
                <div><strong>내보내기</strong><p>규칙과 설정을 JSON 파일로 저장합니다.</p></div>
                <button type="button" class="menu_button" data-stf="export">내보내기</button>
            </div>
            <div class="stf-action">
                <div><strong>가져오기</strong><p>필터링 파일은 현재 설정을 교체하고, Word Filter 백업 파일은 규칙만 추가합니다.</p></div>
                <button type="button" class="menu_button" data-stf="import">파일 선택</button>
            </div>
            <div class="stf-action">
                <div><strong>원문 되돌리기</strong><p>“번역 전 원문”으로 지운 현재 채팅의 메시지를 원래 글로 되돌리고, 그 옵션을 끕니다. 직접 고친 메시지는 건너뜁니다.</p></div>
                <button type="button" class="menu_button" data-stf="restore-source">되돌리기</button>
            </div>
            <div class="stf-action" data-stf="legacy-row" hidden>
                <div><strong>Word Filter 규칙</strong><p>설치된 Word Filter의 규칙 중 없는 것만 추가합니다.</p></div>
                <button type="button" class="menu_button" data-stf="import-legacy">가져오기</button>
            </div>
        </div>
        <input type="file" accept="application/json,.json" data-stf="file" hidden>
    </section>
</div>`;

const DRAWER_HTML = `
<div class="stf-drawer inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>${TITLE}</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
        <div class="stf-drawer-row">
            <label class="checkbox_label"><input type="checkbox" data-key="enabled"> 사용</label>
            <span class="stf-meta" data-stf="meta"></span>
            <button type="button" class="menu_button" data-stf="open">규칙 관리</button>
        </div>
        <p class="stf-hint">채팅 입력창 왼쪽 요술봉 메뉴의 “${TITLE}”에서도 열 수 있습니다.</p>
    </div>
</div>`;

function fromHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
}

function isImeComposing(event) {
    return event.isComposing || event.keyCode === 229;
}

function fillModeSelect(select, value) {
    select.replaceChildren(...RULE_MODES.map(mode => new Option(MODE_LABELS[mode], mode)));
    select.value = value;
}

function iconButton(icon, label, onClick, { disabled = false, danger = false } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `stf-icon${danger ? ' stf-icon-danger' : ''}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.disabled = disabled;
    const glyph = document.createElement('i');
    glyph.className = `fa-solid ${icon}`;
    button.appendChild(glyph);
    button.addEventListener('click', onClick);
    return button;
}

function download(content, filename) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function describe(settings) {
    const active = settings.rules.filter(rule => rule.enabled).length;
    if (!settings.rules.length) return '규칙 없음';
    return active === settings.rules.length ? `규칙 ${active}개` : `규칙 ${settings.rules.length}개 · ${active}개 사용 중`;
}

const SOURCE_MODE_CONFIRM = '새로 받는 AI 답변을 저장된 원문에서 바로 지웁니다. 번역 확장은 지워진 글을 번역하게 됩니다.\n\n'
    + '원래 글은 메시지에 함께 저장되어, 백업 탭의 “원문 되돌리기”로 되돌릴 수 있습니다. 이미 받은 메시지는 바뀌지 않습니다.';

function bindToggles(root, getSettings, onChange) {
    for (const input of root.querySelectorAll('input[data-key]')) {
        input.addEventListener('change', async () => {
            const key = input.dataset.key;
            if (key === 'applyToSource' && input.checked) {
                const { Popup } = SillyTavern.getContext();
                const ok = await Popup.show.confirm('번역 전 원문에서 지우기', SOURCE_MODE_CONFIRM);
                if (!ok) {
                    input.checked = false;
                    return;
                }
            }
            getSettings()[key] = input.checked;
            onChange();
        });
    }
}

function syncToggles(root, settings) {
    for (const input of root.querySelectorAll('input[data-key]')) input.checked = Boolean(settings[input.dataset.key]);
}

/** The full rule manager. Rendered inside a popup. */
function createManagerView({ getSettings, getEngine, getLegacyRules, restoreSourceInChat, onChange }) {
    const root = fromHtml(MANAGER_HTML);
    const $ = name => root.querySelector(`[data-stf="${name}"]`);
    let activeTab = 'rules';

    for (const [key, label, help] of OPTIONS) {
        const row = document.createElement('label');
        row.className = 'stf-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.key = key;
        const text = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = label;
        const description = document.createElement('small');
        description.textContent = help;
        text.append(title, description);
        row.append(input, text);
        $('options').appendChild(row);
    }
    bindToggles(root, getSettings, onChange);

    // Tabs
    const selectTab = tab => {
        activeTab = tab;
        for (const button of root.querySelectorAll('.stf-tab')) {
            const selected = button.dataset.tab === tab;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', String(selected));
        }
        for (const pane of root.querySelectorAll('.stf-pane')) pane.hidden = pane.dataset.pane !== tab;
        if (tab === 'test') renderTest();
    };
    for (const button of root.querySelectorAll('.stf-tab')) button.addEventListener('click', () => selectTab(button.dataset.tab));

    // Add
    fillModeSelect($('add-mode'), 'auto');
    const addFind = $('add-find');
    const growAddFind = () => {
        addFind.style.height = 'auto';
        addFind.style.height = `${addFind.scrollHeight + 2}px`;
    };
    const addRules = () => {
        const lines = addFind.value.split('\n').filter(line => line.trim());
        if (!lines.length) return addFind.focus();
        const replace = $('add-replace').value;
        const mode = $('add-mode').value;
        const added = mergeRules(getSettings(), lines.map(find => ({ find, replace, mode })));
        const skipped = lines.length - added;
        if (skipped > 0) toastr.info(`이미 있는 규칙 ${skipped}개는 건너뛰었습니다.`, TITLE);
        addFind.value = '';
        $('add-replace').value = '';
        growAddFind();
        if (added > 0) onChange();
        addFind.focus();
    };
    $('add').addEventListener('click', addRules);
    addFind.addEventListener('input', growAddFind);
    addFind.addEventListener('keydown', event => {
        if (isImeComposing(event) || event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        addRules();
    });
    $('add-replace').addEventListener('keydown', event => {
        if (isImeComposing(event) || event.key !== 'Enter') return;
        event.preventDefault();
        addRules();
    });

    // Rules
    $('search').addEventListener('input', () => renderRules());

    const updateRule = (rule, patch) => {
        const settings = getSettings();
        const next = normalizeRule({ ...rule, ...patch });
        if (!next) return renderRules();
        const key = ruleKey(next, settings.caseSensitive);
        if (settings.rules.some(other => other !== rule && ruleKey(other, settings.caseSensitive) === key)) {
            toastr.warning('같은 규칙이 이미 있습니다.', TITLE);
            return renderRules();
        }
        Object.assign(rule, next);
        onChange();
    };

    const move = (index, delta) => {
        const rules = getSettings().rules;
        const target = index + delta;
        if (target < 0 || target >= rules.length) return;
        [rules[index], rules[target]] = [rules[target], rules[index]];
        onChange();
    };

    function ruleRow(rule, index, total, filtering, error) {
        const row = document.createElement('div');
        row.className = 'stf-row';
        row.classList.toggle('stf-off', !rule.enabled);

        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.className = 'stf-cell-check';
        enabled.checked = rule.enabled;
        enabled.title = rule.enabled ? '사용 중 · 눌러서 끄기' : '꺼짐 · 눌러서 켜기';
        enabled.addEventListener('change', () => updateRule(rule, { enabled: enabled.checked }));

        const find = document.createElement('input');
        find.className = 'text_pole stf-cell-find';
        find.value = rule.find;
        find.setAttribute('aria-label', '찾을 표현');
        find.addEventListener('change', () => updateRule(rule, { find: find.value }));

        const replace = document.createElement('input');
        replace.className = 'text_pole stf-cell-replace';
        replace.value = rule.replace;
        replace.placeholder = '삭제';
        replace.setAttribute('aria-label', '바꿀 표현');
        replace.addEventListener('change', () => updateRule(rule, { replace: replace.value }));

        const mode = document.createElement('select');
        mode.className = 'text_pole stf-cell-mode';
        mode.title = MODE_HELP;
        fillModeSelect(mode, rule.mode);
        mode.addEventListener('change', () => updateRule(rule, { mode: mode.value }));

        const controls = document.createElement('div');
        controls.className = 'stf-cell-controls';
        controls.append(
            iconButton('fa-arrow-up', '위로', () => move(index, -1), { disabled: filtering || index === 0 }),
            iconButton('fa-arrow-down', '아래로', () => move(index, 1), { disabled: filtering || index === total - 1 }),
            iconButton('fa-xmark', '삭제', () => {
                const settings = getSettings();
                settings.rules = settings.rules.filter(item => item !== rule);
                onChange();
            }, { danger: true }),
        );

        row.append(enabled, find, replace, mode, controls);
        if (error) {
            row.classList.add('stf-invalid');
            const message = document.createElement('div');
            message.className = 'stf-row-error';
            message.textContent = `정규식 오류 · ${error}`;
            row.appendChild(message);
        }
        return row;
    }

    function renderRules() {
        const settings = getSettings();
        const invalid = new Map(getEngine().invalid.map(item => [item.rule, item.error]));
        const query = $('search').value.trim().toLocaleLowerCase();
        const rows = [];
        settings.rules.forEach((rule, index) => {
            if (query && !`${rule.find}\n${rule.replace}`.toLocaleLowerCase().includes(query)) return;
            rows.push(ruleRow(rule, index, settings.rules.length, Boolean(query), invalid.get(rule)));
        });
        $('rules').replaceChildren(...rows);
        $('table-head').hidden = settings.rules.length === 0;
        $('toolbar').hidden = settings.rules.length === 0;
        $('empty').hidden = rows.length > 0;
        $('empty').textContent = settings.rules.length
            ? '검색 결과가 없습니다.'
            : '아직 규칙이 없습니다. 위에 지우거나 바꿀 표현을 입력하세요.';
    }

    // Preview
    function renderTest() {
        const input = $('test-input').value;
        if (!input) {
            $('test-output').textContent = '';
            $('test-count').textContent = '결과';
            return;
        }
        const result = getEngine().applyPlain(input);
        $('test-output').textContent = result.text;
        $('test-count').textContent = result.count ? `결과 · ${result.count}곳 바뀜` : '결과 · 바뀐 곳 없음';
    }
    $('test-input').addEventListener('input', renderTest);

    // Options
    $('selectors').addEventListener('change', () => {
        getSettings().extraSelectors = $('selectors').value;
        onChange({ selectorsChanged: true });
    });

    // Backup
    $('export').addEventListener('click', () => {
        download(JSON.stringify(exportPayload(getSettings()), null, 2), 'filtering.json');
    });
    $('import').addEventListener('click', () => $('file').click());
    $('file').addEventListener('change', async () => {
        const file = $('file').files?.[0];
        $('file').value = '';
        if (!file) return;
        try {
            const imported = parseImport(await file.text());
            if (imported.kind === 'settings') {
                const { Popup } = SillyTavern.getContext();
                const ok = await Popup.show.confirm(`${TITLE} 가져오기`, `현재 규칙과 설정을 파일의 규칙 ${imported.settings.rules.length}개로 교체합니다.`);
                if (!ok) return;
                const settings = getSettings();
                for (const key of Object.keys(settings)) delete settings[key];
                Object.assign(settings, imported.settings, { legacyChecked: true });
                onChange({ selectorsChanged: true });
            } else {
                const added = mergeRules(getSettings(), imported.rules);
                toastr.success(`Word Filter 규칙 ${added}개를 추가했습니다.`, TITLE);
                onChange();
            }
        } catch (error) {
            console.error('[ST Filtering] Import failed', error);
            toastr.error('가져올 규칙을 찾지 못했습니다. 필터링 또는 Word Filter 백업 파일인지 확인해 주세요.', TITLE);
        }
    });
    $('restore-source').addEventListener('click', async () => {
        const { Popup } = SillyTavern.getContext();
        const ok = await Popup.show.confirm('원문 되돌리기', '현재 채팅에서 “번역 전 원문”으로 지운 메시지를 원래 글로 되돌립니다. 번역문은 다시 번역해야 반영됩니다.');
        if (!ok) return;
        const result = await restoreSourceInChat();
        getSettings().applyToSource = false;
        onChange();
        const skipped = result.conflicts ? ` 직접 고친 ${result.conflicts}개는 건너뛰었습니다.` : '';
        toastr.info(result.restored ? `메시지 ${result.messages}개를 되돌렸습니다.${skipped}` : `되돌릴 메시지가 없습니다.${skipped}`, TITLE);
    });
    $('import-legacy').addEventListener('click', () => {
        const added = mergeRules(getSettings(), getLegacyRules());
        toastr.info(added ? `Word Filter 규칙 ${added}개를 추가했습니다.` : '새로 가져올 규칙이 없습니다.', TITLE);
        if (added) onChange();
    });

    function render() {
        const settings = getSettings();
        syncToggles(root, settings);
        root.classList.toggle('stf-disabled', !settings.enabled);
        $('meta').textContent = settings.enabled ? describe(settings) : `꺼짐 · ${describe(settings)}`;
        if (document.activeElement !== $('selectors')) $('selectors').value = settings.extraSelectors;
        $('legacy-row').hidden = getLegacyRules().length === 0;
        // Word Filter adds this button to the wand menu while it is running.
        $('legacy-warning').hidden = !document.getElementById('word_filter_button');
        renderRules();
        if (activeTab === 'test') renderTest();
    }

    selectTab('rules');
    render();
    return { root, render, focus: () => addFind.focus() };
}

/**
 * Mounts the small drawer in the extensions panel and the wand-menu entry.
 * Both open the same popup manager.
 */
export function mountUi(deps) {
    const { getSettings, onChange } = deps;
    const views = new Set();
    let popupOpen = false;

    async function open() {
        if (popupOpen) return;
        popupOpen = true;
        const view = createManagerView(deps);
        views.add(view);
        try {
            const { Popup, POPUP_TYPE } = SillyTavern.getContext();
            const popup = new Popup(view.root, POPUP_TYPE.TEXT, '', {
                wider: true,
                leftAlign: true,
                allowVerticalScrolling: true,
                okButton: '닫기',
                animation: 'fast',
                onOpen: () => view.focus(),
            });
            popup.dlg.classList.add('stf-dialog');
            await popup.show();
        } finally {
            views.delete(view);
            popupOpen = false;
        }
    }

    // Extensions panel
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (host) {
        const drawer = fromHtml(DRAWER_HTML);
        host.appendChild(drawer);
        bindToggles(drawer, getSettings, onChange);
        drawer.querySelector('[data-stf="open"]').addEventListener('click', () => void open());
        views.add({
            render() {
                const settings = getSettings();
                syncToggles(drawer, settings);
                drawer.querySelector('[data-stf="meta"]').textContent = describe(settings);
            },
        });
    }

    // Wand menu. It is created before extensions load, but retry briefly in
    // case an older SillyTavern builds it later.
    const addWandItem = () => {
        const menu = document.getElementById('extensionsMenu');
        if (!menu) return false;
        if (document.getElementById('stf_wand_button')) return true;
        const item = fromHtml(`
            <div id="stf_wand_button" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="${TITLE} 규칙 관리">
                <div class="fa-solid fa-filter extensionsMenuExtensionButton"></div>
                <span>${TITLE}</span>
            </div>`);
        item.addEventListener('click', () => void open());
        item.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                void open();
            }
        });
        menu.appendChild(item);
        return true;
    };
    if (!addWandItem()) {
        const timer = setInterval(() => addWandItem() && clearInterval(timer), 500);
        setTimeout(() => clearInterval(timer), 15000);
    }

    const render = () => views.forEach(view => view.render());
    render();
    // Word Filter may finish loading later; refresh its warning then.
    setTimeout(render, 3000);
    return { render, open };
}
