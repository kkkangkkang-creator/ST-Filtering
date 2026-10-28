import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createEngine } from '../src/engine.js';
import { DomFilter, collectTextRuns, distributeMatches } from '../src/dom-filter.js';

function setup(html) {
    const { window } = new JSDOM(`<div id="root">${html}</div>`);
    return window.document.getElementById('root');
}

test('distributeMatches puts replacements where matches start', () => {
    const matches = [{ start: 2, end: 6, replacement: 'X' }];
    assert.deepEqual(distributeMatches(['ab', 'cd', 'ef'], matches), ['ab', 'X', '']);
    assert.deepEqual(distributeMatches(['ab', 'cd'], [{ start: 1, end: 3, replacement: 'X' }]), ['aX', 'd']);
    assert.deepEqual(distributeMatches(['abc', 'def'], [{ start: 1, end: 2, replacement: '' }, { start: 4, end: 5, replacement: 'Y' }]), ['ac', 'dYf']);
});

test('phrases match across inline elements', () => {
    const root = setup('<p>I like it very <em>much</em>.</p>');
    new DomFilter().filterRoot(root, createEngine({ rules: [{ find: 'very much' }] }));
    assert.equal(root.innerHTML, '<p>I like it<em></em>.</p>');
});

test('matches never span paragraphs, <br>, or LLM Translator spans', () => {
    const root = setup('<p>very</p><p>much</p>a<br>b<span class="translated_text">ve</span><span class="original_text">ry</span>');
    new DomFilter().filterRoot(root, createEngine({ rules: [{ find: 'very much' }, { find: 'ab' }, { find: 'very', mode: 'text', replace: 'X' }] }));
    assert.equal(root.textContent, 'Xmuchabvery');
});

test('code, Tavern Helper renders and editors are skipped', () => {
    const root = setup('very <code>very</code><pre>very</pre><div class="TH-render">very</div><textarea>very</textarea>');
    new DomFilter().filterRoot(root, createEngine({ rules: [{ find: 'very', replace: 'X' }] }));
    assert.equal(root.querySelector('code').textContent, 'very');
    assert.equal(root.querySelector('pre').textContent, 'very');
    assert.equal(root.querySelector('.TH-render').textContent, 'very');
    assert.equal(root.querySelector('textarea').value, 'very');
    assert.ok(root.textContent.startsWith('X '));
});

test('includeCode filters code too', () => {
    const root = setup('<code>very</code>');
    new DomFilter().filterRoot(root, createEngine({ rules: [{ find: 'very', replace: 'X' }] }), { includeCode: true });
    assert.equal(root.textContent, 'X');
});

test('re-running is idempotent even when output matches the rule', () => {
    const root = setup('a b');
    const filter = new DomFilter();
    const engine = createEngine({ rules: [{ find: 'a', replace: 'aa' }] });
    filter.filterRoot(root, engine);
    filter.filterRoot(root, engine);
    assert.equal(root.textContent, 'aa b');
});

test('rule changes recompute from the original and restore puts it back', () => {
    const root = setup('<p>one two</p>');
    const filter = new DomFilter();
    filter.filterRoot(root, createEngine({ rules: [{ find: 'one', replace: '1' }] }));
    assert.equal(root.textContent, '1 two');
    filter.filterRoot(root, createEngine({ rules: [{ find: 'two', replace: '2' }] }));
    assert.equal(root.textContent, 'one 2');
    filter.filterRoot(root, createEngine({ rules: [] }));
    assert.equal(root.textContent, 'one two');
    filter.filterRoot(root, createEngine({ rules: [{ find: 'one', replace: '1' }] }));
    filter.restore(root);
    assert.equal(root.textContent, 'one two');
});

test('text replaced by someone else becomes the new original', () => {
    const root = setup('one');
    const filter = new DomFilter();
    const engine = createEngine({ rules: [{ find: 'one', replace: '1' }] });
    filter.filterRoot(root, engine);
    root.firstChild.nodeValue = 'one more';
    filter.filterRoot(root, engine);
    assert.equal(root.textContent, '1 more');
    filter.restore(root);
    assert.equal(root.textContent, 'one more');
});

test('collectTextRuns groups by block', () => {
    const root = setup('<p>a<b>b</b></p><p>c</p>');
    assert.deepEqual(collectTextRuns(root).map(run => run.map(node => node.nodeValue).join('')), ['ab', 'c']);
});
