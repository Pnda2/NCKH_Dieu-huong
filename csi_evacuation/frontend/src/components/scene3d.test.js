import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraPreset, corridorGeometry, dotPlacement, floorDisplayY, planPosition, portalForArea, stairEntranceSide, stairFlightLayout, visibleOnFloor } from './scene3d.js';
import { corridorDefaults, linkStairwell, syncStairwellUpdate, updateStairwellLanding } from './stairwells.js';

const scene = { planUnitsPerMeter: 40, floorHeightMeters: 3.2, floorExplodeMeters: 2, gridSizeMeters: 1 };

test('snap rounds while freeform preserves raw position', () => {
  assert.deepEqual(planPosition(1.24, 2.76, scene, true), { x: 40, y: 120 });
  const free = planPosition(1.24, 2.76, scene, false);
  assert.equal(free.x, 49.6);
  assert.ok(Math.abs(free.y - 110.4) < 1e-9);
});

test('focus visibility and overview display heights are deterministic', () => {
  assert.equal(visibleOnFloor({ floor: 1 }, 2, 'focus'), false);
  assert.equal(visibleOnFloor({ floor: 1 }, 2, 'overview'), true);
  assert.equal(floorDisplayY(2, [1, 2, 3], scene, 2, 'overview'), 0);
  assert.equal(floorDisplayY(3, [1, 2, 3], scene, 2, 'overview'), 5.2);
});

test('stairwell updates propagate anchor and shared geometry', () => {
  const areas = [{ id: 'a', type: 'stairs', floor: 1, x: 1, y: 2, stairwellId: 'sw' }, { id: 'b', type: 'stairs', floor: 2, x: 4, y: 5, stairwellId: 'sw' }];
  const updated = syncStairwellUpdate(areas, [{ id: 'sw', areaIds: ['a', 'b'], planAnchor: { x: 1, y: 2 }, visual3d: { widthMeters: 2.2, depthMeters: 3.2, rotationDegrees: 0 } }], { ...areas[0], x: 30, y: 40, visual3d: { widthMeters: 3, depthMeters: 4, rotationDegrees: 15 } });
  assert.deepEqual(updated.areas.map((area) => [area.x, area.y]), [[30, 40], [30, 40]]);
  assert.equal(updated.stairwells[0].visual3d.rotationDegrees, 15);
  const configured = updateStairwellLanding(updated.stairwells, 'sw', 'b', 'right');
  assert.equal(configured[0].landingConfigs.b.entranceSide, 'right');
});

test('junction portals are radial and stair portals honour auto/manual landing sides', () => {
  const junction = { id: 'j', type: 'room', visualKind: 'junction', floor: 1, x: 0, y: 0 };
  const room = { id: 'r', type: 'room', floor: 1, x: 200, y: 0 };
  const geometry = corridorGeometry(junction, room, scene, 1);
  assert.ok(geometry.start[0] > 0.6 && geometry.start[0] < 1.1);

  const stair = { id: 's', type: 'stairs', stairwellId: 'sw', floor: 1, x: 0, y: 0, visual3d: { sizeMode: 'manual', rotationDegrees: 0 } };
  const neighbour = { id: 'n', type: 'room', floor: 1, x: 0, y: -200 };
  const autoOptions = { stairwells: [{ id: 'sw', areaIds: ['s'], landingConfigs: { s: { entranceSide: 'auto' } } }], corridors: [{ areaA_id: 's', areaB_id: 'n' }], areasById: { s: stair, n: neighbour } };
  assert.equal(stairEntranceSide(stair, [1, 0, 0], autoOptions), 'front');
  const manualOptions = { ...autoOptions, stairwells: [{ id: 'sw', areaIds: ['s'], landingConfigs: { s: { entranceSide: 'right' } } }] };
  assert.equal(stairEntranceSide(stair, [0, 0, -1], manualOptions), 'right');
  assert.ok(portalForArea(stair, [0, 0, 0], [0, 0, -1], manualOptions)[0] > 1);
});

test('shared stair flight uses the configured landing entrance, not a fixed axis', () => {
  const lower = { id: 'low', type: 'stairs', stairwellId: 'sw', floor: 1, x: 0, y: 0 };
  const upper = { id: 'up', type: 'stairs', stairwellId: 'sw', floor: 2, x: 0, y: 0 };
  const well = { id: 'sw', planAnchor: { x: 0, y: 0 }, visual3d: { widthMeters: 2.2, depthMeters: 3.2, rotationDegrees: 0 }, landingConfigs: { low: { entranceSide: 'right' }, up: { entranceSide: 'left' } } };
  const layout = stairFlightLayout(well, lower, upper, scene, 1, [1, 2]);
  assert.equal(layout.lowerSide, 'right');
  assert.equal(layout.upperSide, 'left');
  assert.equal(layout.localRotation, -Math.PI / 2);
});

test('corridor geometry ignores operational length and defaults stay estimated', () => {
  const left = { id: 'a', type: 'room', floor: 1, x: 0, y: 0 };
  const right = { id: 'b', type: 'room', floor: 1, x: 240, y: 0 };
  assert.equal(corridorGeometry(left, right, scene, 1).length, corridorGeometry(left, right, scene, 1).length);
  assert.deepEqual(corridorDefaults(), { length: 10, lengthEstimated: true, widthMeters: 1.2, widthEstimated: true });
  assert.equal(linkStairwell([left, right], [], 'a', 'b', () => 'new').stairwells.length, 0);
});

test('dot placement is stable and stays inside the usable corridor width', () => {
  const first = dotPlacement('edge-a', 4, 1.4);
  assert.deepEqual(first, dotPlacement('edge-a', 4, 1.4));
  assert.notEqual(first.lateral, 0);
  assert.ok(Math.abs(first.lateral) <= 1.4 * 0.35);
  assert.ok(first.heightJitter >= 0 && first.heightJitter <= 0.055);
});

test('fit, isometric and top camera presets are distinct', () => {
  const bounds = { centerX: 4, centerY: 0, centerZ: -2, span: 10 };
  const fit = cameraPreset('fit', bounds);
  const iso = cameraPreset('iso', bounds);
  const top = cameraPreset('top', bounds);
  assert.notDeepEqual(fit.position, iso.position);
  assert.notDeepEqual(iso.position, top.position);
  assert.deepEqual(fit.target, [4, 0, -2]);
});
