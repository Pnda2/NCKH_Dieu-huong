import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls, RoundedBox } from '@react-three/drei';
import { areaVisualKind, cameraPreset, corridorDisplayWidth, corridorGeometry, corridorSweepLayout, createAreaPortalRegistry, dotPlacement, floorDisplayY, junctionOperationalState, junctionRadius, planPosition, portalPlacement, roomWallLayout, sceneSettings, stairEntranceSide, stairFlightLayout, stairwellCoreModels, visualForArea, visibleOnFloor, WALK_SURFACE_Y, worldPosition } from './scene3d';

const MAX_DOTS = 2000;
// Keep visible walking surfaces materially above their structural plinths.
// A 2.5 cm separation avoids depth fighting in top-down views on integrated GPUs.
const FLOOR_TOP_Y = WALK_SURFACE_Y + .025;
const corridorColor = (metric, blocked, showOperational) => blocked || metric?.blocked || metric?.hazard >= 100 ? '#64748b'
  : metric?.hazard > 0 ? '#f97316'
  : !showOperational ? '#5d96c5'
  : metric?.sensorStatus === 'UNKNOWN' || metric?.sensorStatus === 'STALE' ? '#94a3b8'
    : Number(metric?.occupancyRatio ?? metric?.filtered_k ?? 0) >= .8 ? '#ef4444'
      : Number(metric?.occupancyRatio ?? metric?.filtered_k ?? 0) >= .5 ? '#fbbf24' : '#5d96c5';

const sideRotation = (side) => ({ front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 }[side] || 0);

function Beam({ from, to, color = '#fff7ed' }) {
  const { position, quaternion, length } = useMemo(() => {
    const start = new THREE.Vector3(...from); const end = new THREE.Vector3(...to); const vector = end.clone().sub(start);
    return { position: start.add(end).multiplyScalar(.5), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize()), length: vector.length() };
  }, [from, to]);
  return <mesh position={position} quaternion={quaternion}><cylinderGeometry args={[.028, .028, length, 6]} /><meshStandardMaterial color={color} roughness={.5} /></mesh>;
}

function SweepSurface({ layout, color, y, depth = 0, roughness = .72 }) {
  const geometry = useMemo(() => {
    const pointCount = layout.vertices.length;
    const top = layout.vertices.flatMap((point) => [point[0], 0, point[2]]);
    const vertices = depth > 0 ? [...top, ...layout.vertices.flatMap((point) => [point[0], -depth, point[2]])] : top;
    const indices = [...layout.indices];
    if (depth > 0) {
      layout.indices.forEach((index, position) => {
        if (position % 3 === 0) indices.push(index + pointCount, layout.indices[position + 2] + pointCount, layout.indices[position + 1] + pointCount);
      });
      for (let index = 0; index < layout.sections.length - 1; index += 1) {
        const left = index * 2; const right = left + 1; const nextLeft = left + 2; const nextRight = left + 3;
        indices.push(
          left, nextLeft, nextLeft + pointCount, left, nextLeft + pointCount, left + pointCount,
          right, right + pointCount, nextRight + pointCount, right, nextRight + pointCount, nextRight,
        );
      }
      const lastLeft = pointCount - 2; const lastRight = pointCount - 1;
      indices.push(
        0, pointCount, pointCount + 1, 0, pointCount + 1, 1,
        lastLeft, lastRight, lastRight + pointCount, lastLeft, lastRight + pointCount, lastLeft + pointCount,
      );
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); next.setIndex(indices); next.computeVertexNormals();
    return next;
  }, [layout, depth]);
  return <mesh geometry={geometry} position={[0, layout.vertices[0][1] + y, 0]} renderOrder={3} dispose={null}>
    <meshStandardMaterial color={color} roughness={roughness} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
  </mesh>;
}

