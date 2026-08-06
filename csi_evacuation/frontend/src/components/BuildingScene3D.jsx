import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls, RoundedBox } from '@react-three/drei';
import { areaVisualKind, cameraPreset, corridorDisplayWidth, corridorGeometry, dotPlacement, floorDisplayY, junctionRadius, planPosition, sceneSettings, stairEntranceSide, stairFlightLayout, visualForArea, visibleOnFloor, worldPosition } from './scene3d';

const MAX_DOTS = 2000;
const corridorColor = (metric, blocked, showOperational) => blocked || metric?.blocked || metric?.hazard >= 100 ? '#64748b'
  : metric?.hazard > 0 ? '#f97316'
  : !showOperational ? '#5d96c5'
  : metric?.sensorStatus === 'UNKNOWN' || metric?.sensorStatus === 'STALE' ? '#94a3b8'
    : Number(metric?.occupancyRatio ?? metric?.filtered_k ?? 0) >= .8 ? '#ef4444'
      : Number(metric?.occupancyRatio ?? metric?.filtered_k ?? 0) >= .5 ? '#fbbf24' : '#5d96c5';

const sidePosition = (visual, side) => ({
  front: [0, 0, -visual.depthMeters / 2], right: [visual.widthMeters / 2, 0, 0],
  back: [0, 0, visual.depthMeters / 2], left: [-visual.widthMeters / 2, 0, 0],
}[side] || [0, 0, -visual.depthMeters / 2]);
const sideRotation = (side) => ({ front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 }[side] || 0);

function Beam({ from, to, color = '#fff7ed' }) {
  const { position, quaternion, length } = useMemo(() => {
    const start = new THREE.Vector3(...from); const end = new THREE.Vector3(...to); const vector = end.clone().sub(start);
    return { position: start.add(end).multiplyScalar(.5), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize()), length: vector.length() };
  }, [from, to]);
  return <mesh position={position} quaternion={quaternion}><cylinderGeometry args={[.028, .028, length, 6]} /><meshStandardMaterial color={color} roughness={.5} /></mesh>;
}

function DoorFrame({ width }) {
  const opening = Math.min(width * .7, 1.05);
  return <group position={[0, .42, 0]}><mesh position={[-opening / 2, 0, 0]}><boxGeometry args={[.08, .84, .08]} /><meshStandardMaterial color="#f8fafc" /></mesh><mesh position={[opening / 2, 0, 0]}><boxGeometry args={[.08, .84, .08]} /><meshStandardMaterial color="#f8fafc" /></mesh><mesh position={[0, .4, 0]}><boxGeometry args={[opening + .12, .08, .08]} /><meshStandardMaterial color="#f8fafc" /></mesh></group>;
}

