const test = require('node:test');
const assert = require('node:assert/strict');
const { hasInvalid3DValues, normalizeMapData, validateMapData } = require('./mapSchema');

test('v2 map infers a shared stairwell without mutating the input', () => {
  const legacy = {
    schemaVersion: 2,
    areas: [
      { id: 's1', type: 'stairs', x: 10, y: 20, floor: 1 },
      { id: 's2', type: 'stairs', x: 99, y: 88, floor: 2 },
      { id: 'room', type: 'room', x: 30, y: 30, floor: 1 },
    ],
    edges: [{ id: 'up', areaA_id: 's1', areaB_id: 's2', length: 10, widthMeters: 1.2 }],
  };
  const normalized = normalizeMapData(legacy);
  assert.equal(normalized.schemaVersion, 3);
  assert.equal(normalized.stairwells.length, 1);
  assert.deepEqual(normalized.stairwells[0].planAnchor, { x: 10, y: 20 });
  assert.equal(normalized.areas.find((area) => area.id === 's2').x, 10);
  assert.equal(normalized.areas.find((area) => area.id === 'room').visualKind, 'room');
  assert.equal(normalized.stairwells[0].landingConfigs.s1.entranceSide, 'auto');
  assert.equal(legacy.areas[1].x, 99);
});

test('visual roles and landing entrance sides are validated independently of routing type', () => {
  const valid = normalizeMapData({
    areas: [
      { id: 's1', type: 'stairs', x: 0, y: 0, floor: 1 }, { id: 's2', type: 'stairs', x: 0, y: 0, floor: 2 },
      { id: 'j', type: 'room', visualKind: 'junction', x: 30, y: 0, floor: 1 },
    ], edges: [], stairwells: [{ id: 'sw', areaIds: ['s1', 's2'], planAnchor: { x: 0, y: 0 }, visual3d: { widthMeters: 2, depthMeters: 3, rotationDegrees: 0 }, landingConfigs: { s1: { entranceSide: 'left' }, s2: { entranceSide: 'auto' } } }],
  });
  assert.equal(valid.areas.find((area) => area.id === 'j').visualKind, 'junction');
  assert.equal(validateMapData(valid), null);
  valid.stairwells[0].landingConfigs.s1.entranceSide = 'diagonal';
  assert.match(validateMapData(valid), /invalid landing entrance side/);
  assert.match(hasInvalid3DValues({ ...valid, stairwells: [{ ...valid.stairwells[0], landingConfigs: { ghost: { entranceSide: 'front' } } }] }), /non-member area/);
});

test('schema rejects stairwell with one floor or invalid geometry', () => {
  const map = normalizeMapData({
    areas: [{ id: 's1', type: 'stairs', x: 0, y: 0, floor: 1 }, { id: 's2', type: 'stairs', x: 0, y: 0, floor: 1 }],
    edges: [],
    stairwells: [{ id: 'bad', areaIds: ['s1', 's2'], planAnchor: { x: 0, y: 0 }, visual3d: { widthMeters: 2, depthMeters: 3, rotationDegrees: 0 } }],
  });
  assert.match(validateMapData(map), /at least two floors/);
});
