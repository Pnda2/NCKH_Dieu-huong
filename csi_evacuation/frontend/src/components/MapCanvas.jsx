import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Stage, Layer, Circle, Line, Arrow, Text, Image, Group, Rect } from 'react-konva';
import useImage from 'use-image';

const AREA_RADIUS = 28;
const ROOM_HALF = 30;
const MIN_SCALE = 0.45;
const MAX_SCALE = 2.6;

const AREA_STYLE = {
  room:   { fill: '#334155', stroke: '#1e293b', icon: 'ROOM' },
  stairs: { fill: '#d97706', stroke: '#92400e', icon: 'STAIRS' },
  exit:   { fill: '#16a34a', stroke: '#14532d', icon: 'EXIT' },
};

const isJunction = (area) => area?.type === 'room' && area?.visualKind === 'junction';
const nodeBoundaryPoint = (area, nx, ny) => {
  if (area?.type === 'room' && !isJunction(area)) {
    const distance = Math.min(ROOM_HALF / Math.max(Math.abs(nx), .0001), ROOM_HALF / Math.max(Math.abs(ny), .0001));
    return { x: area.x + nx * distance, y: area.y + ny * distance };
  }
  const radius = isJunction(area) ? AREA_RADIUS - 2 : AREA_RADIUS + 2;
  return { x: area.x + nx * radius, y: area.y + ny * radius };
};

function BackgroundImage({ data, mode, onUpdate }) {
  const [image] = useImage(data?.src || data);
  if (!image || !data) return null;

  const x = data.x || 0;
  const y = data.y || 0;
  const scale = data.scale || 1;
  const opacity = data.opacity !== undefined ? data.opacity : 0.5;

  return (
    <Image 
      image={image} 
      opacity={opacity} 
      x={x} 
      y={y} 
      scaleX={scale} 
      scaleY={scale} 
      draggable={mode === 'edit'}
      onDragEnd={(e) => {
        if (onUpdate) {
          onUpdate({ ...data, x: e.target.x(), y: e.target.y() });
        }
      }}
    />
  );
}