function MiteredCorridorWall({ path, height = .48, thickness = .1 }) {
  const geometry = useMemo(() => {
    const directionAt = (from, to) => {
      const dx = to[0] - from[0]; const dz = to[2] - from[2]; const length = Math.hypot(dx, dz) || 1;
      return [dx / length, dz / length];
    };
    const offsetAt = (index) => {
      const previous = index > 0 ? directionAt(path[index - 1], path[index]) : null;
      const next = index < path.length - 1 ? directionAt(path[index], path[index + 1]) : null;
      const previousNormal = previous && [-previous[1], previous[0]];
      const nextNormal = next && [-next[1], next[0]];
      if (!previousNormal) return nextNormal.map((value) => value * thickness / 2);
      if (!nextNormal) return previousNormal.map((value) => value * thickness / 2);
      const sumX = previousNormal[0] + nextNormal[0]; const sumZ = previousNormal[1] + nextNormal[1]; const sumLength = Math.hypot(sumX, sumZ) || 1;
      const miter = [sumX / sumLength, sumZ / sumLength];
      const scale = Math.min(thickness * 1.5, thickness / 2 / Math.max(.2, Math.abs(miter[0] * nextNormal[0] + miter[1] * nextNormal[1])));
      return [miter[0] * scale, miter[1] * scale];
    };
    const offsets = path.map((_, index) => offsetAt(index));
    const vertices = [];
    path.forEach((point, index) => {
      const [offsetX, offsetZ] = offsets[index];
      vertices.push(
        point[0] + offsetX, 0, point[2] + offsetZ,
        point[0] - offsetX, 0, point[2] - offsetZ,
        point[0] + offsetX, height, point[2] + offsetZ,
        point[0] - offsetX, height, point[2] - offsetZ,
      );
    });
    const indices = [];
    for (let index = 0; index < path.length - 1; index += 1) {
      const current = index * 4; const next = (index + 1) * 4;
      indices.push(
        current + 2, current + 3, next + 3, current + 2, next + 3, next + 2,
        current, next, next + 2, current, next + 2, current + 2,
        current + 1, current + 3, next + 3, current + 1, next + 3, next + 1,
        current, current + 1, current + 3, current, current + 3, current + 2,
      );
    }
    const first = 0; const last = (path.length - 1) * 4;
    indices.push(first, first + 2, first + 3, first, first + 3, first + 1, last, last + 1, last + 3, last, last + 3, last + 2);
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); next.setIndex(indices); next.computeVertexNormals();
    return next;
  }, [path, height, thickness]);
  return <mesh geometry={geometry} position={[0, path[0][1] + FLOOR_TOP_Y, 0]} renderOrder={4} dispose={null}>
    <meshStandardMaterial color="#f8fafc" roughness={.64} side={THREE.DoubleSide} />
  </mesh>;
}

function FootprintSelection({ outline }) {
  const geometry = useMemo(() => {
    const next = new THREE.BufferGeometry();
    next.setFromPoints(outline.map((point) => new THREE.Vector3(point[0], point[1] + FLOOR_TOP_Y + .04, point[2])));
    return next;
  }, [outline]);
  return <lineLoop geometry={geometry} dispose={null}><lineBasicMaterial color="#e0f2fe" /></lineLoop>;
}

function StairLanding({ visual, side, directions = [] }) {
  const width = Math.min(1.1, Math.max(.65, visual.widthMeters - .45));
  const tread = Math.min(.28, Math.max(.16, (visual.depthMeters - .7) / 4));
  return <group rotation={[0, sideRotation(side), 0]}>
    {[0, 1, 2, 3].map((index) => <mesh key={index} position={[0, .18 + (index + 1) * .055, -visual.depthMeters / 2 + .34 + index * tread]}><boxGeometry args={[width, (index + 1) * .11, tread]} /><meshStandardMaterial color="#f9d7a8" roughness={.75} /></mesh>)}
    <Beam from={[-width / 2 - .06, .3, -visual.depthMeters / 2 + .24]} to={[-width / 2 - .06, .7, -visual.depthMeters / 2 + .24 + 4 * tread]} />
    <Beam from={[width / 2 + .06, .3, -visual.depthMeters / 2 + .24]} to={[width / 2 + .06, .7, -visual.depthMeters / 2 + .24 + 4 * tread]} />
    {directions.length > 0 && <Html position={[0, 1.02, 0]} center distanceFactor={10} style={{ pointerEvents: 'none' }}><div className="scene3d-stair-label">{directions.join(' · ')}</div></Html>}
  </group>;
}

function WallPanel({ visual, panel, height, opacity = 1, color = visual.color }) {
  const horizontal = panel.side === 'front' || panel.side === 'back';
  const z = panel.side === 'front' ? -visual.depthMeters / 2 + .06 : visual.depthMeters / 2 - .06;
  const x = panel.side === 'left' ? -visual.widthMeters / 2 + .06 : visual.widthMeters / 2 - .06;
  const position = horizontal ? [panel.offset, height / 2, z] : [x, height / 2, panel.offset];
  const args = horizontal ? [panel.length, height, .12] : [.12, height, panel.length];
  return <RoundedBox args={args} radius={.045} smoothness={1} position={position}><meshStandardMaterial color={color} roughness={.82} transparent={opacity < 1} opacity={opacity} /></RoundedBox>;
}

