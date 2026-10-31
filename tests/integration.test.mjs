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
    eventSource: {
        handlers: {},
        on(event, handler) { (this.handlers[event] ??= []).push(handler); },
        async emit(event, ...args) { for (const handler of this.handlers[event] ?? []) await handler(...args); },
    },
    eventTypes: { MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED: 'message_edited', CHARACTER_MESSAGE_RENDERED: 'character_message_rendered' },
    updateMessageBlock: () => {},
    saveChat: async () => {},
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

test('"before translation" filters the stored reply before a translator reads it, and can be undone', async () => {
    // Remove the broken regex added by the previous test.
    document.querySelector('.stf-dialog .stf-row.stf-invalid .stf-icon-danger').dispatchEvent(new window.Event('click'));
    const sourceToggle = document.querySelector('.stf-dialog input[data-key="applyToSource"]');
    sourceToggle.checked = true;
    sourceToggle.dispatchEvent(new window.Event('change'));
    await wait();
    assert.equal(context.extensionSettings['st-filtering'].applyToSource, true);

    let translatorSaw = null;
    context.eventSource.on('character_message_rendered', id => { translatorSaw = chat[id].mes; });
    chat.push({ mes: '그는 기계적인 미소를 지었다.', is_user: false, swipe_id: 0, swipes: ['그는 기계적인 미소를 지었다.'], swipe_info: [{ extra: {} }], extra: {} });
    await context.eventSource.emit('message_received', 2, 'normal');
    await context.eventSource.emit('character_message_rendered', 2, 'normal');
    assert.equal(translatorSaw, '그는 미소를 지었다.');
    assert.equal(chat[2].swipes[0], '그는 미소를 지었다.');

    panel('restore-source').dispatchEvent(new window.Event('click'));
    await wait();
    assert.equal(chat[2].mes, '그는 기계적인 미소를 지었다.');
    assert.equal(context.extensionSettings['st-filtering'].applyToSource, false);
});

test('"before translation" is off by default and leaves stored replies alone', async () => {
    chat.push({ mes: '기계적인 대답', is_user: false, extra: {} });
    await context.eventSource.emit('message_received', 3, 'normal');
    assert.equal(chat[3].mes, '기계적인 대답');
});