const AreaNode = React.memo(function AreaNode({
  area, isSelected, isPendingStart, mode, editTool, isBlocked,
  onSelect, onChange, onStartCorridor, crossFloorLabels, stairCongestion
}) {
  const style = AREA_STYLE[area.type] || AREA_STYLE.room;
  const junction = isJunction(area);
  const isDraggable = mode === 'edit' && editTool === 'select';
  const stairColor = stairCongestion?.color;

  const handleClick = (e) => {
    e.cancelBubble = true;
    if (mode === 'edit' && editTool === 'addCorridor') {
      onStartCorridor(area);
    } else {
      onSelect();
    }
  };

  return (
    <Group
      x={area.x}
      y={area.y}
      draggable={isDraggable}
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        onChange({ ...area, x: e.target.x(), y: e.target.y() });
      }}
    >
      {/* Technical bounding indicator when selected or pending */}
      {(isSelected || isPendingStart) && (
        <Rect
          x={-ROOM_HALF - 6}
          y={-ROOM_HALF - 6}
          width={(ROOM_HALF + 6) * 2}
          height={(ROOM_HALF + 6) * 2}
          stroke={isPendingStart ? '#16a34a' : '#2563eb'}
          strokeWidth={1.5}
          dash={[4, 3]}
          cornerRadius={4}
          listening={false}
        />
      )}
      {/* Subtle crisp base silhouette */}
      {area.type === 'room' && !junction ? (
        <Rect
          x={-ROOM_HALF}
          y={-ROOM_HALF}
          width={ROOM_HALF * 2}
          height={ROOM_HALF * 2}
          cornerRadius={4}
          fill={isBlocked ? '#475569' : style.fill}
          stroke={isSelected ? '#2563eb' : (isBlocked ? '#334155' : style.stroke)}
          strokeWidth={isSelected ? 2.5 : 1.5}
        />
      ) : (
        <Circle
          radius={AREA_RADIUS}
          fill={isBlocked ? '#475569' : (junction ? '#0f766e' : style.fill)}
          stroke={isSelected ? '#2563eb' : (isBlocked ? '#334155' : (stairColor || (junction ? '#042f2e' : style.stroke)))}
          strokeWidth={isSelected ? 2.5 : 1.5}
        />
      )}
      {/* Visual Marker / Icon */}
      {area.type === 'exit' ? (
        <Group listening={false}>
          <Rect x={-18} y={-9} width={36} height={18} fill="#14532d" cornerRadius={2} />
          <Text
            text={isBlocked ? 'CLOSED' : 'EXIT'}
            fontSize={9}
            fontStyle="bold"
            fontFamily="monospace, sans-serif"
            fill="#ffffff"
            align="center"
            verticalAlign="middle"
            width={36}
            height={18}
            x={-18}
            y={-9}
          />
        </Group>
      ) : area.type === 'stairs' ? (
        <Text
          text={
            (crossFloorLabels?.some(l => l.startsWith('▼')) && crossFloorLabels?.some(l => l.startsWith('▲'))) ? '⇅'
              : (crossFloorLabels?.some(l => l.startsWith('▼')) ? '↓' : '↑')
          }
          fontSize={15}
          fontStyle="bold"
          fill="white"
          align="center"
          verticalAlign="middle"
          width={AREA_RADIUS * 2}
          height={AREA_RADIUS * 2}
          x={-AREA_RADIUS}
          y={-AREA_RADIUS}
          listening={false}
        />
      ) : (
        <Text
          text={junction ? '✛' : '■'}
          fontSize={12}
          fill="rgba(255,255,255,0.7)"
          align="center"
          verticalAlign="middle"
          width={AREA_RADIUS * 2}
          height={AREA_RADIUS * 2}
          x={-AREA_RADIUS}
          y={-AREA_RADIUS}
          listening={false}
        />
      )}
      {/* Technical Annotation label */}
      <Rect
        x={-52}
        y={AREA_RADIUS + 4}
        width={104}
        height={16}
        fill="rgba(255, 255, 255, 0.95)"
        stroke="#cbd5e1"
        strokeWidth={1}
        cornerRadius={2}
        listening={false}
      />
      <Text
        text={area.name}
        fontSize={10}
        fontStyle="bold"
        fontFamily="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
        fill="#0f172a"
        align="center"
        verticalAlign="middle"
        width={104}
        height={16}
        x={-52}
        y={AREA_RADIUS + 4}
        listening={false}
      />
      {/* Cross-floor label for stairs */}
      {crossFloorLabels && crossFloorLabels.length > 0 && (
        <Text
          text={crossFloorLabels.join(' | ')}
          fontSize={9}
          fontStyle="bold"
          fill="#b45309"
          align="center"
          width={100}
          x={-50}
          y={AREA_RADIUS + 22}
          listening={false}
        />
      )}
      {mode === 'view' && area.type === 'stairs' && stairCongestion && (
        <Group y={AREA_RADIUS + 34} listening={false}>
          <Rect
            x={-56}
            width={112}
            height={20}
            fill={stairCongestion.background}
            stroke={stairColor}
            strokeWidth={1}
            cornerRadius={3}
          />
          <Text
            x={-54}
            y={2}
            width={108}
            height={16}
            text={stairCongestion.label}
            fill="#ffffff"
            fontSize={9}
            fontStyle="bold"
            align="center"
            verticalAlign="middle"
          />
        </Group>
      )}
    </Group>
  );
});

