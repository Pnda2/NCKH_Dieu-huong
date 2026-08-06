export const DEFAULT_SCENE_3D = {
  planUnitsPerMeter: 40,
  floorHeightMeters: 3.2,
  floorExplodeMeters: 2,
  gridSizeMeters: 1,
};

export const AREA_3D_COLORS = {
  room: '#6ea8d9',
  junction: '#5db6a5',
  stairs: '#f4a261',
  exit: '#69b578',
};

export const AREA_3D_DEFAULTS = {
  room: { widthMeters: 2.4, depthMeters: 2.4, heightMeters: 2.7 },
  junction: { widthMeters: 1.9, depthMeters: 1.9, heightMeters: 0.6 },
  stairs: { widthMeters: 2.2, depthMeters: 3.2, heightMeters: 2.7 },
  exit: { widthMeters: 1.8, depthMeters: 1.4, heightMeters: 2.6 },
};

export const LANDING_SIDES = ['auto', 'front', 'right', 'back', 'left'];

export const sceneSettings = (scene = {}) => ({ ...DEFAULT_SCENE_3D, ...scene });

export function areaVisualKind(area = {}) {
  if (area.type === 'stairs') return 'stairs';
  if (area.type === 'exit') return 'exit';
  return area.visualKind === 'junction' ? 'junction' : 'room';
}

export function floorDisplayY(floor, floors = [], scene, activeFloor, floorView = 'focus') {
  const settings = sceneSettings(scene);
  const ordered = [...new Set(floors.length ? floors : [floor])].sort((a, b) => a - b);
  const floorIndex = Math.max(0, ordered.indexOf(floor));
  if (floorView !== 'overview') return 0;
  const activeIndex = Math.max(0, ordered.indexOf(activeFloor));
  return (floorIndex - activeIndex) * (settings.floorHeightMeters + settings.floorExplodeMeters);
}

export const visibleOnFloor = (area, activeFloor, floorView) => floorView === 'overview' || area.floor === activeFloor;
export const corridorDisplayWidth = (width) => Math.max(0.6, Math.min(2, Number(width) || 1.2));

export function visualForArea(area = {}) {
  const raw = area.visual3d || {};
  const kind = areaVisualKind(area);
  const defaults = AREA_3D_DEFAULTS[kind] || AREA_3D_DEFAULTS.room;
  const manual = raw.sizeMode === 'manual';
  const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  return {
    widthMeters: manual ? positive(raw.widthMeters, defaults.widthMeters) : defaults.widthMeters,
    depthMeters: manual ? positive(raw.depthMeters, defaults.depthMeters) : defaults.depthMeters,
    heightMeters: manual ? positive(raw.heightMeters, defaults.heightMeters) : defaults.heightMeters,
    rotationDegrees: Number.isFinite(Number(raw.rotationDegrees)) ? Number(raw.rotationDegrees) : 0,
    color: typeof raw.color === 'string' ? raw.color : (AREA_3D_COLORS[kind] || AREA_3D_COLORS.room),
    sizeMode: manual ? 'manual' : 'auto',
    kind,
  };
}

export function worldPosition(area, scene, activeFloor, floorView = 'focus', floors = []) {
  const settings = sceneSettings(scene);
  return [
    Number(area.x || 0) / settings.planUnitsPerMeter,
    floorDisplayY(Number(area.floor || 1), floors, settings, activeFloor, floorView),
    Number(area.y || 0) / settings.planUnitsPerMeter,
  ];
}

export function planPosition(x, z, scene, snap) {
  const settings = sceneSettings(scene);
  const snapValue = (value) => snap ? Math.round(value / settings.gridSizeMeters) * settings.gridSizeMeters : value;
  return { x: snapValue(x) * settings.planUnitsPerMeter, y: snapValue(z) * settings.planUnitsPerMeter };
}

export const isStairConnection = (areaA, areaB) => areaA?.type === 'stairs' && areaB?.type === 'stairs' && areaA.floor !== areaB.floor;
const yawRadians = (visual) => (Number(visual.rotationDegrees) || 0) * Math.PI / 180;
const sideVectors = { front: [0, -1], right: [1, 0], back: [0, 1], left: [-1, 0] };

