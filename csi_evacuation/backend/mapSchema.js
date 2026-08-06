const DEFAULT_SCENE_3D = { planUnitsPerMeter: 40, floorHeightMeters: 3.2, floorExplodeMeters: 2, gridSizeMeters: 1 };
const AREA_3D_COLORS = { room: '#6ea8d9', stairs: '#f4a261', exit: '#69b578' };
const AREA_3D_DEFAULTS = {
  room: { widthMeters: 2.4, depthMeters: 2.4, heightMeters: 2.7 },
  junction: { widthMeters: 1.9, depthMeters: 1.9, heightMeters: 0.6 },
  stairs: { widthMeters: 2.2, depthMeters: 3.2, heightMeters: 2.7 },
  exit: { widthMeters: 1.8, depthMeters: 1.4, heightMeters: 2.6 },
};
const LANDING_SIDES = new Set(['auto', 'front', 'right', 'back', 'left']);
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const finite = (value) => Number.isFinite(Number(value));

function normalizedVisualKind(area = {}) {
  if (area.type === 'stairs') return 'stairs';
  if (area.type === 'exit') return 'exit';
  return area.visualKind === 'junction' ? 'junction' : 'room';
}

function normalizeLandingConfigs(areaIds, incoming = {}) {
  return Object.fromEntries(areaIds.map((areaId) => [areaId, {
    entranceSide: LANDING_SIDES.has(incoming?.[areaId]?.entranceSide)
      ? incoming[areaId].entranceSide
      : 'auto',
  }]));
}

