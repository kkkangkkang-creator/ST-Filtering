import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, findMatches, compileRules } from '../src/engine.js';

const plain = (text, rules, options = {}) => createEngine({ rules, ...options }).applyPlain(text).text;

test('auto mode: ASCII terms match whole words only', () => {
    assert.equal(plain('rhythmic rhythmically', [{ find: 'rhythmic' }]), 'rhythmically');
    assert.equal(plain("don't stop", [{ find: "don't" }]), 'stop');
});

test('auto mode: Hangul and symbols match as substrings', () => {
    assert.equal(plain('그녀는 웃었다', [{ find: '그녀', replace: '그' }]), '그는 웃었다');
    assert.equal(plain('잠깐—그래', [{ find: '—', replace: ', ' }]), '잠깐, 그래');
});

test('word mode uses Unicode boundaries', () => {
    assert.equal(plain('그녀 그녀는', [{ find: '그녀', replace: 'X', mode: 'word' }]), 'X 그녀는');
});

test('text mode matches inside words', () => {
    assert.equal(plain('rhythmically', [{ find: 'rhythmic', mode: 'text' }]), 'ally');
});

test('longer match wins at the same position and rules never chain', () => {
    const rules = [{ find: 'very' }, { find: 'very much', replace: 'a lot' }];
    assert.equal(plain('very much, very good', rules), 'a lot, good');
    assert.equal(plain('a b', [{ find: 'a', replace: 'b' }, { find: 'b', replace: 'c' }]), 'b c');
});

test('replacement text is literal outside regex mode', () => {
    assert.equal(plain('cat', [{ find: 'cat', replace: '$& $1' }]), '$& $1');
});

test('regex mode supports captures, named groups and $$', () => {
    const rules = [{ find: '(\\w+)@(?<host>\\w+)', replace: '$<host>:$1 $$', mode: 'regex' }];
    assert.equal(plain('mail me@home', rules), 'mail home:me $');
});

test('invalid regex is reported, not thrown', () => {
    const { compiled, invalid } = compileRules([{ find: '(', mode: 'regex' }, { find: 'ok' }]);
    assert.equal(compiled.length, 1);
    assert.equal(invalid.length, 1);
});

test('empty regex matches cannot loop forever', () => {
    assert.equal(plain('baaab', [{ find: 'a*', replace: 'X', mode: 'regex' }]), 'bXb');
});

test('disabled rules are ignored', () => {
    assert.equal(plain('very', [{ find: 'very', enabled: false }]), 'very');
});

test('case sensitivity', () => {
    assert.equal(plain('Very very', [{ find: 'very' }]), '');
    assert.equal(plain('Very very', [{ find: 'very' }], { caseSensitive: true }), 'Very');
});

test('deletions do not leave double spaces or a space before punctuation', () => {
    const rules = [{ find: 'very much' }, { find: 'very' }];
    assert.equal(plain('I like it very much.', rules), 'I like it.');
    assert.equal(plain('Very good', rules), 'good');
    assert.equal(plain('a very, b', rules), 'a, b');
    assert.equal(plain('a very very b', rules), 'a b');
    assert.equal(plain('a very\nb', rules), 'a\nb');
    assert.equal(plain('a  very  b', rules, { tidySpaces: false }), 'a    b');
});

test('replacements do not trigger seam cleanup', () => {
    assert.equal(plain('a very b', [{ find: 'very', replace: 'so' }]), 'a so b');
});

test('prompt text keeps tags, comments and code unless includeCode', () => {
    const engine = createEngine({ rules: [{ find: 'div' }, { find: 'very' }] });
    const source = '<div class="div">very div</div> `very` <!-- very -->\n```\nvery\n```';
    assert.equal(engine.applyMarkup(source).text, '<div class="div"></div> `very` <!-- very -->\n```\nvery\n```');
    assert.equal(engine.applyMarkup(source, { includeCode: true }).text, '<div class="div"></div> `` <!-- very -->\n```\n\n```');
});

test('findMatches returns positions on the original text', () => {
    const { compiled } = compileRules([{ find: 'b' }]);
    assert.deepEqual(findMatches('a b c', compiled).map(m => [m.start, m.end]), [[2, 3]]);
});
