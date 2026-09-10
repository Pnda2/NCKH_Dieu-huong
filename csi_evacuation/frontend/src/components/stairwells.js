const DEFAULT_VISUAL = { widthMeters: 2.2, depthMeters: 3.2, rotationDegrees: 0 };
export const LANDING_SIDES = ['auto', 'front', 'right', 'back', 'left'];

const visualForStairwell = (area) => ({
  widthMeters: Number(area?.visual3d?.widthMeters) || DEFAULT_VISUAL.widthMeters,
  depthMeters: Number(area?.visual3d?.depthMeters) || DEFAULT_VISUAL.depthMeters,
  rotationDegrees: Number(area?.visual3d?.rotationDegrees) || 0,
});

const normalizedLandingConfigs = (areaIds, configs = {}) => Object.fromEntries(areaIds.map((areaId) => [areaId, {
  entranceSide: LANDING_SIDES.includes(configs?.[areaId]?.entranceSide) ? configs[areaId].entranceSide : 'auto',
}]));

export function updateStairwellLanding(stairwells, stairwellId, areaId, entranceSide) {
  if (!LANDING_SIDES.includes(entranceSide)) return stairwells;
  return stairwells.map((well) => well.id !== stairwellId ? well : {
    ...well,
    landingConfigs: { ...normalizedLandingConfigs(well.areaIds, well.landingConfigs), [areaId]: { entranceSide } },
  });
}

export function syncStairwellUpdate(areas, stairwells, updatedArea) {
  const well = stairwells.find((item) => item.id === updatedArea.stairwellId);
  if (!well) return { areas: areas.map((area) => area.id === updatedArea.id ? updatedArea : area), stairwells };
  const visual3d = { ...well.visual3d, ...visualForStairwell(updatedArea) };
  const planAnchor = { x: Number(updatedArea.x), y: Number(updatedArea.y) };
  const nextWell = { ...well, planAnchor, visual3d, landingConfigs: normalizedLandingConfigs(well.areaIds, well.landingConfigs) };
  const memberIds = new Set(well.areaIds);
  return {
    stairwells: stairwells.map((item) => item.id === well.id ? nextWell : item),
    areas: areas.map((area) => memberIds.has(area.id) ? {
      ...area,
      x: planAnchor.x,
      y: planAnchor.y,
      stairwellId: well.id,
      visual3d: { ...(area.visual3d || {}), ...visual3d, sizeMode: 'manual' },
    } : area),
  };
}

export function linkStairwell(areas, stairwells, areaAId, areaBId, idFactory) {
  const left = areas.find((area) => area.id === areaAId);
  const right = areas.find((area) => area.id === areaBId);
  if (!left || !right || left.type !== 'stairs' || right.type !== 'stairs' || left.floor === right.floor) return { areas, stairwells };
  const related = stairwells.filter((well) => well.areaIds.includes(left.id) || well.areaIds.includes(right.id));
  const memberIds = [...new Set([left.id, right.id, ...related.flatMap((well) => well.areaIds)])];
  const anchorArea = memberIds.map((id) => areas.find((area) => area.id === id)).sort((a, b) => (a.floor - b.floor) || a.id.localeCompare(b.id))[0];
  const primary = related[0];
  const well = {
    id: primary?.id || idFactory(),
    areaIds: memberIds,
    planAnchor: primary?.planAnchor || { x: anchorArea.x, y: anchorArea.y },
    visual3d: primary?.visual3d || visualForStairwell(anchorArea),
    landingConfigs: normalizedLandingConfigs(memberIds, Object.assign({}, ...related.map((item) => item.landingConfigs || {}))),
  };
  const removeIds = new Set(related.map((item) => item.id));
  return syncStairwellUpdate(areas, [...stairwells.filter((item) => !removeIds.has(item.id)), well], {
    ...anchorArea,
    stairwellId: well.id,
    x: well.planAnchor.x,
    y: well.planAnchor.y,
    visual3d: { ...(anchorArea.visual3d || {}), ...well.visual3d },
  });
}

export function pruneStairwells(areas, stairwells) {
  const validAreas = new Set(areas.map((area) => area.id));
  const next = stairwells.map((well) => {
    const areaIds = well.areaIds.filter((id) => validAreas.has(id));
    return { ...well, areaIds, landingConfigs: normalizedLandingConfigs(areaIds, well.landingConfigs) };
  }).filter((well) => well.areaIds.length >= 2);
  const validWellIds = new Set(next.map((well) => well.id));
  return { stairwells: next, areas: areas.map((area) => area.stairwellId && !validWellIds.has(area.stairwellId) ? { ...area, stairwellId: undefined } : area) };
}

export const corridorDefaults = () => ({ length: 10, lengthEstimated: true, widthMeters: 1.2, widthEstimated: true });