const CorridorEdge = React.memo(function CorridorEdge({ corridor, areaA, areaB, isSelected, onSelect, mode, occupancyData, isBlocked, edgeMetric, simulationStatus }) {
  if (!areaA || !areaB) return null;

  const running = simulationStatus === 'running' || simulationStatus === 'stopped';
  const ratio = running ? (occupancyData[corridor.id] || 0) : 0;
  const hazard = edgeMetric?.hazard || 0;

  // Determine color and thickness
  let strokeColor, strokeWidth;
  if (mode === 'view') {
    if (isBlocked || edgeMetric?.blocked || hazard >= 100) {
      strokeColor = '#475569'; strokeWidth = 5;
    } else if (hazard > 0) {
      strokeColor = '#ea580c'; strokeWidth = 6;
    } else if (ratio >= 0.8) {
      strokeColor = '#dc2626'; strokeWidth = 6 + ratio * 2;
    } else if (ratio >= 0.5) {
      strokeColor = '#d97706'; strokeWidth = 5 + ratio * 2;
    } else {
      strokeColor = running ? '#16a34a' : '#94a3b8'; strokeWidth = running ? 3.5 + ratio * 2 : 3;
    }
  } else {
    strokeColor = isSelected ? '#2563eb' : '#94a3b8';
    strokeWidth = isSelected ? 4 : 2.5;
  }

  // Shorten line endpoints to not overlap circles
  const dx = areaB.x - areaA.x;
  const dy = areaB.y - areaA.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const start = nodeBoundaryPoint(areaA, nx, ny);
  const end = nodeBoundaryPoint(areaB, -nx, -ny);
  const x1 = start.x;
  const y1 = start.y;
  const x2 = end.x;
  const y2 = end.y;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <Group onClick={(e) => { e.cancelBubble = true; onSelect(); }} onTap={(e) => { e.cancelBubble = true; onSelect(); }}>
      {/* Wide invisible hit area */}
      <Line points={[x1, y1, x2, y2]} stroke="transparent" strokeWidth={24} />

      {/* Main line */}
      <Line
        points={[x1, y1, x2, y2]}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        lineCap="round"
      />
      
      {/* Blocked overlay in view mode */}
      {isBlocked && mode === 'view' && (
        <Line points={[x1, y1, x2, y2]} stroke="#1e293b" strokeWidth={4} dash={[8, 6]} lineCap="round" />
      )}

      {/* Selected dashed overlay in edit mode */}
      {isSelected && mode === 'edit' && (
        <Line points={[x1, y1, x2, y2]} stroke="#ffffff" strokeWidth={1.5} dash={[6, 4]} lineCap="round" opacity={0.8} />
      )}

      {/* Fill ratio label in view mode */}
      {mode === 'view' && running && len > 50 && !isBlocked && (
        <Group x={midX} y={midY}>
          <Rect x={-17} y={-8} width={34} height={16} fill="#0f172a" stroke="#334155" strokeWidth={1} cornerRadius={2} />
          <Text
            x={-17} y={-8} width={34} height={16}
            text={`${Math.round(ratio * 100)}%`}
            fontSize={9}
            fontFamily="monospace, sans-serif"
            fontStyle="bold"
            fill={ratio >= 0.8 ? '#fca5a5' : ratio >= 0.5 ? '#fcd34d' : '#86efac'}
            align="center"
            verticalAlign="middle"
            listening={false}
          />
        </Group>
      )}

      {/* Corridor name label in edit mode */}
      {mode === 'edit' && len > 70 && (
        <Group x={midX} y={midY}>
          <Rect x={-40} y={-9} width={80} height={18} fill="rgba(255,255,255,0.95)" stroke="#cbd5e1" strokeWidth={1} cornerRadius={2} />
          <Text
            x={-40} y={-9} width={80} height={18}
            text={corridor.name}
            fontSize={9}
            fontStyle="bold"
            fill="#334155"
            align="center"
            verticalAlign="middle"
            listening={false}
          />
        </Group>
      )}
    </Group>
  );
});

