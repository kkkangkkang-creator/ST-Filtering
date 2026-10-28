import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, mergeRules, normalizeSettings, parseImport, rulesFromLegacy } from '../src/settings.js';

test('converts every Word Filter settings shape', () => {
    assert.deepEqual(rulesFromLegacy({
        deleteRules: [{ text: 'very' }, 'old'],
        replaceRules: [{ from: 'smile', to: 'grin' }],
    }).map(rule => [rule.find, rule.replace]), [['smile', 'grin'], ['very', ''], ['old', '']]);
    assert.deepEqual(rulesFromLegacy({ deleteList: ['a'], replaceList: [{ from: 'b', to: 'c' }] }).map(rule => rule.find), ['b', 'a']);
    assert.deepEqual(rulesFromLegacy(null), []);
});

test('mergeRules skips duplicates, respecting case sensitivity', () => {
    const settings = defaultSettings();
    assert.equal(mergeRules(settings, [{ find: 'Very' }, { find: 'very' }, { find: ' ' }]), 1);
    settings.caseSensitive = true;
    assert.equal(mergeRules(settings, [{ find: 'very' }]), 1);
});

test('normalizeSettings drops bad values and keeps known ones', () => {
    const settings = normalizeSettings({ enabled: 'yes', includeCode: true, rules: [{ find: '' }, { find: ' x ', mode: 'nope' }] });
    assert.equal(settings.enabled, true);
    assert.equal(settings.includeCode, true);
    assert.deepEqual(settings.rules.map(rule => [rule.find, rule.mode]), [['x', 'auto']]);
});

test('parseImport recognises own exports, Word Filter backups, and rejects others', () => {
    assert.equal(parseImport(JSON.stringify({ format: 'st-filtering', settings: { rules: [{ find: 'a' }] } })).kind, 'settings');
    assert.equal(parseImport(JSON.stringify({ format: 'word-filter-backup', settings: { deleteRules: [{ text: 'a' }] } })).kind, 'legacy');
    assert.throws(() => parseImport('{}'));
});