function RoomWallLayout({ visual, portals, opacity, height = visual.heightMeters, color = visual.color }) {
  const assemblies = useMemo(() => portals.reduce((result, portal) => {
    const existing = result.find((item) => item.side === portal.side && Math.abs(item.offset - portal.offset) < .08);
    if (existing) existing.openingWidth = Math.max(existing.openingWidth || existing.width, portal.openingWidth || portal.width);
    else result.push({ ...portal, openingWidth: portal.openingWidth || portal.width });
    return result;
  }, []), [portals]);
  const panels = useMemo(() => roomWallLayout(visual, assemblies), [visual, assemblies]);
  return <>
    {panels.map((panel, index) => <WallPanel key={`${panel.side}-${index}`} visual={visual} panel={panel} height={height} opacity={opacity} color={color} />)}
    {['front', 'right', 'back', 'left'].map((side) => {
      const horizontal = side === 'front' || side === 'back';
      const position = horizontal ? [0, height + .025, side === 'front' ? -visual.depthMeters / 2 : visual.depthMeters / 2] : [side === 'left' ? -visual.widthMeters / 2 : visual.widthMeters / 2, height + .025, 0];
      const args = horizontal ? [visual.widthMeters + .12, .08, .13] : [.13, .08, visual.depthMeters + .12];
      return <RoundedBox key={`cornice-${side}`} args={args} radius={.03} smoothness={1} position={position}><meshStandardMaterial color="#f8fafc" roughness={.62} transparent={opacity < 1} opacity={opacity} /></RoundedBox>;
    })}
  </>;
}

function StairLandingShell({ visual, side, portals = [], opacity = 1 }) {
  const portal = portals.filter((item) => item.side === side).reduce((widest, item) => (item.openingWidth || item.width) > (widest.openingWidth || widest.width) ? item : widest, { side, offset: 0, width: Math.min(1.12, Math.max(.72, side === 'front' || side === 'back' ? visual.widthMeters * .7 : visual.depthMeters * .7)) });
  return <>
    <RoomWallLayout visual={visual} portals={[portal]} opacity={opacity} height={1.04} color="#d58643" />
  </>;
}

function AreaBlock({ area, scene, activeFloor, floorView, floors, selected, editable, corridorMode, snap, onSelect, onMove, onStartCorridor, onDragState, stairwell, portalOptions, portals = [], junctionColor }) {
  const [dragging, setDragging] = useState(false);
  const visual = visualForArea(area); const kind = areaVisualKind(area); const position = worldPosition(area, scene, activeFloor, floorView, floors);
  const opacity = floorView === 'overview' && area.floor !== activeFloor ? .25 : 1;
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -position[1]), [position]);
  const directions = stairwell ? stairwell.members.filter((member) => member.floor !== area.floor).map((member) => member.floor > area.floor ? `▲ T${member.floor}` : `▼ T${member.floor}`) : [];
  const stairSide = area.type === 'stairs' ? stairEntranceSide(area, [0, 0, -1], portalOptions) : 'front';
  const move = (event) => { const point = new THREE.Vector3(); if (event.ray.intersectPlane(plane, point)) onMove({ ...area, ...planPosition(point.x, point.z, scene, snap) }); };
  const select = (event) => { event.stopPropagation(); if (corridorMode && onStartCorridor) onStartCorridor(area); else onSelect({ type: 'area', data: area }); };
  const stopDrag = (event) => { if (!dragging) return; event.target.releasePointerCapture(event.pointerId); setDragging(false); onDragState?.(false); };
  const hitGeometry = kind === 'junction' ? <cylinderGeometry args={[junctionRadius(area), junctionRadius(area), .3, 24]} /> : <boxGeometry args={[visual.widthMeters, .3, visual.depthMeters]} />;
  return <group position={position} rotation={[0, THREE.MathUtils.degToRad(visual.rotationDegrees || 0), 0]}>
    <mesh onClick={select} onPointerDown={(event) => { if (!editable || corridorMode) return; event.stopPropagation(); event.target.setPointerCapture(event.pointerId); setDragging(true); onDragState?.(true); }} onPointerMove={(event) => dragging && move(event)} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
      {hitGeometry}<meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    {kind === 'junction' ? <><mesh position={[0, FLOOR_TOP_Y - .165, 0]} renderOrder={2}><cylinderGeometry args={[junctionRadius(area), junctionRadius(area) * .94, .33, 24]} /><meshStandardMaterial color={junctionColor || visual.color} roughness={.72} /></mesh><mesh position={[0, FLOOR_TOP_Y - .009, 0]} renderOrder={4}><cylinderGeometry args={[junctionRadius(area) * .91, junctionRadius(area) * .91, .018, 24]} /><meshStandardMaterial color={junctionColor || visual.color} roughness={.68} /></mesh><mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_TOP_Y + .012, 0]} renderOrder={5}><torusGeometry args={[junctionRadius(area) * .74, .022, 6, 24]} /><meshStandardMaterial color="#e9fbff" roughness={.6} /></mesh></> : <><RoundedBox args={[visual.widthMeters, .28, visual.depthMeters]} radius={.1} smoothness={2} renderOrder={2}><meshStandardMaterial color={visual.color} roughness={.78} transparent={opacity < 1} opacity={opacity} /></RoundedBox>{area.type !== 'stairs' && <><RoundedBox args={[visual.widthMeters - .22, .06, visual.depthMeters - .22]} radius={.04} smoothness={1} position={[0, FLOOR_TOP_Y - .03, 0]} renderOrder={4}><meshStandardMaterial color="#cfe8f5" roughness={.88} transparent={opacity < 1} opacity={opacity} /></RoundedBox><RoomWallLayout visual={visual} portals={portals} opacity={opacity * .94} /></>}</>}
    {area.type === 'stairs' && floorView === 'focus' && <><StairLandingShell visual={visual} side={stairSide} portals={portals} opacity={opacity} /><StairLanding visual={visual} side={stairSide} directions={directions} /></>}
    {selected && <mesh position={[0, .33, 0]}>{kind === 'junction' ? <ringGeometry args={[junctionRadius(area) + .09, junctionRadius(area) + .15, 24]} /> : <boxGeometry args={[visual.widthMeters + .16, .06, visual.depthMeters + .16]} />}<meshBasicMaterial color="#e0f2fe" wireframe /></mesh>}
    {(floorView !== 'overview' || area.floor === activeFloor) && <Html position={[0, visual.heightMeters + .2, 0]} center distanceFactor={11} style={{ pointerEvents: 'none' }}><div className="scene3d-label">{area.name}</div></Html>}
  </group>;
}

