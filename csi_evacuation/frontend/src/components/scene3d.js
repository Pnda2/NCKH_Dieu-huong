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
export const MAX_OVERVIEW_GAP_METERS = 0.45;
export const WALK_SURFACE_Y = 0.19;

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
  const overviewGap = Math.min(MAX_OVERVIEW_GAP_METERS, Math.max(0, Number(settings.floorExplodeMeters) || 0));
  return (floorIndex - activeIndex) * (settings.floorHeightMeters + overviewGap);
}

export function structuralFloorY(floor, floors = [], scene, activeFloor) {
  const settings = sceneSettings(scene);
  const ordered = [...new Set(floors.length ? floors : [floor])].sort((a, b) => a - b);
  return (Math.max(0, ordered.indexOf(floor)) - Math.max(0, ordered.indexOf(activeFloor))) * settings.floorHeightMeters;
}

export const visibleOnFloor = (area, activeFloor, floorView) => floorView === 'overview' || area.floor === activeFloor;
export const corridorDisplayWidth = (width) => Math.max(0.6, Math.min(2, Number(width) || 1.2));
export const portalOpeningWidth = (corridorWidth) => Math.max(.7, Math.min(1.35, corridorDisplayWidth(corridorWidth) - .04));

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
const sideLengths = (visual, side) => side === 'front' || side === 'back' ? visual.widthMeters : visual.depthMeters;

function localToWorld(localX, localZ, yaw) {
  return [Math.cos(yaw) * localX + Math.sin(yaw) * localZ, -Math.sin(yaw) * localX + Math.cos(yaw) * localZ];
}

function worldToLocal(worldX, worldZ, yaw) {
  return [Math.cos(yaw) * worldX - Math.sin(yaw) * worldZ, Math.sin(yaw) * worldX + Math.cos(yaw) * worldZ];
}

function placementFromVisual(visual, center, portal, width = 1) {
  const [localX, localZ] = worldToLocal(portal[0] - center[0], portal[2] - center[2], yawRadians(visual));
  const faces = [
    { side: 'right', distance: Math.abs(localX - visual.widthMeters / 2), normal: [1, 0], tangent: [0, 1], offset: localZ, local: [visual.widthMeters / 2, localZ] },
    { side: 'left', distance: Math.abs(localX + visual.widthMeters / 2), normal: [-1, 0], tangent: [0, -1], offset: -localZ, local: [-visual.widthMeters / 2, localZ] },
    { side: 'back', distance: Math.abs(localZ - visual.depthMeters / 2), normal: [0, 1], tangent: [-1, 0], offset: -localX, local: [localX, visual.depthMeters / 2] },
    { side: 'front', distance: Math.abs(localZ + visual.depthMeters / 2), normal: [0, -1], tangent: [1, 0], offset: localX, local: [localX, -visual.depthMeters / 2] },
  ];
  const face = faces.reduce((best, current) => current.distance < best.distance ? current : best);
  const [worldNormalX, worldNormalZ] = localToWorld(face.normal[0], face.normal[1], yawRadians(visual));
  const [worldTangentX, worldTangentZ] = localToWorld(face.tangent[0], face.tangent[1], yawRadians(visual));
  const [worldX, worldZ] = localToWorld(face.local[0], face.local[1], yawRadians(visual));
  const openingWidth = portalOpeningWidth(width);
  return {
    side: face.side, offset: face.offset, width: openingWidth, openingWidth, endpointKind: 'doorway',
    localCenter: [face.local[0], face.local[1]], localTangent: face.tangent,
    center: [center[0] + worldX, portal[1], center[2] + worldZ],
    wallNormal: [worldNormalX, 0, worldNormalZ], wallTangent: [worldTangentX, 0, worldTangentZ],
  };
}

export function roomPortalDescriptor(visual, center, portal, width = 1) {
  return placementFromVisual(visual, center, portal, width);
}

export function portalPlacement(area, center, portal, width = 1, edgeId, endpoint = 'start') {
  const visual = visualForArea(area);
  if (visual.kind === 'junction') {
    const dx = portal[0] - center[0]; const dz = portal[2] - center[2]; const length = Math.hypot(dx, dz) || 1;
    const normal = [dx / length, 0, dz / length];
    return {
      areaId: area.id, edgeId, endpoint, side: null, offset: 0, width: corridorDisplayWidth(width), openingWidth: corridorDisplayWidth(width), endpointKind: 'junction',
      center: [portal[0], portal[1], portal[2]], wallNormal: normal, wallTangent: [-normal[2], 0, normal[0]],
    };
  }
  return { ...placementFromVisual(visual, center, portal, width), areaId: area.id, edgeId, endpoint };
}

function mergedOpenings(openings) {
  return openings.sort((left, right) => left.start - right.start).reduce((merged, opening) => {
    const previous = merged[merged.length - 1];
    if (previous && opening.start <= previous.end + .08) previous.end = Math.max(previous.end, opening.end);
    else merged.push({ ...opening });
    return merged;
  }, []);
}

