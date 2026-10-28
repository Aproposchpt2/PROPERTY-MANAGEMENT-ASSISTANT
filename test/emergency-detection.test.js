'use strict';

// Tests for the emergency-detection regex used in pma_voice_incident_create_v1.
// The JS regex mirrors the PostgreSQL POSIX pattern (case-insensitive ~*).
// Over-flagging is acceptable; missing an emergency is not.

const test = require('node:test');
const assert = require('node:assert/strict');

const EMERGENCY_RE = new RegExp(
  '(' +
  'smell(s|ed|ing)?(\\s+(of\\s+|like\\s+))?gas|' +
  'gas\\s+(smell|odor|leak)|' +
  'odor\\s+of\\s+gas|' +
  'fire|smoke|' +
  'carbon\\s+monoxide|' +
  'co\\s+(alarm|detector)|' +
  'spark(s|ing)?|' +
  'electrical\\s+(hazard|danger|fire)|' +
  'exposed\\s+wires?|' +
  'flood(ing|ed)?|' +
  'burst\\s+pipe|' +
  'water\\s+leak|' +
  'leak(ing)?|' +
  'sewage|' +
  'sewer\\s+back|' +
  'no\\s+(heat|water|power|electricity)|' +
  'without\\s+(heat|water|power)|' +
  'immediate\\s+(threat|danger)|' +
  '(huele|olor|oler)\\s+a\\s+gas|' +
  'fuga\\s+de\\s+gas|' +
  'gas|' +
  'incendio|fuego|humo|' +
  'mon[oó]xido|' +
  'chispas?|cortocircuito|' +
  'cables?\\s+expuestos?|' +
  'inundaci[oó]n|' +
  'inundad[oa]|' +
  'fuga\\s+de\\s+agua|' +
  'tuber[ií]a\\s+rota|' +
  'aguas?\\s+negras|' +
  'sin\\s+(calefacci[oó]n|agua|luz|electricidad)|' +
  'peligro' +
  ')',
  'i'
);

const urgent = (text) => EMERGENCY_RE.test(text);

// ── Phrases that MUST flag as urgent ──────────────────────────────────────────

test('EN: smelled gas flags urgent', () => {
  assert.ok(urgent('I came from work and I entered my apartment and I smelled gas'));
});

test('EN: gas smell flags urgent', () => {
  assert.ok(urgent("there's a gas smell in the hallway"));
});

test('EN: leaking flags urgent', () => {
  assert.ok(urgent('water is leaking from the ceiling'));
});

test('EN: no heat flags urgent', () => {
  assert.ok(urgent('we have no heat'));
});

test('ES: huele a gas flags urgent', () => {
  assert.ok(urgent('huele a gas en mi cocina'));
});

test('ES: fuga de agua flags urgent', () => {
  assert.ok(urgent('tengo una fuga de agua'));
});

test('ES: humo flags urgent', () => {
  assert.ok(urgent('hay humo en el pasillo'));
});

// ── Phrases that must NOT flag as urgent ──────────────────────────────────────

test('EN: slow drain is not urgent', () => {
  assert.ok(!urgent('my sink drains slowly'));
});

test('EN: door off hinge is not urgent', () => {
  assert.ok(!urgent('the closet door is off its hinge'));
});

test('ES: door does not close is not urgent', () => {
  assert.ok(!urgent('mi puerta no cierra bien'));
});

// ── Additional coverage ───────────────────────────────────────────────────────

test('EN: fire flags urgent', () => { assert.ok(urgent('there is a fire in the lobby')); });
test('EN: burst pipe flags urgent', () => { assert.ok(urgent('a burst pipe flooded the unit')); });
test('EN: carbon monoxide flags urgent', () => { assert.ok(urgent('carbon monoxide detector is alarming')); });
test('EN: no water flags urgent', () => { assert.ok(urgent('I have no water at all')); });
test('EN: electrical hazard flags urgent', () => { assert.ok(urgent('there is an electrical hazard near the panel')); });
test('ES: incendio flags urgent', () => { assert.ok(urgent('hay un incendio en el pasillo')); });
test('ES: sin agua flags urgent', () => { assert.ok(urgent('llevamos tres dias sin agua')); });
test('ES: inundacion (no accent) flags urgent', () => { assert.ok(urgent('hay una inundacion en el sotano')); });
test('ES: inundación (with accent) flags urgent', () => { assert.ok(urgent('hay una inundación en el sotano')); });
test('ES: fuga de gas flags urgent', () => { assert.ok(urgent('sospecho una fuga de gas en la cocina')); });
test('ES: peligro flags urgent', () => { assert.ok(urgent('hay peligro en el edificio')); });