function CorridorBlock({ corridor, areaA, areaB, scene, activeFloor, floorView, floors, metric, blocked, selected, onSelect, showOperational, portalOptions, startPortal, endPortal }) {
  const geometry = corridorGeometry(areaA, areaB, scene, activeFloor, floorView, floors, portalOptions); const width = corridorDisplayWidth(corridor.widthMeters); const color = corridorColor(metric, blocked, showOperational);
  const layout = corridorSweepLayout(startPortal, endPortal, geometry.horizontalDirection, width, geometry.direct);
  const select = (event) => { event.stopPropagation(); onSelect({ type: 'corridor', data: corridor }); };
  return <group onClick={select}>
    <SweepSurface layout={layout} color="#c5d3dc" y={WALK_SURFACE_Y - .07} depth={.08} roughness={.75} />
    <SweepSurface layout={layout} color={color} y={FLOOR_TOP_Y} roughness={.7} />
    {layout.wallPaths.map((path, index) => <MiteredCorridorWall key={index} path={path} />)}
    {selected && <FootprintSelection outline={layout.outline} />}
  </group>;
}

function StairwellCore({ well, scene, activeFloor, floors, portalOptions, portalDescriptors }) {
  const members = well.members.slice().sort((a, b) => a.floor - b.floor); const visual = well.visual3d;
  const displayYs = members.map((area) => floorDisplayY(area.floor, floors, scene, activeFloor, 'overview'));
  const minY = Math.min(...displayYs); const maxY = Math.max(...displayYs);
  const frameCorners = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return <group position={[well.planAnchor.x / scene.planUnitsPerMeter, 0, well.planAnchor.y / scene.planUnitsPerMeter]} rotation={[0, THREE.MathUtils.degToRad(visual.rotationDegrees), 0]}>
    {maxY - minY > .2 && frameCorners.map(([x, z]) => <Beam key={`frame-${x}-${z}`} from={[x * (visual.widthMeters / 2 - .1), minY + .14, z * (visual.depthMeters / 2 - .1)]} to={[x * (visual.widthMeters / 2 - .1), maxY + 1.06, z * (visual.depthMeters / 2 - .1)]} color="#b86f39" />)}
    {members.map((area) => { const side = stairEntranceSide(area, [0, 0, -1], { ...portalOptions, stairwells: [well] }); return <group key={`landing-${area.id}`} position={[0, floorDisplayY(area.floor, floors, scene, activeFloor, 'overview'), 0]}><RoundedBox args={[visual.widthMeters, .2, visual.depthMeters]} radius={.09} smoothness={2}><meshStandardMaterial color="#c8783d" roughness={.76} /></RoundedBox><RoundedBox args={[visual.widthMeters - .2, .045, visual.depthMeters - .2]} radius={.03} smoothness={1} position={[0, .12, 0]}><meshStandardMaterial color="#f8d5a3" roughness={.84} /></RoundedBox><StairLandingShell visual={visual} side={side} portals={portalDescriptors?.[area.id] || []} /></group>; })}
    {members.slice(0, -1).map((area, index) => <StairFlight key={`flight-${area.id}`} lower={area} upper={members[index + 1]} well={well} scene={scene} activeFloor={activeFloor} floors={floors} portalOptions={portalOptions} />)}
  </group>;
}