function LandingPortal({ visual, side }) {
  const [x, , z] = sidePosition(visual, side);
  const opening = Math.min(1.05, side === 'front' || side === 'back' ? visual.widthMeters * .7 : visual.depthMeters * .7);
  return <group position={[x, .02, z]} rotation={[0, sideRotation(side), 0]}><mesh position={[0, .04, .035]}><boxGeometry args={[opening, .08, .16]} /><meshStandardMaterial color="#fde7c4" roughness={.65} /></mesh><DoorFrame width={opening} /></group>;
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

function AreaBlock({ area, scene, activeFloor, floorView, floors, selected, editable, corridorMode, snap, onSelect, onMove, onPreview, onStartCorridor, onDragState, stairwell, portalOptions }) {
  const [dragging, setDragging] = useState(false);
  const visual = visualForArea(area); const kind = areaVisualKind(area); const position = worldPosition(area, scene, activeFloor, floorView, floors);
  const opacity = floorView === 'overview' && area.floor !== activeFloor ? .25 : 1;
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -position[1]), [position]);
  const directions = stairwell ? stairwell.members.filter((member) => member.floor !== area.floor).map((member) => member.floor > area.floor ? `▲ T${member.floor}` : `▼ T${member.floor}`) : [];
  const stairSide = area.type === 'stairs' ? stairEntranceSide(area, [0, 0, -1], portalOptions) : 'front';
  const move = (event) => { const point = new THREE.Vector3(); if (event.ray.intersectPlane(plane, point)) { const next = planPosition(point.x, point.z, scene, snap); onPreview?.(next); onMove({ ...area, ...next }); } };
  const select = (event) => { event.stopPropagation(); if (corridorMode && onStartCorridor) onStartCorridor(area); else onSelect({ type: 'area', data: area }); };
  const stopDrag = (event) => { if (!dragging) return; event.target.releasePointerCapture(event.pointerId); setDragging(false); onDragState?.(false); onPreview?.(null); };
  const hitGeometry = kind === 'junction' ? <cylinderGeometry args={[junctionRadius(area), junctionRadius(area), .3, 24]} /> : <boxGeometry args={[visual.widthMeters, .3, visual.depthMeters]} />;
  return <group position={position} rotation={[0, THREE.MathUtils.degToRad(visual.rotationDegrees || 0), 0]}>
    <mesh onClick={select} onPointerDown={(event) => { if (!editable || corridorMode) return; event.stopPropagation(); event.target.setPointerCapture(event.pointerId); setDragging(true); onDragState?.(true); }} onPointerMove={(event) => dragging && move(event)} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
      {hitGeometry}<meshBasicMaterial transparent opacity={0} />
    </mesh>
    {kind === 'junction' ? <><mesh><cylinderGeometry args={[junctionRadius(area), junctionRadius(area) * .94, .26, 24]} /><meshStandardMaterial color={visual.color} roughness={.72} transparent opacity={opacity} /></mesh><mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .16, 0]}><torusGeometry args={[junctionRadius(area) * .74, .035, 6, 24]} /><meshStandardMaterial color="#d9fff6" roughness={.6} transparent opacity={opacity} /></mesh></> : <><RoundedBox args={[visual.widthMeters, .26, visual.depthMeters]} radius={.1} smoothness={2}><meshStandardMaterial color={visual.color} roughness={.8} transparent opacity={opacity} /></RoundedBox>{area.type !== 'stairs' && <RoundedBox args={[visual.widthMeters, visual.heightMeters, visual.depthMeters]} radius={.1} smoothness={2} position={[0, visual.heightMeters / 2, 0]}><meshStandardMaterial color={visual.color} transparent opacity={opacity * .14} depthWrite={false} /></RoundedBox>}</>}
    {area.type === 'stairs' && floorView === 'focus' && <LandingPortal visual={visual} side={stairSide} />}
    {area.type === 'stairs' && floorView === 'focus' && <StairLanding visual={visual} side={stairSide} directions={directions} />}
    {selected && <mesh position={[0, .24, 0]}>{kind === 'junction' ? <ringGeometry args={[junctionRadius(area) + .09, junctionRadius(area) + .15, 24]} /> : <boxGeometry args={[visual.widthMeters + .16, .07, visual.depthMeters + .16]} />}<meshBasicMaterial color="#fff" /></mesh>}
    <Html position={[0, visual.heightMeters + .2, 0]} center distanceFactor={11} style={{ pointerEvents: 'none' }}><div className="scene3d-label">{area.name}</div></Html>
  </group>;
}