const GuidanceArrow = React.memo(function GuidanceArrow({ area, otherArea, probability, occupancy = 0, isBlocked = false }) {
  if (!area || !otherArea || area.floor !== otherArea.floor) return null;
  const dx = otherArea.x - area.x;
  const dy = otherArea.y - area.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / length;
  const ny = dy / length;
  const usableStart = AREA_RADIUS + 8;
  const usableEnd = length - AREA_RADIUS - 8;
  const usableLength = usableEnd - usableStart;
  if (usableLength < 22) return null;

  const arrowColor = isBlocked
    ? '#475569'
    : occupancy >= 0.8
      ? '#dc2626'
      : occupancy >= 0.5
        ? '#d97706'
        : '#16a34a';
  const labelColor = isBlocked
    ? '#334155'
    : occupancy >= 0.8
      ? '#991b1b'
      : occupancy >= 0.5
        ? '#92400e'
        : '#14532d';
  const arrowLength = Math.min(52, usableLength - 4);
  const starts = usableLength >= 145
    ? [
        usableStart + 8,
        usableEnd - arrowLength - 8,
      ]
    : [
        usableStart + Math.min(12, Math.max(2, (usableLength - arrowLength) / 2)),
      ];
  const firstStart = starts[0];
  const labelDistance = firstStart + arrowLength * 0.35;
  const labelX = area.x + nx * labelDistance - ny * 18 - 18;
  const labelY = area.y + ny * labelDistance + nx * 18 - 6;

  return (
    <Group listening={false}>
      {starts.map((start, index) => {
        const end = Math.min(usableEnd, start + arrowLength);
        const points = [
          area.x + nx * start,
          area.y + ny * start,
          area.x + nx * end,
          area.y + ny * end,
        ];
        return (
          <Arrow
            key={index}
            points={points}
            stroke={arrowColor}
            fill={arrowColor}
            strokeWidth={5}
            pointerLength={10}
            pointerWidth={10}
            shadowColor={arrowColor}
            shadowBlur={7}
            shadowOpacity={0.65}
          />
        );
      })}
      <Text
        x={labelX}
        y={labelY}
        width={36}
        text={`${Math.round((probability || 0) * 100)}%`}
        fontSize={9}
        fontStyle="bold"
        fill={labelColor}
        align="center"
      />
    </Group>
  );
});

const DeviceMarker = React.memo(function DeviceMarker({ device, area, index, liveState }) {
  if (!area) return null;
  const status = liveState?.status || 'idle';
  const statusColor = status === 'online'
    ? '#22c55e'
    : status === 'waiting_ack'
      ? '#f59e0b'
      : status === 'offline'
        ? '#ef4444'
        : '#94a3b8';
  return (
    <Group x={area.x + 31 + index * 23} y={area.y - 38}>
      <Rect width={21} height={21} x={-10.5} y={-10.5} cornerRadius={6}
        fill={device.type === 'sign' ? '#0e7490' : '#6d28d9'} stroke="white" strokeWidth={1} />
      <Text text={device.type === 'sign' ? '↗' : '♪'} x={-10} y={-8}
        width={20} height={18} align="center" fill="white" fontSize={13} fontStyle="bold" />
      <Circle x={8} y={-8} radius={3.5} fill={statusColor} stroke="white" strokeWidth={1} />
    </Group>
  );
});