function StairFlight({ lower, upper, well, scene, activeFloor, floors, portalOptions }) {
  const layout = stairFlightLayout(well, lower, upper, scene, activeFloor, floors, portalOptions); const visual = well.visual3d; const half = layout.steps / 2; const width = Math.min(.82, visual.widthMeters * .32); const offset = width * .62; const run = layout.run; const riser = layout.stepRise; const structuralRise = layout.structuralRise; const tread = run / half;
  const upperDepth = layout.upperSide === 'front' || layout.upperSide === 'back' ? visual.depthMeters : visual.widthMeters;
  return <group position={[0, layout.lowerPosition[1], 0]}><group rotation={[0, layout.localRotation, 0]}>
    <RoundedBox args={[visual.widthMeters - .26, .1, .62]} radius={.04} smoothness={1} position={[0, structuralRise / 2, run / 2]}><meshStandardMaterial color="#c8783d" roughness={.76} /></RoundedBox>
    {Array.from({ length: half }, (_, index) => <React.Fragment key={index}>
      <RoundedBox args={[width, .075, tread + .025]} radius={.018} smoothness={1} position={[-offset, (index + 1) * riser, -run / 2 + (index + .5) * tread]}><meshStandardMaterial color="#f9d7a8" roughness={.78} /></RoundedBox>
      <RoundedBox args={[width, .075, tread + .025]} radius={.018} smoothness={1} position={[offset, structuralRise / 2 + (index + 1) * riser, run / 2 - (index + .5) * tread]}><meshStandardMaterial color="#f9d7a8" roughness={.78} /></RoundedBox>
    </React.Fragment>)}
    {[-1, 1].flatMap((side) => [<Beam key={`a-${side}`} from={[-offset + side * width / 2, .22, -run / 2]} to={[-offset + side * width / 2, structuralRise / 2 + .62, run / 2]} color="#fff7ed" />, <Beam key={`b-${side}`} from={[offset + side * width / 2, structuralRise / 2 + .62, run / 2]} to={[offset + side * width / 2, structuralRise + .22, -run / 2]} color="#fff7ed" />])}
    {[-1, 1].map((side) => <React.Fragment key={`posts-${side}`}>{[0, .5, 1].map((ratio) => <React.Fragment key={ratio}><Beam from={[-offset + side * width / 2, ratio * structuralRise / 2 + .1, -run / 2 + ratio * run]} to={[-offset + side * width / 2, ratio * structuralRise / 2 + .58, -run / 2 + ratio * run]} color="#fff7ed" /><Beam from={[offset + side * width / 2, structuralRise / 2 + ratio * structuralRise / 2 + .1, run / 2 - ratio * run]} to={[offset + side * width / 2, structuralRise / 2 + ratio * structuralRise / 2 + .58, run / 2 - ratio * run]} color="#fff7ed" /></React.Fragment>)}</React.Fragment>)}
    <Beam from={[-offset, .07, -run / 2]} to={[-offset, structuralRise / 2 + .07, run / 2]} color="#b86f39" /><Beam from={[offset, structuralRise / 2 + .07, run / 2]} to={[offset, structuralRise + .07, -run / 2]} color="#b86f39" />
  </group>
  {layout.overviewGap > .01 && <RoundedBox args={[Math.min(.9, visual.widthMeters * .42), layout.overviewGap, .52]} radius={.03} smoothness={1} position={[0, structuralRise + layout.overviewGap / 2, 0]}><meshStandardMaterial color="#c8783d" roughness={.78} /></RoundedBox>}
  {layout.upperSide !== layout.lowerSide && <group position={[0, layout.rise + .14, 0]} rotation={[0, sideRotation(layout.upperSide), 0]}><RoundedBox args={[Math.min(.9, visual.widthMeters * .4), .1, Math.max(.35, upperDepth * .42)]} radius={.04} smoothness={1} position={[0, 0, upperDepth * .21]}><meshStandardMaterial color="#d58643" roughness={.7} /></RoundedBox></group>}
  </group>;
}