function CorridorBlock({ corridor, areaA, areaB, scene, activeFloor, floorView, floors, metric, blocked, selected, onSelect, showOperational, portalOptions }) {
  const geometry = corridorGeometry(areaA, areaB, scene, activeFloor, floorView, floors, portalOptions); const width = corridorDisplayWidth(corridor.widthMeters); const color = corridorColor(metric, blocked, showOperational);
  const select = (event) => { event.stopPropagation(); onSelect({ type: 'corridor', data: corridor }); };
  const apron = (point, key) => <mesh key={key} position={[point[0], point[1] + .04, point[2]]}><cylinderGeometry args={[width * .56, width * .68, .1, 16]} /><meshStandardMaterial color={color} roughness={.7} /></mesh>;
  if (geometry.direct) return <group position={geometry.center} rotation={[0, geometry.yaw, 0]} onClick={select}><RoundedBox args={[width, .14, geometry.length]} radius={.05} smoothness={2}><meshStandardMaterial color={color} roughness={.7} /></RoundedBox><DoorFrame width={width} /></group>;
  return <group onClick={select}>
    {apron(geometry.start, 'start')}{apron(geometry.end, 'end')}
    <group position={geometry.center} rotation={[0, geometry.yaw, 0]}>
      <RoundedBox args={[width + .1, .08, geometry.length + .1]} radius={.06} smoothness={2}><meshStandardMaterial color="#cbd5e1" roughness={.75} /></RoundedBox>
      <RoundedBox args={[Math.max(.2, width - .16), .12, geometry.length]} radius={.04} smoothness={2} position={[0, .08, 0]}><meshStandardMaterial color={color} roughness={.7} /></RoundedBox>
      {[-1, 1].map((side) => <RoundedBox key={side} args={[.12, .54, geometry.length]} radius={.04} smoothness={2} position={[side * (width / 2 - .06), .31, 0]}><meshStandardMaterial color="#eff6ff" roughness={.62} /></RoundedBox>)}
      <group position={[0, 0, -geometry.length / 2]}><DoorFrame width={width} /></group><group position={[0, 0, geometry.length / 2]} rotation={[0, Math.PI, 0]}><DoorFrame width={width} /></group>
      {selected && <mesh position={[0, .11, 0]}><boxGeometry args={[width + .16, .22, geometry.length + .16]} /><meshBasicMaterial color="#fff" wireframe /></mesh>}
    </group>
  </group>;
}

function StairwellCore({ well, scene, activeFloor, floors, portalOptions }) {
  const members = well.members.slice().sort((a, b) => a.floor - b.floor); const visual = well.visual3d;
  return <group>{members.map((area) => { const side = stairEntranceSide(area, [0, 0, -1], { ...portalOptions, stairwells: [well] }); return <group key={`landing-${area.id}`} position={[well.planAnchor.x / scene.planUnitsPerMeter, floorDisplayY(area.floor, floors, scene, activeFloor, 'overview'), well.planAnchor.y / scene.planUnitsPerMeter]} rotation={[0, THREE.MathUtils.degToRad(visual.rotationDegrees), 0]}><RoundedBox args={[visual.widthMeters, .18, visual.depthMeters]} radius={.09} smoothness={2}><meshStandardMaterial color="#d58643" roughness={.75} /></RoundedBox><LandingPortal visual={visual} side={side} /></group>; })}
    {members.slice(0, -1).map((area, index) => <StairFlight key={`flight-${area.id}`} lower={area} upper={members[index + 1]} well={well} scene={scene} activeFloor={activeFloor} floors={floors} portalOptions={portalOptions} />)}
  </group>;
}