// Wall panels are described in local room coordinates.  A portal only cuts a
// door-size opening in its own wall; all other room sides stay architecturally closed.
export function roomWallLayout(visual, portals = []) {
  return ['front', 'right', 'back', 'left'].flatMap((side) => {
    const sideLength = sideLengths(visual, side);
    const openings = mergedOpenings(portals.filter((portal) => portal.side === side).map((portal) => ({
      start: Math.max(-sideLength / 2 + .12, portal.offset - (portal.openingWidth || portal.width) / 2),
      end: Math.min(sideLength / 2 - .12, portal.offset + (portal.openingWidth || portal.width) / 2),
    })).filter((opening) => opening.end - opening.start > .08));
    const sections = [];
    let cursor = -sideLength / 2;
    openings.forEach((opening) => {
      if (opening.start - cursor > .08) sections.push({ side, offset: (cursor + opening.start) / 2, length: opening.start - cursor });
      cursor = Math.max(cursor, opening.end);
    });
    if (sideLength / 2 - cursor > .08) sections.push({ side, offset: (cursor + sideLength / 2) / 2, length: sideLength / 2 - cursor });
    return sections;
  });
}

export function corridorEndpointKind(area = {}) {
  return areaVisualKind(area) === 'junction' ? 'junction' : 'threshold';
}

export function createAreaPortalRegistry(placements = []) {
  const byArea = {};
  const byEdgeEndpoint = {};
  placements.filter((placement) => placement.endpointKind === 'doorway').forEach((placement) => {
    byArea[placement.areaId] = [...(byArea[placement.areaId] || []), placement];
  });
  Object.entries(byArea).forEach(([areaId, members]) => {
    const assemblies = [];
    [...members].sort((left, right) => left.side.localeCompare(right.side) || left.offset - right.offset).forEach((member) => {
      const start = member.offset - member.openingWidth / 2; const end = member.offset + member.openingWidth / 2;
      const prior = assemblies.find((item) => item.side === member.side && start <= item.end + .08 && end >= item.start - .08);
      if (prior) {
        prior.start = Math.min(prior.start, start); prior.end = Math.max(prior.end, end); prior.members.push(member);
      } else assemblies.push({ ...member, start, end, members: [member] });
    });
    byArea[areaId] = assemblies.map((assembly, index) => {
      const offset = (assembly.start + assembly.end) / 2;
      const shift = offset - assembly.offset;
      const center = [assembly.center[0] + assembly.wallTangent[0] * shift, assembly.center[1], assembly.center[2] + assembly.wallTangent[2] * shift];
      const localCenter = [assembly.localCenter[0] + assembly.localTangent[0] * shift, assembly.localCenter[1] + assembly.localTangent[1] * shift];
      const normalized = { ...assembly, id: `${areaId}-${assembly.side}-${index}`, offset, openingWidth: assembly.end - assembly.start, width: assembly.end - assembly.start, center, localCenter };
      assembly.members.forEach((member) => { byEdgeEndpoint[`${member.edgeId}:${member.endpoint}`] = normalized; });
      return normalized;
    });
  });
  return { byArea, byEdgeEndpoint };
}

export function portalThroatGeometry(placement, outwardDirection, corridorWidth, bleed = .11, depth = .34) {
  const outwardLength = Math.hypot(outwardDirection[0], outwardDirection[2]) || 1;
  const outward = [outwardDirection[0] / outwardLength, 0, outwardDirection[2] / outwardLength];
  const spineTangent = [-outward[2], 0, outward[0]];
  const mouthCenter = [placement.center[0] - outward[0] * bleed, placement.center[1], placement.center[2] - outward[2] * bleed];
  const spineCenter = [placement.center[0] + outward[0] * depth, placement.center[1], placement.center[2] + outward[2] * depth];
  const mouthHalf = placement.openingWidth / 2; const spineHalf = Math.max(.14, (corridorDisplayWidth(corridorWidth) - .16) / 2);
  const point = (center, tangent, scale) => [center[0] + tangent[0] * scale, center[1], center[2] + tangent[2] * scale];
  return {
    mouthCenter, spineCenter,
    mouthLeft: point(mouthCenter, placement.wallTangent, -mouthHalf), mouthRight: point(mouthCenter, placement.wallTangent, mouthHalf),
    spineLeft: point(spineCenter, spineTangent, -spineHalf), spineRight: point(spineCenter, spineTangent, spineHalf),
  };
}