function PeopleDots({ corridors, areasById, scene, activeFloor, floorView, floors, metrics, occupancyData, simulationStatus, portalOptions }) {
  const meshRef = useRef(); const frozenTimeRef = useRef(0); const previousStatusRef = useRef(simulationStatus); const dummy = useMemo(() => new THREE.Object3D(), []); const color = useMemo(() => new THREE.Color(), []);
  const dots = useMemo(() => {
    if (simulationStatus !== 'running' && simulationStatus !== 'stopped') return [];
    const loads = corridors.map((corridor) => Math.max(0, Number(metrics?.[corridor.id]?.currentPeople ?? (occupancyData?.[corridor.id] || 0) * (corridor.capacityPeople || 0)))); const weight = Math.max(1, Math.ceil(loads.reduce((sum, value) => sum + value, 0) / MAX_DOTS));
    return corridors.flatMap((corridor, index) => { const a = areasById[corridor.areaA_id]; const b = areasById[corridor.areaB_id]; if (!a || !b || a.floor !== b.floor || (floorView === 'focus' && a.floor !== activeFloor)) return []; const segment = corridorGeometry(a, b, scene, activeFloor, floorView, floors, portalOptions); const usableWidth = corridorDisplayWidth(corridor.widthMeters); return Array.from({ length: Math.round(loads[index] / weight) }, (_, dotIndex) => ({ id: `${corridor.id}-${dotIndex}`, from: segment.start, to: segment.end, ...dotPlacement(corridor.id, dotIndex, usableWidth) })); });
  }, [corridors, areasById, scene, activeFloor, floorView, floors, metrics, occupancyData, simulationStatus, portalOptions]);
  useEffect(() => { if (meshRef.current) meshRef.current.count = dots.length; }, [dots.length]);
  useFrame(({ clock }) => { if (!meshRef.current) return; if (previousStatusRef.current === 'running' && simulationStatus === 'stopped') frozenTimeRef.current = clock.getElapsedTime(); previousStatusRef.current = simulationStatus; const time = simulationStatus === 'running' ? clock.getElapsedTime() : frozenTimeRef.current; dots.forEach((dot, index) => { const phase = (dot.progress + dot.longitudinalJitter + time * .035) % 1; const x = THREE.MathUtils.lerp(dot.from[0], dot.to[0], phase); const z = THREE.MathUtils.lerp(dot.from[2], dot.to[2], phase); const angle = Math.atan2(dot.to[2] - dot.from[2], dot.to[0] - dot.from[0]); dummy.position.set(x - Math.sin(angle) * dot.lateral, THREE.MathUtils.lerp(dot.from[1], dot.to[1], phase) + .35 + dot.heightJitter, z + Math.cos(angle) * dot.lateral); dummy.scale.setScalar(.105 + dot.heightJitter * .3); dummy.updateMatrix(); meshRef.current.setMatrixAt(index, dummy.matrix); color.set('#dbeafe'); meshRef.current.setColorAt(index, color); }); meshRef.current.instanceMatrix.needsUpdate = true; if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true; });
  return dots.length ? <instancedMesh ref={meshRef} args={[null, null, dots.length]}><sphereGeometry args={[1, 10, 10]} /><meshStandardMaterial roughness={.35} /></instancedMesh> : null;
}

function CameraRig({ areas, scene, activeFloor, floorView, floors, command, dragging }) {
  const { camera } = useThree(); const controls = useRef();
  useEffect(() => { const visible = areas.filter((area) => visibleOnFloor(area, activeFloor, floorView)); if (!visible.length) return; const points = visible.map((area) => worldPosition(area, scene, activeFloor, floorView, floors)); const minX = Math.min(...points.map((point) => point[0])); const maxX = Math.max(...points.map((point) => point[0])); const minZ = Math.min(...points.map((point) => point[2])); const maxZ = Math.max(...points.map((point) => point[2])); const preset = cameraPreset(String(command).startsWith('fit') ? 'fit' : command, { centerX: (minX + maxX) / 2, centerY: 0, centerZ: (minZ + maxZ) / 2, span: Math.max(maxX - minX, maxZ - minZ) }); camera.position.set(...preset.position); controls.current?.target.set(...preset.target); controls.current?.update(); }, [areas, scene, activeFloor, floorView, floors, command, camera]);
  return <OrbitControls ref={controls} makeDefault enabled={!dragging} maxPolarAngle={Math.PI / 2.03} />;
}