export default function MapCanvas({
  mode, editTool,
  areas, onAreaUpdate,
  corridors, crossFloorCorridors, allAreas,
  selectedItem, onSelectItem,
  onAddArea, onAddCorridor,
  occupancyData, incidentData, edgeMetrics, simulationStatus, devices, guidanceState, backgroundImage, onUpdateBackgroundImage
}) {
  const [pendingStart, setPendingStart] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(1);

  const containerRef = useRef();
  const stageRef = useRef();
  // Konva moves the stage outside React while dragging. Keep that live position
  // in a ref so incoming realtime updates cannot snap it back to an old state.
  const stagePosRef = useRef({ x: 0, y: 0 });

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    setStageSize({ width: el.offsetWidth, height: el.offsetHeight });
    return () => observer.disconnect();
  }, []);

  // Reset pending start when tool changes
  useEffect(() => {
    if (editTool !== 'addCorridor') setPendingStart(null);
  }, [editTool]);

  const handleWheel = (e) => {
    e.evt.preventDefault();
    const scaleBy = 1.1;
    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    let direction = e.evt.deltaY > 0 ? -1 : 1;
    const requestedScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, requestedScale));

    const nextPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    stagePosRef.current = nextPos;
    setStageScale(newScale);
    setStagePos(nextPos);
  };

  const handleStageClick = (e) => {
    const isStage = e.target === stageRef.current;
    if (!isStage) return;

    if (mode === 'edit' && editTool === 'addArea') {
      const pointer = stageRef.current.getPointerPosition();
      const x = (pointer.x - stagePosRef.current.x) / stageScale;
      const y = (pointer.y - stagePosRef.current.y) / stageScale;
      onAddArea(x, y);
    } else if (mode === 'edit' && editTool === 'addCorridor') {
      setPendingStart(null);
    } else {
      onSelectItem(null);
    }
  };

  const handleMouseMove = () => {
    if (pendingStart && stageRef.current) {
      const pointer = stageRef.current.getPointerPosition();
      if (pointer) {
        setMousePos({
          x: (pointer.x - stagePosRef.current.x) / stageScale,
          y: (pointer.y - stagePosRef.current.y) / stageScale
        });
      }
    }
  };

  const handleAreaStartCorridor = (area) => {
    if (!pendingStart) {
      setPendingStart(area);
    } else if (pendingStart.id !== area.id) {
      onAddCorridor(pendingStart.id, area.id);
      setPendingStart(null);
    }
  };

  const setViewport = (scale, position) => {
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    stagePosRef.current = position;
    setStageScale(nextScale);
    setStagePos(position);
  };

  const zoomAtCenter = (factor) => {
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, stageScale * factor));
    const centerX = stageSize.width / 2;
    const centerY = stageSize.height / 2;
    const worldX = (centerX - stagePosRef.current.x) / stageScale;
    const worldY = (centerY - stagePosRef.current.y) / stageScale;
    setViewport(nextScale, { x: centerX - worldX * nextScale, y: centerY - worldY * nextScale });
  };

  const fitToMap = () => {
    if (!areas.length) return setViewport(1, { x: 0, y: 0 });
    const xs = areas.map(area => area.x);
    const ys = areas.map(area => area.y);
    const padding = 100;
    const minX = Math.min(...xs) - padding;
    const maxX = Math.max(...xs) + padding;
    const minY = Math.min(...ys) - padding;
    const maxY = Math.max(...ys) + padding;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const scale = Math.min(stageSize.width / width, stageSize.height / height, 1.5);
    setViewport(scale, { x: (stageSize.width - width * scale) / 2 - minX * scale, y: (stageSize.height - height * scale) / 2 - minY * scale });
  };

  // Compute cross-floor labels for staircase areas
  const getCrossFloorLabels = (area) => {
    if (area.type !== 'stairs') return [];
    const labels = [];
    crossFloorCorridors.forEach(c => {
      if (c.areaA_id !== area.id && c.areaB_id !== area.id) return;
      const otherId = c.areaA_id === area.id ? c.areaB_id : c.areaA_id;
      const other = allAreas.find(a => a.id === otherId);
      if (!other) return;
      const label = other.floor > area.floor ? `▲ T${other.floor}` : `▼ T${other.floor}`;
      if (!labels.includes(label)) labels.push(label);
    });
    return labels;
  };

  const getStairCongestion = (area) => {
    if (area.type !== 'stairs') return null;
    const connected = (crossFloorCorridors || [])
      .filter(edge => edge.areaA_id === area.id || edge.areaB_id === area.id)
      .map(edge => {
        const metric = edgeMetrics?.[edge.id] || {};
        const ratio = Math.max(0, Math.min(
          1,
          Number(occupancyData?.[edge.id] ?? metric.filtered_k ?? metric.occupancyRatio ?? 0)
        ));
        const otherId = edge.areaA_id === area.id ? edge.areaB_id : edge.areaA_id;
        const other = allAreas.find(item => item.id === otherId);
        return {
          edge,
          ratio,
          otherFloor: other?.floor,
          blocked: incidentData?.blockedEdges?.includes(edge.id) || metric.blocked,
          sensorStatus: metric.sensorStatus || 'OK',
        };
      });
    if (!connected.length) return null;

    const selected = connected.sort((left, right) => {
      if (left.blocked !== right.blocked) return left.blocked ? -1 : 1;
      if ((left.sensorStatus !== 'OK') !== (right.sensorStatus !== 'OK')) {
        return left.sensorStatus !== 'OK' ? -1 : 1;
      }
      return right.ratio - left.ratio;
    })[0];

    if (selected.blocked) {
      return { color: '#64748b', background: 'rgba(51,65,85,0.94)', label: `T${selected.otherFloor ?? '?'} · BỊ CHẶN` };
    }
    if (selected.sensorStatus === 'STALE' || selected.sensorStatus === 'UNKNOWN') {
      return { color: '#94a3b8', background: 'rgba(51,65,85,0.94)', label: `T${selected.otherFloor ?? '?'} · ${selected.sensorStatus}` };
    }
    const percentage = Math.round(selected.ratio * 100);
    if (selected.ratio >= 0.8) {
      return { color: '#ef4444', background: 'rgba(127,29,29,0.94)', label: `T${selected.otherFloor ?? '?'} · RẤT ĐÔNG ${percentage}%` };
    }
    if (selected.ratio >= 0.5) {
      return { color: '#f59e0b', background: 'rgba(120,53,15,0.94)', label: `T${selected.otherFloor ?? '?'} · ĐÔNG ${percentage}%` };
    }
    return { color: '#22c55e', background: 'rgba(20,83,45,0.94)', label: `T${selected.otherFloor ?? '?'} · THOÁNG ${percentage}%` };
  };

  // Rebuild the grid only when the committed viewport changes, not for each
  // dashboard update from the simulator.
  const gridDots = useMemo(() => {
    const gridStartX = Math.floor(-stagePos.x / stageScale / 40) - 1;
    const gridStartY = Math.floor(-stagePos.y / stageScale / 40) - 1;
    const gridEndX = gridStartX + Math.ceil(stageSize.width / stageScale / 40) + 2;
    const gridEndY = gridStartY + Math.ceil(stageSize.height / stageScale / 40) + 2;
    const dots = [];
    for (let xi = gridStartX; xi < gridEndX; xi++) {
      for (let yi = gridStartY; yi < gridEndY; yi++) {
        dots.push(<Circle key={xi + '-' + yi} x={xi * 40 + 20} y={yi * 40 + 20} radius={1} fill="#cbd5e1" />);
      }
    }
    return dots;
  }, [stagePos.x, stagePos.y, stageScale, stageSize.width, stageSize.height]);

  // Cursor
  let cursor = 'default';
  if (editTool === 'addArea') cursor = 'crosshair';
  if (editTool === 'addCorridor') cursor = 'cell';
  if (editTool === 'select' || mode === 'view') cursor = 'grab';

  return (
    <div ref={containerRef} className="relative" style={{ cursor, width: '100%', height: '100%' }}>
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        x={stagePosRef.current.x}
        y={stagePosRef.current.y}
        scaleX={stageScale}
        scaleY={stageScale}
        draggable={editTool === 'select' || mode === 'view'}
        onDragStart={(e) => {
          if (e.target === stageRef.current && containerRef.current) {
            containerRef.current.style.cursor = 'grabbing';
          }
        }}
        onDragMove={(e) => {
          if (e.target === stageRef.current) {
            stagePosRef.current = { x: e.target.x(), y: e.target.y() };
          }
        }}
        onDragEnd={(e) => {
          if (containerRef.current) {
            containerRef.current.style.cursor = editTool === 'select' || mode === 'view' ? 'grab' : 'default';
          }
          if (e.target === stageRef.current) {
            const nextPos = { x: e.target.x(), y: e.target.y() };
            stagePosRef.current = nextPos;
            setStagePos(nextPos);
          }
        }}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onMouseMove={handleMouseMove}
        style={{ background: '#f1f5f9' }}
      >
        {/* Background image layer */}
        <Layer>
          {backgroundImage && <BackgroundImage data={backgroundImage} mode={mode} onUpdate={onUpdateBackgroundImage} />}
        </Layer>

        {/* Grid dots (subtle) */}
        <Layer listening={false}>
          {gridDots}
        </Layer>

        {/* Corridor (Edge) layer */}
        <Layer>
          {corridors.map(corridor => {
            const areaA = areas.find(a => a.id === corridor.areaA_id);
            const areaB = areas.find(a => a.id === corridor.areaB_id);
            return (
              <CorridorEdge
                key={corridor.id}
                corridor={corridor}
                areaA={areaA}
                areaB={areaB}
                isSelected={selectedItem?.data?.id === corridor.id}
                isBlocked={incidentData?.blockedEdges?.includes(corridor.id)}
                onSelect={() => onSelectItem({ type: 'corridor', data: corridor })}
                mode={mode}
                occupancyData={occupancyData}
                edgeMetric={edgeMetrics?.[corridor.id]}
                simulationStatus={simulationStatus}
              />
            );
          })}

          {/* Pending corridor preview line */}
          {pendingStart && (
            <Line
              points={[pendingStart.x, pendingStart.y, mousePos.x || pendingStart.x, mousePos.y || pendingStart.y]}
              stroke="#22c55e"
              strokeWidth={3}
              dash={[8, 5]}
              opacity={0.7}
            />
          )}
        </Layer>

        {/* Guidance stays above thick corridor lines so both arrows remain visible. */}
        {mode === 'view' && (
          <Layer>
            {areas.map(area => {
              const decision = guidanceState?.decisions?.[area.id];
              if (!decision?.next_edge) return null;
              const routes = decision.routes?.length
                ? decision.routes
                : [{ edge_id: decision.next_edge, probability: decision.probability }];
              return routes.map(route => {
                const edge = [...corridors, ...(crossFloorCorridors || [])]
                  .find(item => item.id === route.edge_id);
                if (!edge) return null;
                const otherId = edge.areaA_id === area.id ? edge.areaB_id : edge.areaA_id;
                const otherArea = allAreas.find(item => item.id === otherId);
                return (
                  <GuidanceArrow
                    key={`guide-${area.id}-${edge.id}`}
                    area={area}
                    otherArea={otherArea}
                    probability={route.probability}
                    occupancy={occupancyData?.[edge.id] ?? 0}
                    isBlocked={incidentData?.blockedEdges?.includes(edge.id)}
                  />
                );
              });
            })}
          </Layer>
        )}

        {/* Area (Node) layer */}
        <Layer>
          {areas.map(area => (
            <AreaNode
              key={area.id}
              area={area}
              isSelected={selectedItem?.data?.id === area.id}
              isBlocked={incidentData?.blockedExits?.includes(area.id)}
              isPendingStart={pendingStart?.id === area.id}
              mode={mode}
              editTool={editTool}
              crossFloorLabels={getCrossFloorLabels(area)}
              stairCongestion={getStairCongestion(area)}
              onSelect={() => onSelectItem({ type: 'area', data: area })}
              onChange={(updated) => onAreaUpdate?.(updated)}
              onStartCorridor={handleAreaStartCorridor}
            />
          ))}
        </Layer>

        {/* Configured signs and speakers */}
        <Layer>
          {(devices || []).filter(device => areas.some(area => area.id === device.area_id)).map(device => {
            const area = areas.find(item => item.id === device.area_id);
            const siblings = devices.filter(item => item.area_id === device.area_id);
            const index = siblings.findIndex(item => item.id === device.id);
            const liveState = guidanceState?.devices?.find(item => item.id === device.id);
            return <DeviceMarker key={device.id} device={device} area={area} index={index} liveState={liveState} />;
          })}
        </Layer>
      </Stage>

      <div className="absolute right-3 top-3 map-control-group">
        <button type="button" onClick={() => zoomAtCenter(1.2)} aria-label="Phóng to" className="map-control" title="Phóng to">+</button>
        <button type="button" onClick={() => zoomAtCenter(1 / 1.2)} aria-label="Thu nhỏ" className="map-control" title="Thu nhỏ">−</button>
        <button type="button" onClick={fitToMap} aria-label="Căn vừa sơ đồ" className="map-control map-control-fit" title="Căn vừa sơ đồ">FIT</button>
        <button type="button" onClick={() => setViewport(1, { x: 0, y: 0 })} aria-label="Tỷ lệ 1:1" className="map-control map-control-fit" title="Tỷ lệ 1:1">1:1</button>
      </div>

      {/* Pending start hint */}
      {pendingStart && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-slate-900 border border-emerald-500/80 text-emerald-300 text-xs font-medium px-3 py-1.5 rounded shadow pointer-events-none flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Đã chọn <strong>{pendingStart.name}</strong> — Click khu vực đích để nối hành lang</span>
        </div>
      )}
      
      {/* Zoom / Pan Instructions overlay */}
      <div className="absolute bottom-3 left-3 bg-slate-900/90 px-2.5 py-1 rounded border border-slate-700/80 text-[11px] text-slate-400 font-mono pointer-events-none">
        ZOOM: {Math.round(stageScale * 100)}% · CUỘN/KÉO ĐỂ DI CHUYỂN
      </div>
    </div>
  );
}