export function portalInteriorExtension(area, placement, outwardDirection, corridorWidth, maximumDepth = .6, margin = .12) {
  if (placement?.endpointKind !== 'doorway') return null;
  const visual = visualForArea(area);
  const outwardLength = Math.hypot(outwardDirection[0], outwardDirection[2]) || 1;
  const inwardWorld = [-outwardDirection[0] / outwardLength, -outwardDirection[2] / outwardLength];
  const [inwardX, inwardZ] = worldToLocal(inwardWorld[0], inwardWorld[1], yawRadians(visual));
  const [localX, localZ] = placement.localCenter || [0, 0];
  const candidates = [
    inwardX > .0001 ? (visual.widthMeters / 2 - localX) / inwardX : Infinity,
    inwardX < -.0001 ? (-visual.widthMeters / 2 - localX) / inwardX : Infinity,
    inwardZ > .0001 ? (visual.depthMeters / 2 - localZ) / inwardZ : Infinity,
    inwardZ < -.0001 ? (-visual.depthMeters / 2 - localZ) / inwardZ : Infinity,
  ].filter((value) => value > 0);
  const available = candidates.length ? Math.min(...candidates) : 0;
  const bleed = .11;
  const depth = Math.min(maximumDepth, Math.max(0, available - margin - bleed));
  if (depth < .16) return null;
  const throat = portalThroatGeometry(placement, outwardDirection, corridorWidth, bleed, .34);
  const corridorTangent = [-outwardDirection[2] / outwardLength, 0, outwardDirection[0] / outwardLength];
  const innerCenter = [throat.mouthCenter[0] + inwardWorld[0] * depth, throat.mouthCenter[1], throat.mouthCenter[2] + inwardWorld[1] * depth];
  const innerHalf = Math.min(Math.max(.14, (placement.openingWidth - .1) / 2), Math.max(.14, (corridorDisplayWidth(corridorWidth) - .16) / 2));
  return {
    depth,
    points: [
      throat.mouthLeft,
      throat.mouthRight,
      [innerCenter[0] + corridorTangent[0] * innerHalf, innerCenter[1], innerCenter[2] + corridorTangent[2] * innerHalf],
      [innerCenter[0] - corridorTangent[0] * innerHalf, innerCenter[1], innerCenter[2] - corridorTangent[2] * innerHalf],
    ],
  };
}

export function corridorLayout(geometry, corridorWidth, startKind = 'threshold', endKind = 'threshold') {
  const width = corridorDisplayWidth(corridorWidth);
  const startWidth = startKind === 'junction' ? width : portalOpeningWidth(width);
  const endWidth = endKind === 'junction' ? width : portalOpeningWidth(width);
  if (geometry.direct) return { kind: 'bridge', width, startWidth, endWidth, mainLength: 0, startThroat: 0, endThroat: 0 };
  const throatBudget = Math.max(0, geometry.length - .34);
  const startThroat = Math.min(.36, throatBudget / 2);
  const endThroat = Math.min(.36, throatBudget - startThroat);
  return {
    kind: 'corridor', width, startWidth, endWidth,
    startThroat, endThroat,
    mainLength: Math.max(.12, geometry.length - startThroat - endThroat),
  };
}

export function junctionOperationalState(areaId, corridors = [], metrics = {}, blockedEdges = []) {
  const blocked = new Set(blockedEdges || []);
  const related = corridors.filter((edge) => edge.areaA_id === areaId || edge.areaB_id === areaId);
  const ranked = related.map((edge) => {
    const metric = metrics?.[edge.id] || {};
    const ratio = Number(metric.occupancyRatio ?? metric.filtered_k ?? 0);
    const score = blocked.has(edge.id) || metric.blocked || metric.hazard >= 100 ? 10000
      : metric.hazard > 0 ? 5000 + Number(metric.hazard)
        : metric.sensorStatus === 'UNKNOWN' || metric.sensorStatus === 'STALE' ? 4000
          : Math.max(0, ratio) * 1000;
    return { metric, blocked: blocked.has(edge.id) || Boolean(metric.blocked), score };
  }).sort((left, right) => right.score - left.score);
  return ranked[0] || { metric: null, blocked: false, score: 0 };
}

export function stairwellCoreModels(stairwells = [], areasById = {}) {
  const seen = new Set();
  return stairwells.flatMap((well) => {
    if (!well?.id || seen.has(well.id)) return [];
    seen.add(well.id);
    const members = (well.areaIds || []).map((id) => areasById[id]).filter(Boolean).sort((left, right) => left.floor - right.floor);
    return members.length ? [{ ...well, members }] : [];
  });
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
  const structuralRise = Math.max(.5, Math.abs(structuralFloorY(upper.floor, floors, scene, activeFloor) - structuralFloorY(lower.floor, floors, scene, activeFloor)));
  const rise = Math.max(0.5, upperPosition[1] - lowerPosition[1]);
  const steps = Math.max(12, Math.ceil(structuralRise / .18 / 2) * 2);
  const lowerSide = stairEntranceSide(lower, [0, 0, -1], { ...options, stairwells: [well] });
  const upperSide = stairEntranceSide(upper, [0, 0, -1], { ...options, stairwells: [well] });
  const rotationBySide = { front: 0, right: -Math.PI / 2, back: Math.PI, left: Math.PI / 2 };
  return {
    lowerPosition,
    rise,
    structuralRise,
    overviewGap: Math.max(0, rise - structuralRise),
    steps,
    stepRise: structuralRise / steps,
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
