import { RULE_MODES } from './engine.js';
import { exportPayload, mergeRules, normalizeRule, parseImport, ruleKey } from './settings.js';

const MODE_LABELS = {
    auto: '자동',
    text: '부분 일치',
    word: '단어',
    regex: '정규식',
};

const TOGGLES = [
    ['enabled', '필터 사용'],
    ['applyToDisplay', '화면에 적용 (번역문 포함)'],
    ['applyToPrompt', 'AI에게 보내는 내용에 적용'],
    ['includeUser', '유저 메시지에도 적용'],
    ['includeCode', '코드블록 안에도 적용'],
    ['caseSensitive', '대소문자 구분'],
    ['tidySpaces', '삭제 후 남는 공백 정리'],
];

const PANEL_HTML = `
<div class="stf-panel inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>ST 필터링</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
        <div class="stf-warning" data-stf="legacy-warning" hidden>
            Word Filter 확장이 켜져 있습니다. 같은 규칙이 두 번 적용되지 않도록 Word Filter는 꺼 주세요.
        </div>
        <div class="stf-toggles" data-stf="toggles"></div>

        <h4>규칙 추가</h4>
        <div class="stf-add">
            <textarea class="text_pole" data-stf="add-find" rows="2" placeholder="찾을 표현 (줄바꿈으로 여러 개, Enter로 추가)"></textarea>
            <input class="text_pole" data-stf="add-replace" type="text" placeholder="바꿀 표현 (비우면 삭제)">
            <select class="text_pole" data-stf="add-mode"></select>
            <div class="menu_button" data-stf="add"><i class="fa-solid fa-plus"></i> 추가</div>
        </div>
        <small class="stf-hint">자동: 영문은 단어 단위, 한글·기호는 부분 일치. 정규식에서는 바꿀 표현에 $1 같은 참조를 쓸 수 있습니다.</small>

        <div class="stf-list-header">
            <h4>규칙 <span data-stf="count"></span></h4>
            <input class="text_pole" data-stf="search" type="search" placeholder="검색">
        </div>
        <div class="stf-rules" data-stf="rules"></div>
        <div class="stf-empty" data-stf="empty">규칙이 없습니다.</div>

        <details class="stf-section">
            <summary>미리보기</summary>
            <textarea class="text_pole" data-stf="preview-input" rows="3" placeholder="문장을 붙여 넣으면 결과를 바로 보여줍니다."></textarea>
            <div class="stf-preview" data-stf="preview-output"></div>
        </details>

        <details class="stf-section">
            <summary>고급</summary>
            <label>추가로 필터할 영역 (CSS 선택자, 줄마다 하나)</label>
            <textarea class="text_pole" data-stf="selectors" rows="2" placeholder=".my-translation-box"></textarea>
            <small class="stf-hint">메시지 본문(.mes_text)과 추론(.mes_reasoning)은 항상 포함됩니다. LLM Translator, Interpres는 본문 안에 그리므로 따로 넣지 않아도 됩니다.</small>
        </details>

        <div class="stf-buttons">
            <div class="menu_button" data-stf="export"><i class="fa-solid fa-file-export"></i> 내보내기</div>
            <div class="menu_button" data-stf="import"><i class="fa-solid fa-file-import"></i> 가져오기</div>
            <div class="menu_button" data-stf="import-legacy" hidden><i class="fa-solid fa-clock-rotate-left"></i> Word Filter 규칙 가져오기</div>
            <input type="file" accept="application/json,.json" data-stf="file" hidden>
        </div>
    </div>
</div>`;

function isImeComposing(event) {
    return event.isComposing || event.keyCode === 229;
}

function makeModeSelect(select, value) {
    select.replaceChildren(...RULE_MODES.map(mode => new Option(MODE_LABELS[mode], mode)));
    select.value = value;
}