function inferStairwells(areas, edges) {
  const byId = new Map(areas.map((area) => [area.id, area]));
  const adjacent = new Map();
  for (const edge of edges) {
    const left = byId.get(edge.areaA_id);
    const right = byId.get(edge.areaB_id);
    if (!left || !right || left.type !== 'stairs' || right.type !== 'stairs' || left.floor === right.floor) continue;
    if (!adjacent.has(left.id)) adjacent.set(left.id, new Set());
    if (!adjacent.has(right.id)) adjacent.set(right.id, new Set());
    adjacent.get(left.id).add(right.id);
    adjacent.get(right.id).add(left.id);
  }
  const seen = new Set();
  const stairwells = [];
  for (const startId of adjacent.keys()) {
    if (seen.has(startId)) continue;
    const queue = [startId];
    const ids = [];
    seen.add(startId);
    while (queue.length) {
      const id = queue.shift();
      ids.push(id);
      for (const next of adjacent.get(id) || []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    const members = ids.map((id) => byId.get(id)).sort((a, b) => (a.floor - b.floor) || a.id.localeCompare(b.id));
    const anchor = members[0];
    const visual = anchor.visual3d || {};
    stairwells.push({
      id: `sw_${ids.slice().sort().join('_')}`,
      areaIds: members.map((area) => area.id),
      planAnchor: { x: Number(anchor.x) || 0, y: Number(anchor.y) || 0 },
      visual3d: {
        widthMeters: positive(visual.widthMeters, AREA_3D_DEFAULTS.stairs.widthMeters),
        depthMeters: positive(visual.depthMeters, AREA_3D_DEFAULTS.stairs.depthMeters),
        rotationDegrees: finite(visual.rotationDegrees) ? Number(visual.rotationDegrees) : 0,
      },
      landingConfigs: normalizeLandingConfigs(members.map((area) => area.id)),
    });
  }
  return stairwells;
}

function normalizeMapData(mapData, options = {}) {
  const defaultWidth = Number(options.defaultCorridorWidth || 1.2);
  const peoplePerSqm = Number(options.peoplePerSqm || 2);
  const specificFlow = Number(options.specificFlow || 1.3);
  let areas = Array.isArray(mapData?.areas) ? mapData.areas.map((area) => {
    const visual = area?.visual3d || {};
    const visualKind = normalizedVisualKind(area);
    const defaults = AREA_3D_DEFAULTS[visualKind] || AREA_3D_DEFAULTS.room;
    return {
      ...area,
      visualKind,
      visual3d: {
        widthMeters: positive(visual.widthMeters, defaults.widthMeters),
        depthMeters: positive(visual.depthMeters, defaults.depthMeters),
        heightMeters: positive(visual.heightMeters, defaults.heightMeters),
        rotationDegrees: finite(visual.rotationDegrees) ? Number(visual.rotationDegrees) : 0,
        sizeMode: visual.sizeMode === 'manual' ? 'manual' : 'auto',
        color: typeof visual.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(visual.color) ? visual.color : (AREA_3D_COLORS[area?.type] || AREA_3D_COLORS.room),
      },
    };
  }) : [];
  const edges = Array.isArray(mapData?.edges) ? mapData.edges.map((edge) => {
    const hasWidth = finite(edge.widthMeters) && Number(edge.widthMeters) > 0;
    const widthMeters = hasWidth ? Number(edge.widthMeters) : defaultWidth;
    const length = Math.max(0, Number(edge.length) || 0);
    return {
      ...edge,
      widthMeters,
      widthEstimated: hasWidth ? Boolean(edge.widthEstimated) : true,
      lengthEstimated: edge.lengthEstimated === undefined ? true : Boolean(edge.lengthEstimated),
      capacityPeople: finite(edge.capacityPeople) ? Number(edge.capacityPeople) : length * widthMeters * peoplePerSqm,
      flowCapacity: finite(edge.flowCapacity) && Number(edge.flowCapacity) > 0 ? Number(edge.flowCapacity) : widthMeters * specificFlow,
      initialOccupancy: Math.max(0, Math.min(1, Number(edge.initialOccupancy ?? 0.35))),
      hazard: Math.max(0, Number(edge.hazard) || 0),
    };
  }) : [];
  const incoming = Array.isArray(mapData?.stairwells) ? mapData.stairwells : inferStairwells(areas, edges);
  const used = new Set();
  const stairwells = incoming.map((well, index) => {
    const areaIds = [...new Set((well?.areaIds || []).filter((id) => areas.some((area) => area.id === id)))];
    const members = areaIds.map((id) => areas.find((area) => area.id === id));
    const anchor = members.slice().sort((a, b) => (a.floor - b.floor) || a.id.localeCompare(b.id))[0] || {};
    const visual = well?.visual3d || {};
    const id = typeof well?.id === 'string' && well.id ? well.id : `sw_${index + 1}`;
    areaIds.forEach((areaId) => used.add(areaId));
    return {
      id,
      areaIds,
      planAnchor: { x: finite(well?.planAnchor?.x) ? Number(well.planAnchor.x) : Number(anchor.x) || 0, y: finite(well?.planAnchor?.y) ? Number(well.planAnchor.y) : Number(anchor.y) || 0 },
      visual3d: { widthMeters: positive(visual.widthMeters, AREA_3D_DEFAULTS.stairs.widthMeters), depthMeters: positive(visual.depthMeters, AREA_3D_DEFAULTS.stairs.depthMeters), rotationDegrees: finite(visual.rotationDegrees) ? Number(visual.rotationDegrees) : 0 },
      landingConfigs: normalizeLandingConfigs(areaIds, well?.landingConfigs),
    };
  });
  const wellByArea = new Map(stairwells.flatMap((well) => well.areaIds.map((areaId) => [areaId, well])));
  areas = areas.map((area) => {
    const well = wellByArea.get(area.id);
    if (!well) return { ...area, stairwellId: area.type === 'stairs' ? undefined : area.stairwellId };
    return {
      ...area,
      stairwellId: well.id,
      x: well.planAnchor.x,
      y: well.planAnchor.y,
      visual3d: { ...area.visual3d, widthMeters: well.visual3d.widthMeters, depthMeters: well.visual3d.depthMeters, rotationDegrees: well.visual3d.rotationDegrees, sizeMode: 'manual' },
    };
  });
  const rawScene = mapData?.scene3d || {};
  return {
    ...mapData,
    schemaVersion: 3,
    scene3d: {
      planUnitsPerMeter: positive(rawScene.planUnitsPerMeter, DEFAULT_SCENE_3D.planUnitsPerMeter),
      floorHeightMeters: positive(rawScene.floorHeightMeters, DEFAULT_SCENE_3D.floorHeightMeters),
      floorExplodeMeters: finite(rawScene.floorExplodeMeters) && Number(rawScene.floorExplodeMeters) >= 0 ? Number(rawScene.floorExplodeMeters) : DEFAULT_SCENE_3D.floorExplodeMeters,
      gridSizeMeters: positive(rawScene.gridSizeMeters, DEFAULT_SCENE_3D.gridSizeMeters),
    },
    areas,
    edges,
    stairwells,
  };
}

function hasInvalid3DValues(mapData) {
  const scene = mapData?.scene3d;
  if (scene) {
    for (const field of ['planUnitsPerMeter', 'floorHeightMeters', 'gridSizeMeters']) if (scene[field] !== undefined && !(finite(scene[field]) && Number(scene[field]) > 0)) return `scene3d.${field} must be greater than 0`;
    if (scene.floorExplodeMeters !== undefined && !(finite(scene.floorExplodeMeters) && Number(scene.floorExplodeMeters) >= 0)) return 'scene3d.floorExplodeMeters must be non-negative';
  }
  for (const area of mapData?.areas || []) {
    const allowedVisualKinds = area?.type === 'room' ? ['room', 'junction'] : [area?.type];
    if (area?.visualKind !== undefined && !allowedVisualKinds.includes(area.visualKind)) return `Area ${area.id} has an invalid visualKind`;
    const visual = area?.visual3d;
    if (!visual) continue;
    for (const field of ['widthMeters', 'depthMeters', 'heightMeters']) if (visual[field] !== undefined && !(finite(visual[field]) && Number(visual[field]) > 0)) return `Area ${area.id} visual3d.${field} must be greater than 0`;
    if (visual.rotationDegrees !== undefined && !finite(visual.rotationDegrees)) return `Area ${area.id} visual3d.rotationDegrees must be finite`;
    if (visual.sizeMode !== undefined && !['auto', 'manual'].includes(visual.sizeMode)) return `Area ${area.id} visual3d.sizeMode must be auto or manual`;
  }
  for (const well of mapData?.stairwells || []) {
    for (const [areaId, config] of Object.entries(well?.landingConfigs || {})) {
      if (!Array.isArray(well?.areaIds) || !well.areaIds.includes(areaId)) return `Stairwell ${well?.id || areaId} has a landing config for a non-member area`;
      if (!LANDING_SIDES.has(config?.entranceSide)) return `Stairwell ${well?.id || areaId} has an invalid landing entrance side`;
    }
  }
  return null;
}

function validateMapData(mapData) {
  if (!Array.isArray(mapData?.areas) || !Array.isArray(mapData?.edges)) return 'Map must include areas and edges arrays';
  const areaIds = new Set();
  for (const area of mapData.areas) { if (!area?.id || areaIds.has(area.id)) return 'Area IDs must be unique'; areaIds.add(area.id); }
  const owner = new Set();
  const stairwellIds = new Set();
  for (const well of mapData.stairwells || []) {
    if (!well?.id || stairwellIds.has(well.id) || !Array.isArray(well.areaIds) || new Set(well.areaIds).size !== well.areaIds.length) return 'Every stairwell needs a unique ID and member areaIds';
    stairwellIds.add(well.id);
    const members = well.areaIds.map((id) => mapData.areas.find((area) => area.id === id));
    if (members.length < 2 || members.some((area) => !area || area.type !== 'stairs') || new Set(members.map((area) => area.floor)).size < 2) return `Stairwell ${well.id} must link stairs on at least two floors`;
    if (well.areaIds.some((id) => owner.has(id))) return `Area belongs to more than one stairwell`;
    well.areaIds.forEach((id) => owner.add(id));
    if (!finite(well.planAnchor?.x) || !finite(well.planAnchor?.y) || !(Number(well.visual3d?.widthMeters) > 0) || !(Number(well.visual3d?.depthMeters) > 0) || !finite(well.visual3d?.rotationDegrees)) return `Stairwell ${well.id} has invalid geometry`;
    for (const areaId of well.areaIds) if (well.landingConfigs?.[areaId] && !LANDING_SIDES.has(well.landingConfigs[areaId].entranceSide)) return `Stairwell ${well.id} has an invalid landing entrance side`;
  }
  const edgeIds = new Set();
  for (const edge of mapData.edges) {
    if (!edge?.id || edgeIds.has(edge.id)) return 'Edge IDs must be unique';
    edgeIds.add(edge.id);
    if (!areaIds.has(edge.areaA_id) || !areaIds.has(edge.areaB_id) || edge.areaA_id === edge.areaB_id) return `Edge ${edge.id} references an invalid area`;
    if (!(Number(edge.length) > 0) || !(Number(edge.widthMeters) > 0)) return `Edge ${edge.id} needs length and widthMeters greater than 0`;
  }
  return null;
}

module.exports = { inferStairwells, normalizeMapData, hasInvalid3DValues, validateMapData, normalizedVisualKind, normalizeLandingConfigs };