function StairFlight({ lower, upper, well, scene, activeFloor, floors, portalOptions }) {
  const layout = stairFlightLayout(well, lower, upper, scene, activeFloor, floors, portalOptions); const visual = well.visual3d; const half = layout.steps / 2; const width = Math.min(.82, visual.widthMeters * .32); const offset = width * .62; const run = layout.run; const riser = layout.rise / layout.steps;
  const upperDepth = layout.upperSide === 'front' || layout.upperSide === 'back' ? visual.depthMeters : visual.widthMeters;
  return <group position={[well.planAnchor.x / scene.planUnitsPerMeter, layout.lowerPosition[1], well.planAnchor.y / scene.planUnitsPerMeter]} rotation={[0, THREE.MathUtils.degToRad(visual.rotationDegrees), 0]}><group rotation={[0, layout.localRotation, 0]}>
    <RoundedBox args={[visual.widthMeters, .12, .7]} radius={.05} smoothness={2} position={[0, layout.rise / 2, run / 2]}><meshStandardMaterial color="#d58643" roughness={.75} /></RoundedBox>
    {Array.from({ length: half }, (_, index) => <React.Fragment key={index}>
      <RoundedBox args={[width, (index + 1) * riser, run / half]} radius={.025} smoothness={1} position={[-offset, (index + 1) * riser / 2, -run / 2 + (index + .5) * run / half]}><meshStandardMaterial color="#f9d7a8" roughness={.75} /></RoundedBox>
      <RoundedBox args={[width, layout.rise / 2 + (index + 1) * riser, run / half]} radius={.025} smoothness={1} position={[offset, (layout.rise / 2 + (index + 1) * riser) / 2, run / 2 - (index + .5) * run / half]}><meshStandardMaterial color="#f9d7a8" roughness={.75} /></RoundedBox>
    </React.Fragment>)}
    {[-1, 1].flatMap((side) => [<Beam key={`a-${side}`} from={[-offset + side * width / 2, .28, -run / 2]} to={[-offset + side * width / 2, layout.rise / 2 + .28, run / 2]} />, <Beam key={`b-${side}`} from={[offset + side * width / 2, layout.rise / 2 + .28, run / 2]} to={[offset + side * width / 2, layout.rise + .28, -run / 2]} />])}
  </group>
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

function SceneContents({ areas, corridors, stairwells, activeFloor, scene, selectedItem, onSelectItem, onAddArea, onUpdateArea, onAddCorridor, editTool, editable, occupancyData, edgeMetrics, incidentData, simulationStatus, floorView, command, snap }) {
  const floors = useMemo(() => [...new Set(areas.map((area) => area.floor))].sort((a, b) => a - b), [areas]); const settings = sceneSettings(scene); const [pendingStart, setPendingStart] = useState(null); const [preview, setPreview] = useState(null); const [dragging, setDragging] = useState(false);
  const visibleAreas = areas.filter((area) => visibleOnFloor(area, activeFloor, floorView)); const areaById = useMemo(() => Object.fromEntries(areas.map((area) => [area.id, area])), [areas]); const wells = useMemo(() => stairwells.map((well) => ({ ...well, members: well.areaIds.map((id) => areaById[id]).filter(Boolean) })), [stairwells, areaById]); const portalOptions = useMemo(() => ({ stairwells: wells, corridors, areasById: areaById }), [wells, corridors, areaById]);
  const maxPlan = Math.max(8, ...visibleAreas.map((area) => Math.max(Math.abs(area.x / settings.planUnitsPerMeter), Math.abs(area.y / settings.planUnitsPerMeter)))); const gridSize = Math.max(18, Math.ceil(maxPlan * 2 + 8));
  const startCorridor = (area) => { if (editTool !== 'addCorridor') return; if (!pendingStart) setPendingStart(area); else if (pendingStart.id !== area.id) { onAddCorridor(pendingStart.id, area.id); setPendingStart(null); } };
  const activeY = floorDisplayY(activeFloor, floors, settings, activeFloor, floorView);
  const renderedCorridors = corridors.filter((corridor) => { const a = areaById[corridor.areaA_id]; const b = areaById[corridor.areaB_id]; return a && b && a.floor === b.floor && (floorView === 'overview' || a.floor === activeFloor); });
  return <>
    <color attach="background" args={['#dce8ef']} /><fog attach="fog" args={['#dce8ef', 20, Math.max(60, gridSize * 2.6)]} /><hemisphereLight args={['#ffffff', '#8fa7b9', 1.15]} /><ambientLight intensity={.4} /><directionalLight position={[10, 18, 8]} intensity={1.35} />
    <Grid args={[gridSize, gridSize]} position={[0, activeY - .02, 0]} cellSize={settings.gridSizeMeters} cellThickness={.7} sectionSize={settings.gridSizeMeters * 5} fadeDistance={gridSize} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, activeY - .04, 0]} onPointerMove={(event) => { if (editable && (editTool === 'addArea' || editTool === 'select')) setPreview(planPosition(event.point.x, event.point.z, scene, snap)); }} onClick={(event) => { if (editable && editTool === 'addArea') { const next = planPosition(event.point.x, event.point.z, scene, snap); onAddArea(next.x, next.y); } else if (editTool !== 'addCorridor') onSelectItem(null); }}><planeGeometry args={[gridSize, gridSize]} /><meshBasicMaterial transparent opacity={0} /></mesh>
    {renderedCorridors.map((corridor) => <CorridorBlock key={corridor.id} corridor={corridor} areaA={areaById[corridor.areaA_id]} areaB={areaById[corridor.areaB_id]} scene={scene} activeFloor={activeFloor} floorView={floorView} floors={floors} metric={edgeMetrics?.[corridor.id]} blocked={incidentData?.blockedEdges?.includes(corridor.id)} showOperational={simulationStatus === 'running' || simulationStatus === 'stopped'} selected={selectedItem?.type === 'corridor' && selectedItem.data.id === corridor.id} onSelect={onSelectItem} portalOptions={portalOptions} />)}
    {floorView === 'overview' && wells.map((well) => <StairwellCore key={well.id} well={well} scene={settings} activeFloor={activeFloor} floors={floors} portalOptions={portalOptions} />)}
    <PeopleDots corridors={renderedCorridors} areasById={areaById} scene={scene} activeFloor={activeFloor} floorView={floorView} floors={floors} metrics={edgeMetrics} occupancyData={occupancyData} simulationStatus={simulationStatus} portalOptions={portalOptions} />
    {visibleAreas.map((area) => <AreaBlock key={area.id} area={area} scene={scene} activeFloor={activeFloor} floorView={floorView} floors={floors} selected={selectedItem?.type === 'area' && selectedItem.data.id === area.id} editable={editable && editTool === 'select'} corridorMode={editable && editTool === 'addCorridor'} snap={snap} onSelect={onSelectItem} onMove={onUpdateArea} onPreview={setPreview} onStartCorridor={startCorridor} onDragState={setDragging} stairwell={wells.find((well) => well.id === area.stairwellId)} portalOptions={portalOptions} />)}
    {editable && preview && <group position={[preview.x / settings.planUnitsPerMeter, activeY + .06, preview.y / settings.planUnitsPerMeter]}><mesh><sphereGeometry args={[.12, 10, 10]} /><meshBasicMaterial color={snap ? '#22c55e' : '#f97316'} /></mesh><Html position={[0, .35, 0]} center><div className="scene3d-hint">{snap ? 'Snap' : 'Tự do'}: {preview.x.toFixed(1)}, {preview.y.toFixed(1)}</div></Html></group>}
    <CameraRig areas={areas} scene={scene} activeFloor={activeFloor} floorView={floorView} floors={floors} command={command} dragging={dragging} />
  </>;
}

