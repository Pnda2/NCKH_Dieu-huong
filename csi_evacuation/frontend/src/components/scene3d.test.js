import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraPreset, corridorEndpointKind, corridorGeometry, corridorLayout, createAreaPortalRegistry, dotPlacement, floorDisplayY, junctionOperationalState, planPosition, portalForArea, portalInteriorExtension, portalOpeningWidth, portalPlacement, portalThroatGeometry, roomPortalDescriptor, roomWallLayout, stairEntranceSide, stairFlightLayout, stairwellCoreModels, structuralFloorY, visibleOnFloor, WALK_SURFACE_Y, worldPosition } from './scene3d.js';
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
  assert.ok(Math.abs(floorDisplayY(3, [1, 2, 3], scene, 2, 'overview') - 3.65) < 1e-9);
  assert.equal(structuralFloorY(3, [1, 2, 3], scene, 2), 3.2);
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

test('four room walls remain closed except for their own doorway portals', () => {
  const visual = { widthMeters: 4, depthMeters: 3, rotationDegrees: 0 };
  const closed = roomWallLayout(visual);
  assert.equal(closed.length, 4);
  assert.deepEqual(new Set(closed.map((panel) => panel.side)), new Set(['front', 'right', 'back', 'left']));
  const frontDoor = roomPortalDescriptor(visual, [0, 0, 0], [0, 0, -1.5], 1);
  assert.equal(frontDoor.openingWidth, portalOpeningWidth(1));
  assert.equal(frontDoor.width, frontDoor.openingWidth);
  const withDoor = roomWallLayout(visual, [frontDoor]);
  assert.equal(withDoor.filter((panel) => panel.side === 'front').length, 2);
  assert.equal(withDoor.filter((panel) => panel.side === 'back').length, 1);
});

test('rotated room portal keeps the exact wall offset used by the corridor', () => {
  const rotated = { id: 'rotated', type: 'room', floor: 1, x: 0, y: 0, visual3d: { sizeMode: 'manual', widthMeters: 4, depthMeters: 3, rotationDegrees: 30 } };
  const target = { id: 'target', type: 'room', floor: 1, x: 320, y: 80 };
  const geometry = corridorGeometry(rotated, target, scene, 1);
  const placement = portalPlacement(rotated, worldPosition(rotated, scene, 1), geometry.start, 1.2, 'edge', 'start');
  assert.ok(Math.abs(placement.center[0] - geometry.start[0]) < 1e-9);
  assert.ok(Math.abs(placement.center[2] - geometry.start[2]) < 1e-9);
  assert.ok(Math.abs(placement.localCenter[0]) > .05 || Math.abs(placement.localCenter[1]) > .05);
});

test('portal registry creates doorways for areas but never for junctions', () => {
  const room = { id: 'room', type: 'room', floor: 1, x: 0, y: 0 };
  const junction = { id: 'junction', type: 'room', visualKind: 'junction', floor: 1, x: 200, y: 0 };
  const geometry = corridorGeometry(room, junction, scene, 1);
  const start = portalPlacement(room, worldPosition(room, scene, 1), geometry.start, 1.2, 'edge', 'start');
  const end = portalPlacement(junction, worldPosition(junction, scene, 1), geometry.end, 1.2, 'edge', 'end');
  const registry = createAreaPortalRegistry([start, end]);
  assert.equal(registry.byArea.room.length, 1);
  assert.equal(registry.byArea.junction, undefined);
  assert.equal(registry.byEdgeEndpoint['edge:start'].id, registry.byArea.room[0].id);
});

test('skew throat begins on the door tangent and ends across the corridor spine', () => {
  const visual = { widthMeters: 4, depthMeters: 3, rotationDegrees: 25 };
  const placement = roomPortalDescriptor(visual, [0, 0, 0], [1.9, 0, .5], 1.2);
  const throat = portalThroatGeometry(placement, [1, 0, .3], 1.2);
  const mouthEdge = [throat.mouthRight[0] - throat.mouthLeft[0], throat.mouthRight[2] - throat.mouthLeft[2]];
  const spineEdge = [throat.spineRight[0] - throat.spineLeft[0], throat.spineRight[2] - throat.spineLeft[2]];
  assert.ok(Math.abs(mouthEdge[0] * placement.wallNormal[0] + mouthEdge[1] * placement.wallNormal[2]) < 1e-9);
  assert.ok(Math.abs(spineEdge[0] * 1 + spineEdge[1] * .3) < 1e-9);
});