function localToWorld(localX, localZ, yaw) {
  return [Math.cos(yaw) * localX + Math.sin(yaw) * localZ, -Math.sin(yaw) * localX + Math.cos(yaw) * localZ];
}

function worldToLocal(worldX, worldZ, yaw) {
  return [Math.cos(yaw) * worldX - Math.sin(yaw) * worldZ, Math.sin(yaw) * worldX + Math.cos(yaw) * worldZ];
}

export function sideForDirection(direction, rotationDegrees = 0) {
  const horizontal = Math.hypot(direction[0], direction[2]);
  if (horizontal < 0.0001) return 'front';
  const [x, z] = worldToLocal(direction[0] / horizontal, direction[2] / horizontal, rotationDegrees * Math.PI / 180);
  if (Math.abs(x) > Math.abs(z)) return x >= 0 ? 'right' : 'left';
  return z >= 0 ? 'back' : 'front';
}

export function junctionRadius(area) {
  const visual = visualForArea(area);
  return Math.max(0.65, Math.min(1.5, Math.max(visual.widthMeters, visual.depthMeters) / 2));
}

function portalOnFacingWall(center, visual, direction) {
  const horizontal = Math.hypot(direction[0], direction[2]);
  if (horizontal < 0.0001) return [center[0], center[1], center[2]];
  const yaw = yawRadians(visual);
  const worldX = direction[0] / horizontal;
  const worldZ = direction[2] / horizontal;
  const [localX, localZ] = worldToLocal(worldX, worldZ, yaw);
  const tx = Math.abs(localX) > 0.0001 ? visual.widthMeters / 2 / Math.abs(localX) : Infinity;
  const tz = Math.abs(localZ) > 0.0001 ? visual.depthMeters / 2 / Math.abs(localZ) : Infinity;
  const distance = Math.min(tx, tz);
  return [center[0] + worldX * distance, center[1], center[2] + worldZ * distance];
}

export function portalOnLandingSide(center, visual, side) {
  const [localX, localZ] = sideVectors[side] || sideVectors.front;
  const [worldX, worldZ] = localToWorld(localX, localZ, yawRadians(visual));
  const distance = localX ? visual.widthMeters / 2 : visual.depthMeters / 2;
  return [center[0] + worldX * distance, center[1], center[2] + worldZ * distance];
}

function stairwellForArea(area, options = {}) {
  return options.stairwells?.find((well) => well.id === area.stairwellId);
}

export function stairEntranceSide(area, toward, options = {}) {
  const well = stairwellForArea(area, options);
  const configured = well?.landingConfigs?.[area.id]?.entranceSide || 'auto';
  if (configured !== 'auto') return configured;
  const byId = options.areasById || {};
  const candidates = (options.corridors || []).flatMap((edge) => {
    const otherId = edge.areaA_id === area.id ? edge.areaB_id : edge.areaB_id === area.id ? edge.areaA_id : null;
    const other = otherId && byId[otherId];
    return other && other.floor === area.floor ? [other] : [];
  }).sort((left, right) => ((left.x - area.x) ** 2 + (left.y - area.y) ** 2) - ((right.x - area.x) ** 2 + (right.y - area.y) ** 2));
  const target = candidates[0];
  const direction = target
    ? [target.x - area.x, 0, target.y - area.y]
    : toward;
  return sideForDirection(direction, visualForArea(area).rotationDegrees);
}

export function portalForArea(area, center, direction, options = {}) {
  const visual = visualForArea(area);
  if (visual.kind === 'junction') {
    const horizontal = Math.hypot(direction[0], direction[2]) || 1;
    return [center[0] + direction[0] / horizontal * junctionRadius(area), center[1], center[2] + direction[2] / horizontal * junctionRadius(area)];
  }
  if (area.type === 'stairs') return portalOnLandingSide(center, visual, stairEntranceSide(area, direction, options));
  return portalOnFacingWall(center, visual, direction);
}