function SceneContents({ areas, corridors, stairwells, activeFloor, scene, selectedItem, onSelectItem, onAddArea, onUpdateArea, onAddCorridor, editTool, editable, occupancyData, edgeMetrics, incidentData, simulationStatus, floorView, command, snap, addVisualKind }) {
  const floors = useMemo(() => [...new Set(areas.map((area) => area.floor))].sort((a, b) => a - b), [areas]); const settings = sceneSettings(scene); const [pendingStart, setPendingStart] = useState(null); const [dragging, setDragging] = useState(false);
  const visibleAreas = areas.filter((area) => visibleOnFloor(area, activeFloor, floorView)); const areaById = useMemo(() => Object.fromEntries(areas.map((area) => [area.id, area])), [areas]); const wells = useMemo(() => stairwellCoreModels(stairwells, areaById), [stairwells, areaById]); const portalOptions = useMemo(() => ({ stairwells: wells, corridors, areasById: areaById }), [wells, corridors, areaById]);
  const maxPlan = Math.max(8, ...visibleAreas.map((area) => Math.max(Math.abs(area.x / settings.planUnitsPerMeter), Math.abs(area.y / settings.planUnitsPerMeter)))); const gridSize = Math.max(18, Math.ceil(maxPlan * 2 + 8));
  const startCorridor = (area) => { if (editTool !== 'addCorridor') return; if (!pendingStart) setPendingStart(area); else if (pendingStart.id !== area.id) { onAddCorridor(pendingStart.id, area.id); setPendingStart(null); } };
  const activeY = floorDisplayY(activeFloor, floors, settings, activeFloor, floorView);
  const renderedCorridors = corridors.filter((corridor) => { const a = areaById[corridor.areaA_id]; const b = areaById[corridor.areaB_id]; return a && b && a.floor === b.floor && (floorView === 'overview' || a.floor === activeFloor); });
  const corridorModels = useMemo(() => renderedCorridors.map((corridor) => {
    const areaA = areaById[corridor.areaA_id]; const areaB = areaById[corridor.areaB_id];
    const geometry = corridorGeometry(areaA, areaB, scene, activeFloor, floorView, floors, portalOptions);
    const width = corridorDisplayWidth(corridor.widthMeters);
    const startPortal = portalPlacement(areaA, worldPosition(areaA, scene, activeFloor, floorView, floors), geometry.start, width, corridor.id, 'start');
    const endPortal = portalPlacement(areaB, worldPosition(areaB, scene, activeFloor, floorView, floors), geometry.end, width, corridor.id, 'end');
    return { corridor, areaA, areaB, geometry, startPortal, endPortal };
  }), [renderedCorridors, areaById, scene, activeFloor, floorView, floors, portalOptions]);
  const portalRegistry = useMemo(() => createAreaPortalRegistry(corridorModels.flatMap((model) => [model.startPortal, model.endPortal])), [corridorModels]);
  const junctionColors = useMemo(() => Object.fromEntries(visibleAreas.filter((area) => areaVisualKind(area) === 'junction').map((area) => {
    const state = junctionOperationalState(area.id, renderedCorridors, edgeMetrics, incidentData?.blockedEdges || []);
    return [area.id, corridorColor(state.metric, state.blocked, simulationStatus === 'running' || simulationStatus === 'stopped')];
  })), [visibleAreas, renderedCorridors, edgeMetrics, incidentData, simulationStatus]);
  const footprint = useMemo(() => {
    const points = visibleAreas.map((area) => worldPosition(area, scene, activeFloor, floorView, floors));
    if (!points.length) return { centerX: 0, centerZ: 0, width: 10, depth: 10 };
    const minX = Math.min(...points.map((point) => point[0])); const maxX = Math.max(...points.map((point) => point[0]));
    const minZ = Math.min(...points.map((point) => point[2])); const maxZ = Math.max(...points.map((point) => point[2]));
    return { centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2, width: Math.max(7, maxX - minX + 4), depth: Math.max(7, maxZ - minZ + 4) };
  }, [visibleAreas, scene, activeFloor, floorView, floors]);
  return <>
    <color attach="background" args={['#dbeaf0']} /><fog attach="fog" args={['#dbeaf0', 22, Math.max(60, gridSize * 2.6)]} /><hemisphereLight args={['#ffffff', '#88a5b7', 1.12]} /><ambientLight intensity={.44} /><directionalLight position={[10, 18, 8]} intensity={1.28} />
    <RoundedBox args={[footprint.width, .1, footprint.depth]} radius={.18} smoothness={2} position={[footprint.centerX, activeY - .1, footprint.centerZ]}><meshStandardMaterial color="#cbdce1" roughness={.96} /></RoundedBox>
    <Grid args={[gridSize, gridSize]} position={[0, activeY - .02, 0]} cellSize={settings.gridSizeMeters} cellThickness={.14} sectionSize={settings.gridSizeMeters * 5} sectionThickness={.32} cellColor="#c6d3d9" sectionColor="#a0bbca" fadeDistance={gridSize * .64} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, activeY - .04, 0]} onClick={(event) => { if (editable && editTool === 'addArea') { const next = planPosition(event.point.x, event.point.z, scene, snap); onAddArea(next.x, next.y, addVisualKind); } else if (editTool !== 'addCorridor') onSelectItem(null); }}><planeGeometry args={[gridSize, gridSize]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} /></mesh>
    {corridorModels.map((model) => <CorridorBlock key={model.corridor.id} corridor={model.corridor} areaA={model.areaA} areaB={model.areaB} scene={scene} activeFloor={activeFloor} floorView={floorView} floors={floors} metric={edgeMetrics?.[model.corridor.id]} blocked={incidentData?.blockedEdges?.includes(model.corridor.id)} showOperational={simulationStatus === 'running' || simulationStatus === 'stopped'} selected={selectedItem?.type === 'corridor' && selectedItem.data.id === model.corridor.id} onSelect={onSelectItem} portalOptions={portalOptions} startPortal={portalRegistry.byEdgeEndpoint[`${model.corridor.id}:start`] || model.startPortal} endPortal={portalRegistry.byEdgeEndpoint[`${model.corridor.id}:end`] || model.endPortal} />)}
    {floorView === 'overview' && wells.map((well) => <StairwellCore key={well.id} well={well} scene={settings} activeFloor={activeFloor} floors={floors} portalOptions={portalOptions} portalDescriptors={portalRegistry.byArea} />)}
    <PeopleDots corridors={renderedCorridors} areasById={areaById} scene={scene} activeFloor={activeFloor} floorView={floorView} floors={floors} metrics={edgeMetrics} occupancyData={occupancyData} simulationStatus={simulationStatus} portalOptions={portalOptions} />
    {visibleAreas.filter((area) => !(floorView === 'overview' && area.type === 'stairs' && area.stairwellId)).map((area) => <AreaBlock key={area.id} area={area} scene={scene} activeFloor={activeFloor} floorView={floorView} floors={floors} selected={selectedItem?.type === 'area' && selectedItem.data.id === area.id} editable={editable && editTool === 'select'} corridorMode={editable && editTool === 'addCorridor'} snap={snap} onSelect={onSelectItem} onMove={onUpdateArea} onStartCorridor={startCorridor} onDragState={setDragging} stairwell={wells.find((well) => well.id === area.stairwellId)} portalOptions={portalOptions} portals={portalRegistry.byArea[area.id] || []} junctionColor={junctionColors[area.id]} />)}
    <CameraRig areas={areas} scene={scene} activeFloor={activeFloor} floorView={floorView} floors={floors} command={command} dragging={dragging} />
  </>;
}