test('corridor extension enters a room but stops before its opposite wall', () => {
  const room = { id: 'room', type: 'room', floor: 1, x: 0, y: 0, visual3d: { sizeMode: 'manual', widthMeters: 2.4, depthMeters: 2.4, rotationDegrees: 0 } };
  const other = { id: 'other', type: 'room', floor: 1, x: 240, y: 40 };
  const geometry = corridorGeometry(room, other, scene, 1);
  const placement = portalPlacement(room, worldPosition(room, scene, 1), geometry.start, 1.2, 'edge', 'start');
  const extension = portalInteriorExtension(room, placement, geometry.horizontalDirection, 1.2);
  assert.ok(extension && extension.depth >= .16 && extension.depth <= .6);
  const innerMidpoint = [(extension.points[2][0] + extension.points[3][0]) / 2, (extension.points[2][2] + extension.points[3][2]) / 2];
  const inwardDot = (innerMidpoint[0] - placement.center[0]) * geometry.horizontalDirection[0] + (innerMidpoint[1] - placement.center[2]) * geometry.horizontalDirection[2];
  assert.ok(inwardDot < 0);
  assert.equal(WALK_SURFACE_Y, .19);
});

test('corridor layout uses room-owned portal widths and a door-free short bridge', () => {
  const left = { id: 'a', type: 'room', floor: 1, x: 0, y: 0 };
  const right = { id: 'b', type: 'room', floor: 1, x: 240, y: 0 };
  const regular = corridorLayout(corridorGeometry(left, right, scene, 1), 1.2, 'threshold', 'junction');
  assert.equal(regular.startWidth, portalOpeningWidth(1.2));
  assert.equal(regular.endWidth, 1.2);
  assert.ok(regular.startThroat > 0 && regular.endThroat > 0);
  const direct = corridorLayout({ direct: true, length: .34 }, 1.2, 'threshold', 'threshold');
  assert.equal(direct.kind, 'bridge');
  assert.equal(direct.mainLength, 0);
});

test('junction state takes blocked and hazard edges before occupancy', () => {
  const edges = [{ id: 'low', areaA_id: 'j', areaB_id: 'a' }, { id: 'hazard', areaA_id: 'j', areaB_id: 'b' }, { id: 'blocked', areaA_id: 'c', areaB_id: 'j' }];
  const metrics = { low: { occupancyRatio: .9 }, hazard: { hazard: 10 }, blocked: { occupancyRatio: 0 } };
  assert.equal(junctionOperationalState('j', edges, metrics).metric.hazard, 10);
  assert.equal(junctionOperationalState('j', edges, metrics, ['blocked']).blocked, true);
});

test('only junction endpoints use circular connector treatment', () => {
  assert.equal(corridorEndpointKind({ type: 'room' }), 'threshold');
  assert.equal(corridorEndpointKind({ type: 'stairs' }), 'threshold');
  assert.equal(corridorEndpointKind({ type: 'room', visualKind: 'junction' }), 'junction');
});

test('overview creates one shared stair core per stairwell anchor', () => {
  const areasById = {
    low: { id: 'low', floor: 1, type: 'stairs' },
    high: { id: 'high', floor: 2, type: 'stairs' },
  };
  const cores = stairwellCoreModels([
    { id: 'sw', areaIds: ['high', 'low'], planAnchor: { x: 12, y: 18 } },
    { id: 'sw', areaIds: ['low', 'high'], planAnchor: { x: 12, y: 18 } },
  ], areasById);
  assert.equal(cores.length, 1);
  assert.deepEqual(cores[0].planAnchor, { x: 12, y: 18 });
  assert.deepEqual(cores[0].members.map((area) => area.id), ['low', 'high']);
});

test('shared stair flight uses the configured landing entrance, not a fixed axis', () => {
  const lower = { id: 'low', type: 'stairs', stairwellId: 'sw', floor: 1, x: 0, y: 0 };
  const upper = { id: 'up', type: 'stairs', stairwellId: 'sw', floor: 2, x: 0, y: 0 };
  const well = { id: 'sw', planAnchor: { x: 0, y: 0 }, visual3d: { widthMeters: 2.2, depthMeters: 3.2, rotationDegrees: 0 }, landingConfigs: { low: { entranceSide: 'right' }, up: { entranceSide: 'left' } } };
  const layout = stairFlightLayout(well, lower, upper, scene, 1, [1, 2]);
  assert.equal(layout.lowerSide, 'right');
  assert.equal(layout.upperSide, 'left');
  assert.equal(layout.localRotation, -Math.PI / 2);
  assert.equal(layout.structuralRise, 3.2);
  assert.ok(Math.abs(layout.stepRise - (3.2 / layout.steps)) < 1e-9);
  assert.ok(layout.overviewGap <= .45 + 1e-9);
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