function canUseWebGL() { try { const canvas = document.createElement('canvas'); return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')); } catch { return false; } }
function WebGLUnavailable({ onSwitchTo2d, onRetry }) { return <div className="scene3d-fallback"><div><p className="scene3d-fallback-title">Không thể khởi tạo không gian 3D.</p><div className="scene3d-fallback-actions"><button onClick={onRetry}>Thử lại 3D</button><button onClick={onSwitchTo2d}>Mở sơ đồ 2D</button></div></div></div>; }

export default function BuildingScene3D(props) {
  const [snap, setSnap] = useState(true); const [floorView, setFloorView] = useState('focus'); const [command, setCommand] = useState('fit'); const [webglAvailable, setWebglAvailable] = useState(null); const [canvasKey, setCanvasKey] = useState(0);
  useEffect(() => setWebglAvailable(canUseWebGL()), []); useEffect(() => setCommand(`fit-${props.activeFloor}-${floorView}`), [props.activeFloor, floorView]);
  return <div className="scene3d-root"><div className="scene3d-toolbar"><button onClick={() => setFloorView((value) => value === 'focus' ? 'overview' : 'focus')}>{floorView === 'focus' ? 'Tầng đang chọn' : 'Toàn nhà tách lớp'}</button><button onClick={() => setCommand(`fit-${Date.now()}`)}>Fit</button><button onClick={() => setCommand('iso')}>Isometric</button><button onClick={() => setCommand('top')}>Top-down</button>{props.editable ? <button onClick={() => setSnap((value) => !value)}>{snap ? 'Snap lưới: bật' : 'Snap lưới: tắt'}</button> : <span>Khóa chỉnh sửa</span>}</div>{webglAvailable === false ? <WebGLUnavailable onRetry={() => { setWebglAvailable(canUseWebGL()); setCanvasKey((value) => value + 1); }} onSwitchTo2d={props.onSwitchTo2d} /> : <Canvas key={canvasKey} dpr={[1, 1.25]} flat gl={{ antialias: false, alpha: false, powerPreference: 'default' }} camera={{ position: [14, 16, 14], fov: 42 }} fallback={<WebGLUnavailable onSwitchTo2d={props.onSwitchTo2d} onRetry={() => setCanvasKey((value) => value + 1)} />}><SceneContents {...props} floorView={floorView} command={command} snap={snap} /></Canvas>}</div>;
}