function canUseWebGL() { try { const canvas = document.createElement('canvas'); return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')); } catch { return false; } }
function WebGLUnavailable({ onSwitchTo2d, onRetry }) { return <div className="scene3d-fallback"><div><p className="scene3d-fallback-title">Không thể khởi tạo không gian 3D.</p><div className="scene3d-fallback-actions"><button onClick={onRetry}>Thử lại 3D</button><button onClick={onSwitchTo2d}>Mở sơ đồ 2D</button></div></div></div>; }

export default function BuildingScene3D(props) {
  const [snap, setSnap] = useState(true); const [floorView, setFloorViewState] = useState('focus'); const [command, setCommand] = useState('fit'); const [webglAvailable, setWebglAvailable] = useState(null); const [canvasKey, setCanvasKey] = useState(0); const [addVisualKind, setAddVisualKind] = useState('room');
  const setFloorView = (requested) => setFloorViewState((current) => {
    const next = typeof requested === 'function' ? requested(current) : requested;
    return next === current ? (current === 'focus' ? 'overview' : 'focus') : next;
  });
  useEffect(() => setWebglAvailable(canUseWebGL()), []); useEffect(() => setCommand(`fit-${props.activeFloor}-${floorView}`), [props.activeFloor, floorView]);
  return <div className="scene3d-root"><div className="scene3d-toolbar"><div className="scene3d-view-modes"><button className={floorView === 'focus' ? 'active' : ''} onClick={() => setFloorView('focus')}>Tầng đang chọn</button><button className={floorView === 'overview' ? 'active' : ''} onClick={() => setFloorView('overview')}>Toàn nhà tách lớp</button></div><button onClick={() => setCommand(`fit-${Date.now()}`)}>Fit</button><button onClick={() => setCommand('iso')}>Isometric</button><button onClick={() => setCommand('top')}>Top-down</button>{props.editable ? <><button onClick={() => setSnap((value) => !value)}>{snap ? 'Snap lưới: bật' : 'Snap lưới: tắt'}</button>{props.editTool === 'addArea' && <label className="scene3d-add-kind">Thêm <select value={addVisualKind} onChange={(event) => setAddVisualKind(event.target.value)}><option value="room">Phòng</option><option value="junction">Nút giao</option></select></label>}</> : <span>Khóa chỉnh sửa</span>}</div>{webglAvailable === false ? <WebGLUnavailable onRetry={() => { setWebglAvailable(canUseWebGL()); setCanvasKey((value) => value + 1); }} onSwitchTo2d={props.onSwitchTo2d} /> : <Canvas key={canvasKey} dpr={[1, 1.25]} flat gl={{ antialias: false, alpha: false, powerPreference: 'default' }} camera={{ position: [14, 16, 14], fov: 42, near: .35, far: 100 }} fallback={<WebGLUnavailable onSwitchTo2d={props.onSwitchTo2d} onRetry={() => setCanvasKey((value) => value + 1)} />}><SceneContents {...props} floorView={floorView} command={command} snap={snap} addVisualKind={addVisualKind} /></Canvas>}</div>;
}
