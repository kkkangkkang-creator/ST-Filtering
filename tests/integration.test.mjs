import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// A minimal SillyTavern page: the extension settings column and one AI message.
const { window } = new JSDOM(`
    <div id="extensions_settings2"></div>
    <div id="extensionsMenu"></div>
    <div id="chat">
        <div class="mes" mesid="0"><div class="mes_text"><p>I like it very much.</p></div></div>
        <div class="mes" mesid="1"><div class="mes_text"><p>very much mine</p></div></div>
    </div>`);
const wait = () => new Promise(resolve => setTimeout(resolve, 30));

const commands = {};
const chat = [{ mes: 'I like it very much.', is_user: false, swipes: ['I like it very much.'] }, { mes: 'very much mine', is_user: true }];
const context = {
    chat,
    extensionSettings: { 'word-filter': { deleteRules: [{ text: 'very much' }] } },
    saveSettingsDebounced: () => {},
    eventSource: { on: (_event, handler) => handler() },
    eventTypes: { APP_READY: 'app_ready' },
    SlashCommandParser: { addCommandObject: command => { commands[command.name] = command; } },
    SlashCommand: { fromProps: props => props },
    SlashCommandArgument: { fromProps: props => props },
    ARGUMENT_TYPE: { STRING: 'string' },
    Popup: class {
        static show = { confirm: async () => true };
        constructor(content, _type, _value, options) {
            this.dlg = window.document.createElement('dialog');
            this.dlg.appendChild(content);
            this.options = options;
        }
        show() {
            window.document.body.appendChild(this.dlg);
            this.options.onOpen?.(this);
            return new Promise(resolve => { this.close = () => { this.dlg.remove(); resolve(); }; });
        }
    },
    POPUP_TYPE: { TEXT: 1 },
};
Object.assign(globalThis, {
    window,
    document: window.document,
    Node: window.Node,
    Option: window.Option,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    toastr: { info() {}, success() {}, warning() {}, error() {} },
    SillyTavern: { getContext: () => context },
});

await import('../index.js');
const text = id => document.querySelector(`.mes[mesid="${id}"] .mes_text`).textContent;
const panel = name => document.querySelector(`.stf-dialog [data-stf="${name}"]`);

test('imports Word Filter rules on first run and filters AI messages only', () => {
    assert.equal(context.extensionSettings['st-filtering'].rules.length, 1);
    assert.equal(text(0), 'I like it.');
    assert.equal(text(1), 'very much mine');
});

test('wand menu and drawer both open the manager popup', async () => {
    assert.equal(document.querySelector('#extensionsMenu #stf_wand_button span').textContent, '필터링');
    assert.equal(document.querySelector('.stf-drawer [data-stf="meta"]').textContent, '규칙 1개');
    document.getElementById('stf_wand_button').dispatchEvent(new window.Event('click'));
    await wait();
    assert.ok(document.querySelector('.stf-dialog .stf'));
    assert.equal(document.querySelectorAll('.stf-dialog .stf-row:not(.stf-row-head)').length, 1);
    // A second click while it is open does not stack another popup.
    document.querySelector('.stf-drawer [data-stf="open"]').dispatchEvent(new window.Event('click'));
    await wait();
    assert.equal(document.querySelectorAll('.stf-dialog').length, 1);
});

test('rules added in the popup apply to translations rendered later', async () => {
    panel('add-find').value = '기계적인';
    panel('add').dispatchEvent(new window.Event('click'));
    // LLM Translator re-renders the message with its spans.
    document.querySelector('.mes[mesid="0"] .mes_text').innerHTML =
        '<p><span class="translated_text">그는 기계적인 미소를 지었다.</span><span class="original_text">I like it very much.</span></p>';
    await wait();
    assert.equal(text(0), '그는 미소를 지었다.I like it.');
    assert.equal(document.querySelectorAll('.stf-dialog .stf-row:not(.stf-row-head)').length, 2);
    assert.equal(document.querySelector('.stf-drawer [data-stf="meta"]').textContent, '규칙 2개');
});

test('streamed text is filtered as it arrives', async () => {
    const p = document.querySelector('.mes[mesid="0"] .mes_text p');
    p.textContent = 'very much streaming';
    await wait();
    assert.equal(text(0), 'streaming');
});

test('the prompt interceptor filters copies and leaves user turns and live objects alone', async () => {
    const outgoing = [
        { mes: '<b class="very">very much</b> 기계적인 표정', is_user: false },
        { mes: 'very much', is_user: true },
        chat[0],
    ];
    await globalThis.stFilteringInterceptor(outgoing);
    assert.equal(outgoing[0].mes, '<b class="very"></b> 표정');
    assert.equal(outgoing[1].mes, 'very much');
    assert.equal(chat[0].mes, 'I like it very much.');
});

test('/stfilter off restores the original text, on filters again', async () => {
    assert.equal(commands.stfilter.callback({}, 'off'), 'off');
    assert.equal(text(0), 'very much streaming');
    assert.equal(document.querySelector('.stf-dialog input[data-key="enabled"]').checked, false);
    const outgoing = [{ mes: 'very much', is_user: false }];
    await globalThis.stFilteringInterceptor(outgoing);
    assert.equal(outgoing[0].mes, 'very much');
    assert.equal(commands.stfilter.callback({}, 'on'), 'on');
    assert.equal(text(0), 'streaming');
});

test('display can be turned off while the prompt filter stays on', async () => {
    const toggle = panel('options').closest('.stf').querySelector('input[data-key="applyToDisplay"]');
    toggle.checked = false;
    toggle.dispatchEvent(new window.Event('change'));
    assert.equal(text(0), 'very much streaming');
    const outgoing = [{ mes: 'very much', is_user: false }];
    await globalThis.stFilteringInterceptor(outgoing);
    assert.equal(outgoing[0].mes, '');
});

test('rule rows can be disabled, edited and deleted from the popup', async () => {
    const rows = () => [...document.querySelectorAll('.stf-dialog .stf-row:not(.stf-row-head)')];
    const toggle = document.querySelector('.stf-dialog input[data-key="applyToDisplay"]');
    toggle.checked = true;
    toggle.dispatchEvent(new window.Event('change'));
    assert.equal(text(0), 'streaming');

    const enabled = rows()[0].querySelector('input[type="checkbox"]');
    enabled.checked = false;
    enabled.dispatchEvent(new window.Event('change'));
    assert.equal(text(0), 'very much streaming');
    assert.ok(rows()[0].classList.contains('stf-off'));

    const find = rows()[0].querySelector('.stf-cell-find');
    find.value = 'streaming';
    find.dispatchEvent(new window.Event('change'));
    const reEnable = rows()[0].querySelector('input[type="checkbox"]');
    reEnable.checked = true;
    reEnable.dispatchEvent(new window.Event('change'));
    assert.equal(text(0), 'very much');

    rows()[0].querySelector('.stf-icon-danger').dispatchEvent(new window.Event('click'));
    assert.equal(rows().length, 1);
    assert.equal(text(0), 'very much streaming');
});

test('a broken regex shows an error on its row instead of failing', () => {
    panel('add-find').value = '(unclosed';
    panel('add-mode').value = 'regex';
    panel('add').dispatchEvent(new window.Event('click'));
    const error = document.querySelector('.stf-dialog .stf-row-error');
    assert.match(error.textContent, /정규식 오류/);
});
