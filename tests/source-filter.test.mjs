import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine.js';
import { SOURCE_KEY, applyToSource, restoreSource } from '../src/source-filter.js';

const engine = createEngine({ rules: [{ find: 'very much' }, { find: 'mechanically' }] });

function swipedMessage() {
    return {
        mes: 'She smiled mechanically.',
        swipe_id: 1,
        swipes: ['I like it very much.', 'She smiled mechanically.'],
        swipe_info: [{ extra: {} }, { extra: {} }],
        extra: {},
    };
}

test('filters the shown variant and keeps the original next to it', () => {
    const message = swipedMessage();
    assert.equal(applyToSource(message, engine), true);
    assert.equal(message.mes, 'She smiled.');
    assert.equal(message.swipes[1], 'She smiled.');
    assert.equal(message.swipes[0], 'I like it very much.');
    assert.equal(message.extra[SOURCE_KEY].original, 'She smiled mechanically.');
    assert.equal(message.swipe_info[1].extra[SOURCE_KEY].original, 'She smiled mechanically.');
});

test('running twice or after a rule change starts from the original', () => {
    const message = swipedMessage();
    applyToSource(message, engine);
    assert.equal(applyToSource(message, engine), false);
    const other = createEngine({ rules: [{ find: 'smiled', replace: 'grinned' }] });
    applyToSource(message, other);
    assert.equal(message.mes, 'She grinned mechanically.');
    applyToSource(message, createEngine({ rules: [{ find: 'nothing' }] }));
    assert.equal(message.mes, 'She smiled mechanically.');
    assert.equal(message.extra[SOURCE_KEY], undefined);
});

test('an edited message becomes the new original', () => {
    const message = { mes: 'very much here', extra: {} };
    applyToSource(message, engine);
    message.mes = 'edited, very much';
    applyToSource(message, engine);
    assert.equal(message.mes, 'edited,');
    assert.equal(message.extra[SOURCE_KEY].original, 'edited, very much');
});

test('restore brings back every swipe, including ones not shown', () => {
    const message = swipedMessage();
    applyToSource(message, engine);
    // Swipe to 0, as SillyTavern does: swap in that swipe's extra, then filter it.
    message.swipe_id = 0;
    message.mes = message.swipes[0];
    message.extra = message.swipe_info[0].extra;
    applyToSource(message, engine);
    assert.deepEqual(message.swipes, ['I like it.', 'She smiled.']);

    const result = restoreSource(message);
    assert.deepEqual(result, { restored: 2, conflicts: 0, changed: true });
    assert.deepEqual(message.swipes, ['I like it very much.', 'She smiled mechanically.']);
    assert.equal(message.mes, 'I like it very much.');
    assert.equal(message.swipe_info[1].extra[SOURCE_KEY], undefined);
});

test('restore skips text changed after filtering', () => {
    const message = { mes: 'very much here', extra: {} };
    applyToSource(message, engine);
    message.mes = 'changed by hand';
    assert.deepEqual(restoreSource(message), { restored: 0, conflicts: 1, changed: false });
    assert.equal(message.mes, 'changed by hand');
});

test('messages without a match are left alone', () => {
    const message = { mes: 'nothing to do' };
    assert.equal(applyToSource(message, engine), false);
    assert.equal(message.extra, undefined);
});

test('restore works even if SillyTavern does not swap extra when swiping', () => {
    const message = swipedMessage();
    applyToSource(message, engine);
    // Show swipe 0 but keep swipe 1's extra in message.extra.
    message.swipe_id = 0;
    message.mes = message.swipes[0];
    applyToSource(message, engine);
    assert.deepEqual(message.swipes, ['I like it.', 'She smiled.']);
    assert.deepEqual(restoreSource(message), { restored: 2, conflicts: 0, changed: true });
    assert.deepEqual(message.swipes, ['I like it very much.', 'She smiled mechanically.']);
});
