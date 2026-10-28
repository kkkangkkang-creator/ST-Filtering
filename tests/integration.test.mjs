import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// A minimal SillyTavern page: the extension settings column and one AI message.
const { window } = new JSDOM(`
    <div id="extensions_settings2"></div>
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
    Popup: { show: { confirm: async () => true } },
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
const panel = name => document.querySelector(`.stf-panel [data-stf="${name}"]`);

test('imports Word Filter rules on first run and filters AI messages only', () => {
    assert.equal(context.extensionSettings['st-filtering'].rules.length, 1);
    assert.equal(text(0), 'I like it.');
    assert.equal(text(1), 'very much mine');
});

test('rules added in the panel apply to translations rendered later', async () => {
    panel('add-find').value = '기계적인';
    panel('add').dispatchEvent(new window.Event('click'));
    // LLM Translator re-renders the message with its spans.
    document.querySelector('.mes[mesid="0"] .mes_text').innerHTML =
        '<p><span class="translated_text">그는 기계적인 미소를 지었다.</span><span class="original_text">I like it very much.</span></p>';
    await wait();
    assert.equal(text(0), '그는 미소를 지었다.I like it.');
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
    const outgoing = [{ mes: 'very much', is_user: false }];
    await globalThis.stFilteringInterceptor(outgoing);
    assert.equal(outgoing[0].mes, 'very much');
    assert.equal(commands.stfilter.callback({}, 'on'), 'on');
    assert.equal(text(0), 'streaming');
});

test('display can be turned off while the prompt filter stays on', async () => {
    const toggle = document.querySelector('.stf-panel input[data-key="applyToDisplay"]');
    toggle.checked = false;
    toggle.dispatchEvent(new window.Event('change'));
    assert.equal(text(0), 'very much streaming');
    const outgoing = [{ mes: 'very much', is_user: false }];
    await globalThis.stFilteringInterceptor(outgoing);
    assert.equal(outgoing[0].mes, '');
});
