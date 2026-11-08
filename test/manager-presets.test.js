const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'manager.html'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'mobile/src/lib/manager-entries.ts'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const presetCode = script.slice(script.indexOf('const MANAGER_STATUSES'), script.indexOf('function renderPanel'));
const names = ['MANAGER_STATUSES', 'TENANT_UPDATE_PRESETS', 'INTERNAL_NOTE_PRESETS'];
const esc = str => String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function evaluate(code) {
  return vm.runInNewContext(`${code}\nJSON.stringify({${names.join(',')}})`);
}

test('web and mobile offer the same nine statuses and approved preset wording', () => {
  const mobileChoices = JSON.parse(evaluate(mobile.replace(/export const/g, 'const').replace(/ as const/g, '')));
  const webChoices = JSON.parse(evaluate(presetCode));
  assert.deepEqual(webChoices, mobileChoices);
  assert.equal(webChoices.MANAGER_STATUSES.length, 9);
  assert.equal(webChoices.TENANT_UPDATE_PRESETS.length, 7);
  assert.equal(webChoices.INTERNAL_NOTE_PRESETS.length, 6);
});

test('web presets fill only the target editable field without saving or sending', () => {
  const events = [];
  const fields = {
    'p-update': { value: 'Draft update', dispatchEvent: event => events.push(event.type) },
    'p-notes': { value: 'Private draft', dispatchEvent: event => events.push(event.type) },
  };
  const context = vm.createContext({
    document: { getElementById: id => fields[id] },
    Event: class { constructor(type) { this.type = type; } }, esc,
  });
  vm.runInContext(presetCode, context);
  context.select = { value: 'The technician is on the way.' };
  vm.runInContext("applyPreset(select, 'p-update')", context);
  assert.equal(fields['p-update'].value, 'The technician is on the way.');
  assert.equal(fields['p-notes'].value, 'Private draft');
  assert.equal(context.select.value, '');
  assert.deepEqual(events, ['input']);
  // Typing remains possible, and cancelling/choosing the placeholder preserves the draft.
  fields['p-update'].value += ' Please secure pets.';
  vm.runInContext("applyPreset(select, 'p-update')", context);
  assert.match(fields['p-update'].value, /Please secure pets/);
  context.select.value = 'Follow-up needed.';
  vm.runInContext("applyPreset(select, 'p-notes')", context);
  assert.equal(fields['p-notes'].value, 'Follow-up needed.');
});

test('dashboard JavaScript parses and preset options escape HTML in labels and values', () => {
  assert.doesNotThrow(() => new vm.Script(script));
  const result = vm.runInNewContext(`${presetCode}\npresetOptions(['<script>"&'])`, { esc });
  assert.ok(!result.includes('<script>'));
  assert.match(result, /&lt;script&gt;&quot;&amp;/);
  assert.match(html, /id="p-update-preset" onchange="applyPreset\(this, 'p-update'\)"/);
  assert.match(html, /id="p-notes-preset" onchange="applyPreset\(this, 'p-notes'\)"/);
});