function iconButton(icon, title, onClick, disabled = false) {
    const button = document.createElement('div');
    button.className = `menu_button stf-icon fa-solid ${icon}`;
    button.title = title;
    if (disabled) button.classList.add('disabled');
    else button.addEventListener('click', onClick);
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

export function mountSettingsPanel({ getSettings, getEngine, getLegacyRules, onChange }) {
    const host = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!host) throw new Error('Extension settings container not found');

    const wrapper = document.createElement('div');
    wrapper.innerHTML = PANEL_HTML;
    const root = wrapper.firstElementChild;
    host.appendChild(root);
    const $ = name => root.querySelector(`[data-stf="${name}"]`);

    // Toggles
    for (const [key, label] of TOGGLES) {
        const row = document.createElement('label');
        row.className = 'checkbox_label';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.key = key;
        input.addEventListener('change', () => {
            getSettings()[key] = input.checked;
            onChange();
        });
        row.append(input, document.createTextNode(label));
        $('toggles').appendChild(row);
    }

    // Add
    makeModeSelect($('add-mode'), 'auto');
    const addRules = () => {
        const settings = getSettings();
        const lines = $('add-find').value.split('\n').filter(line => line.trim());
        if (!lines.length) return;
        const mode = $('add-mode').value;
        const replace = $('add-replace').value;
        const added = mergeRules(settings, lines.map(find => ({ find, replace, mode })));
        const skipped = lines.length - added;
        if (skipped > 0) toastr.info(`이미 있는 규칙 ${skipped}개는 건너뛰었습니다.`, 'ST 필터링');
        $('add-find').value = '';
        $('add-replace').value = '';
        onChange();
    };
    $('add').addEventListener('click', addRules);
    $('add-find').addEventListener('keydown', event => {
        if (isImeComposing(event) || event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        addRules();
    });
    $('add-replace').addEventListener('keydown', event => {
        if (isImeComposing(event) || event.key !== 'Enter') return;
        event.preventDefault();
        addRules();
    });

    // List
    $('search').addEventListener('input', () => renderRules());

    const updateRule = (rule, patch) => {
        const settings = getSettings();
        const next = normalizeRule({ ...rule, ...patch });
        if (!next) return renderRules();
        const key = ruleKey(next, settings.caseSensitive);
        if (settings.rules.some(other => other !== rule && ruleKey(other, settings.caseSensitive) === key)) {
            toastr.warning('같은 규칙이 이미 있습니다.', 'ST 필터링');
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

    function renderRules() {
        const settings = getSettings();
        const invalid = new Map(getEngine().invalid.map(item => [item.rule, item.error]));
        const query = $('search').value.trim().toLocaleLowerCase();
        const list = $('rules');
        list.replaceChildren();
        let shown = 0;

        settings.rules.forEach((rule, index) => {
            if (query && !`${rule.find}\n${rule.replace}`.toLocaleLowerCase().includes(query)) return;
            shown += 1;
            const row = document.createElement('div');
            row.className = 'stf-rule';
            row.classList.toggle('stf-disabled', !rule.enabled);

            const enabled = document.createElement('input');
            enabled.type = 'checkbox';
            enabled.checked = rule.enabled;
            enabled.title = '이 규칙 사용';
            enabled.addEventListener('change', () => updateRule(rule, { enabled: enabled.checked }));

            const find = document.createElement('input');
            find.className = 'text_pole stf-find';
            find.value = rule.find;
            find.addEventListener('change', () => updateRule(rule, { find: find.value }));
            if (invalid.has(rule)) {
                row.classList.add('stf-invalid');
                find.title = `정규식 오류: ${invalid.get(rule)}`;
            }

            const arrow = document.createElement('i');
            arrow.className = 'fa-solid fa-arrow-right stf-arrow';

            const replace = document.createElement('input');
            replace.className = 'text_pole stf-replace';
            replace.value = rule.replace;
            replace.placeholder = '(삭제)';
            replace.addEventListener('change', () => updateRule(rule, { replace: replace.value }));

            const mode = document.createElement('select');
            mode.className = 'text_pole stf-mode';
            makeModeSelect(mode, rule.mode);
            mode.addEventListener('change', () => updateRule(rule, { mode: mode.value }));

            const controls = document.createElement('div');
            controls.className = 'stf-controls';
            controls.append(
                iconButton('fa-chevron-up', '위로', () => move(index, -1), index === 0 || Boolean(query)),
                iconButton('fa-chevron-down', '아래로', () => move(index, 1), index === settings.rules.length - 1 || Boolean(query)),
                iconButton('fa-xmark', '삭제', () => {
                    settings.rules = settings.rules.filter(item => item !== rule);
                    onChange();
                }),
            );

            row.append(enabled, find, arrow, replace, mode, controls);
            list.appendChild(row);
        });

        $('count').textContent = `(${settings.rules.length})`;
        $('empty').hidden = shown > 0;
    }

    // Preview
    const renderPreview = () => {
        const input = $('preview-input').value;
        const output = $('preview-output');
        if (!input) {
            output.textContent = '';
            return;
        }
        const result = getEngine().applyPlain(input);
        output.textContent = `${result.text}\n\n— ${result.count}곳 일치`;
    };
    $('preview-input').addEventListener('input', renderPreview);

    // Advanced
    $('selectors').addEventListener('change', () => {
        getSettings().extraSelectors = $('selectors').value;
        onChange({ selectorsChanged: true });
    });

    // Import / export
    $('export').addEventListener('click', () => {
        download(JSON.stringify(exportPayload(getSettings()), null, 2), 'st-filtering.json');
    });
    $('import').addEventListener('click', () => $('file').click());
    $('file').addEventListener('change', async () => {
        const file = $('file').files?.[0];
        $('file').value = '';
        if (!file) return;
        try {
            const imported = parseImport(await file.text());
            const { Popup } = SillyTavern.getContext();
            if (imported.kind === 'settings') {
                const ok = await Popup.show.confirm('ST 필터링 가져오기', `현재 설정을 규칙 ${imported.settings.rules.length}개짜리 설정으로 교체합니다.`);
                if (!ok) return;
                const settings = getSettings();
                for (const key of Object.keys(settings)) delete settings[key];
                Object.assign(settings, imported.settings, { legacyChecked: true });
                onChange({ selectorsChanged: true });
            } else {
                const added = mergeRules(getSettings(), imported.rules);
                toastr.success(`Word Filter 규칙 ${added}개를 추가했습니다.`, 'ST 필터링');
                onChange();
            }
        } catch (error) {
            console.error('[ST Filtering] Import failed', error);
            toastr.error('가져올 규칙을 찾지 못했습니다. ST 필터링 또는 Word Filter 백업 파일인지 확인해 주세요.', 'ST 필터링');
        }
    });
    $('import-legacy').addEventListener('click', () => {
        const added = mergeRules(getSettings(), getLegacyRules());
        toastr.info(added ? `Word Filter 규칙 ${added}개를 추가했습니다.` : '새로 가져올 규칙이 없습니다.', 'ST 필터링');
        if (added) onChange();
    });

    function render() {
        const settings = getSettings();
        for (const input of $('toggles').querySelectorAll('input[data-key]')) input.checked = Boolean(settings[input.dataset.key]);
        root.classList.toggle('stf-off', !settings.enabled);
        if (document.activeElement !== $('selectors')) $('selectors').value = settings.extraSelectors;
        $('import-legacy').hidden = getLegacyRules().length === 0;
        // Word Filter adds this button to the extensions menu while it is running.
        $('legacy-warning').hidden = !document.getElementById('word_filter_button');
        renderRules();
        renderPreview();
    }

    render();
    // Word Filter may finish loading after this panel.
    setTimeout(render, 3000);
    return { render };
}