export function corridorGeometry(areaA, areaB, scene, activeFloor, floorView = 'focus', floors = [], options = {}) {
  const a = worldPosition(areaA, scene, activeFloor, floorView, floors);
  const b = worldPosition(areaB, scene, activeFloor, floorView, floors);
  const centreVector = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const horizontal = Math.hypot(centreVector[0], centreVector[2]);
  const fallbackYaw = yawRadians(visualForArea(areaA));
  const horizontalDirection = horizontal > 0.0001
    ? [centreVector[0] / horizontal, 0, centreVector[2] / horizontal]
    : [Math.sin(fallbackYaw), 0, Math.cos(fallbackYaw)];
  const start = portalForArea(areaA, a, horizontalDirection, options);
  const end = portalForArea(areaB, b, [-horizontalDirection[0], 0, -horizontalDirection[2]], options);
  const pathVector = [end[0] - start[0], b[1] - a[1], end[2] - start[2]];
  const clearLength = pathVector[0] * horizontalDirection[0] + pathVector[2] * horizontalDirection[2];
  const sameFloor = areaA.floor === areaB.floor;
  const direct = sameFloor && clearLength < 0.6;
  const vector = direct ? [horizontalDirection[0] * 0.34, 0, horizontalDirection[2] * 0.34] : pathVector;
  const centre = direct
    ? [start[0] + vector[0] / 2, a[1] + 0.14, start[2] + vector[2] / 2]
    : [(start[0] + end[0]) / 2, (a[1] + b[1]) / 2 + 0.14, (start[2] + end[2]) / 2];
  return {
    center: centre, start, end, vector,
    length: Math.max(0.34, Math.hypot(...vector)),
    horizontalDirection,
    yaw: Math.atan2(vector[0], vector[2]),
    sameFloor,
    direct,
  };
}

export function stairFlightLayout(well, lower, upper, scene, activeFloor, floors = [], options = {}) {
  const visual = well.visual3d || visualForArea(lower);
  const lowerPosition = worldPosition(lower, scene, activeFloor, 'overview', floors);
  const upperPosition = worldPosition(upper, scene, activeFloor, 'overview', floors);
  const rise = Math.max(0.5, upperPosition[1] - lowerPosition[1]);
  const steps = Math.max(12, Math.ceil(rise / 0.18 / 2) * 2);
  const lowerSide = stairEntranceSide(lower, [0, 0, -1], { ...options, stairwells: [well] });
  const upperSide = stairEntranceSide(upper, [0, 0, -1], { ...options, stairwells: [well] });
  const rotationBySide = { front: 0, right: -Math.PI / 2, back: Math.PI, left: Math.PI / 2 };
  return {
    lowerPosition,
    rise,
    steps,
    lowerSide,
    upperSide,
    localRotation: rotationBySide[lowerSide] || 0,
    run: Math.max(2.55, visual.depthMeters),
  };
}

export function stableUnit(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return ((hash >>> 0) % 100000) / 100000;
}

export function dotPlacement(edgeId, dotIndex, usableWidth) {
  const seed = `${edgeId}-${dotIndex}`;
  return {
    progress: stableUnit(`progress-${seed}`),
    lateral: (stableUnit(`lane-${seed}`) - 0.5) * usableWidth * 0.7,
    longitudinalJitter: (stableUnit(`jitter-${seed}`) - 0.5) * 0.16,
    heightJitter: stableUnit(`height-${seed}`) * 0.055,
  };
}

export function cameraPreset(command, bounds) {
  const span = Math.max(8, bounds.span);
  const target = [bounds.centerX, bounds.centerY || 0, bounds.centerZ];
  if (command === 'top') return { target, position: [target[0], target[1] + span * 2.15, target[2] + 0.02] };
  if (command === 'iso') return { target, position: [target[0] + span * 1.5, target[1] + span * 1.15, target[2] + span * 1.5] };
  return { target, position: [target[0] + span * 1.25, target[1] + span * 1.35, target[2] + span * 1.25] };
}
