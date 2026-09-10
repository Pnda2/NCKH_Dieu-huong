import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { extractCorridorCsiTopology } from './scene3d';

/** Bán kính chấm đen của node CSI (mét) */
const NODE_RADIUS = 0.038;

/** Thời lượng của một chu kỳ truyền tín hiệu của một link (giây) */
const BURST_CYCLE_SECONDS = 2.0;

/** Số cung sóng vô tuyến đồng tâm */
const WAVE_COUNT = 3;

/** Số đoạn phân chia trên mỗi cung sóng để tạo đường cong mượt */
const ARC_SEGMENTS = 18;

/** Góc mở tối đa của cung sóng (radian, ~46 độ) */
const ARC_MAX_ANGLE = (46 * Math.PI) / 180;

function stableHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 1000) / 1000;
}

/**
 * Hiển thị một chấm đen nhỏ trên tường, phát sáng nhẹ khi đang là Transmitter
 */
function CsiNodeDot({ node, topo, simulationStatus }) {
  const matRef = useRef();
  const phaseOffset = useMemo(() => stableHash(topo.corridorId) * 2.5, [topo.corridorId]);

  useFrame(({ clock }) => {
    if (!matRef.current || !topo.links.length) return;
    const time = clock.getElapsedTime();
    const cycleDuration = simulationStatus === 'running' ? BURST_CYCLE_SECONDS : BURST_CYCLE_SECONDS * 1.35;
    const corridorTime = time + phaseOffset;

    const burstIndex = Math.floor(corridorTime / cycleDuration);
    const activeLinkIndex = burstIndex % topo.links.length;
    const activeLink = topo.links[activeLinkIndex];
    const isReversed = burstIndex % 2 === 1;
    const activeTxNode = isReversed ? activeLink.nodeB : activeLink.nodeA;

    if (activeTxNode.id === node.id) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 9);
      matRef.current.color.set('#0ea5e9');
      matRef.current.emissive.set('#38bdf8');
      matRef.current.emissiveIntensity = 0.5 + pulse * 0.4;
    } else {
      matRef.current.color.set('#090d16');
      matRef.current.emissive.set('#000000');
      matRef.current.emissiveIntensity = 0;
    }
  });

  return (
    <mesh position={node.position} renderOrder={5}>
      <sphereGeometry args={[NODE_RADIUS, 12, 10]} />
      <meshStandardMaterial
        ref={matRef}
        color="#090d16"
        roughness={0.35}
        metalness={0.2}
      />
    </mesh>
  );
}

/**
 * Vẽ 3 cung sóng vô tuyến truyền chéo qua lòng hành lang cho hành lang cụ thể
 */
function CsiCorridorWaveRibbon({ topo, simulationStatus, isHighlighted }) {
  const meshRef = useRef();
  const phaseOffset = useMemo(() => stableHash(topo.corridorId) * 2.5, [topo.corridorId]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const totalVertices = WAVE_COUNT * (ARC_SEGMENTS + 1) * 2;
    const positions = new Float32Array(totalVertices * 3);
    const indices = [];

    let vertOffset = 0;
    for (let w = 0; w < WAVE_COUNT; w += 1) {
      const base = vertOffset;
      for (let s = 0; s < ARC_SEGMENTS; s += 1) {
        const i0 = base + s * 2;
        const i1 = i0 + 1;
        const i2 = i0 + 2;
        const i3 = i0 + 3;
        indices.push(i0, i1, i2, i1, i3, i2);
      }
      vertOffset += (ARC_SEGMENTS + 1) * 2;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    return geo;
  }, []);

  useFrame(({ clock }) => {
    if (!geometry || !topo.links.length) return;
    const time = clock.getElapsedTime();
    const cycleDuration = simulationStatus === 'running' ? BURST_CYCLE_SECONDS : BURST_CYCLE_SECONDS * 1.35;
    const corridorTime = time + phaseOffset;

    const burstIndex = Math.floor(corridorTime / cycleDuration);
    const activeLinkIndex = burstIndex % topo.links.length;
    const activeLink = topo.links[activeLinkIndex];
    const tau = (corridorTime % cycleDuration) / cycleDuration;
    const isReversed = burstIndex % 2 === 1;

    const txPos = isReversed ? activeLink.nodeB.position : activeLink.nodeA.position;
    const rxPos = isReversed ? activeLink.nodeA.position : activeLink.nodeB.position;

    // Vector hướng truyền chéo từ Tx sang Rx
    const dx = rxPos[0] - txPos[0];
    const dz = rxPos[2] - txPos[2];
    const dist = Math.hypot(dx, dz) || 1;
    const ux = dx / dist;
    const uz = dz / dist;
    const vx = -uz;
    const vz = ux; // tiếp tuyến vuông góc với đường truyền chéo
    const midY = (txPos[1] + rxPos[1]) / 2;

    const posAttr = geometry.attributes.position;
    const posArr = posAttr.array;

    const envelope = Math.sin(tau * Math.PI); // 0 -> 1 -> 0 cực kỳ mượt
    let vertIdx = 0;
    const ribbonHalfWidth = 0.015;

    for (let w = 0; w < WAVE_COUNT; w += 1) {
      const wavePhase = (tau * 1.5 + w * 0.22) % 1.0;
      const r = Math.max(0.04, wavePhase * dist);
      const waveFade = Math.sin(wavePhase * Math.PI) * envelope;
      const effectiveRibbonWidth = ribbonHalfWidth * Math.max(0.15, waveFade);

      for (let s = 0; s <= ARC_SEGMENTS; s += 1) {
        const normAngle = (s / ARC_SEGMENTS) * 2 - 1; // -1 đến +1
        const angle = normAngle * ARC_MAX_ANGLE;

        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        // Bán kính uốn cong chéo qua hành lang
        const lateralScale = Math.min(0.36, dist * 0.38);
        const forward = r * cosA;
        const lateral = sinA * lateralScale * (0.28 + wavePhase * 0.72);

        const centerX = txPos[0] + ux * forward + vx * lateral;
        const centerZ = txPos[2] + uz * forward + vz * lateral;

        posArr[vertIdx] = centerX + ux * effectiveRibbonWidth;
        posArr[vertIdx + 1] = midY;
        posArr[vertIdx + 2] = centerZ + uz * effectiveRibbonWidth;

        posArr[vertIdx + 3] = centerX - ux * effectiveRibbonWidth;
        posArr[vertIdx + 4] = midY;
        posArr[vertIdx + 5] = centerZ - uz * effectiveRibbonWidth;

        vertIdx += 6;
      }
    }

    posAttr.needsUpdate = true;
  });

  return (
    <mesh ref={meshRef} geometry={geometry} renderOrder={6}>
      <meshBasicMaterial
        color={isHighlighted ? '#67e8f9' : '#38bdf8'}
        transparent
        opacity={isHighlighted ? 0.65 : 0.44}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * Component quản lý toàn bộ mạng lưới node CSI so le và các luồng sóng đồng thời
 */
export default React.memo(function CsiSensorNetwork3D({
  corridorModels = [],
  simulationStatus,
  selectedItem,
}) {
  // Trích xuất cấu trúc topology node so le và các link lân cận cho mỗi hành lang
  const corridorsTopology = useMemo(() => {
    return corridorModels.map((model) => extractCorridorCsiTopology(model, 9.0));
  }, [corridorModels]);

  const hasNodes = corridorsTopology.some((t) => t.nodes.length > 0);
  if (!hasNodes) return null;

  return (
    <group>
      {/* 1. Hiển thị toàn bộ các Node CSI CHẤM ĐEN nhỏ, phân bố SO LE ở hai bên tường */}
      {corridorsTopology.map((topo) => (
        <group key={`nodes-${topo.corridorId}`}>
          {topo.nodes.map((node) => (
            <CsiNodeDot
              key={node.id}
              node={node}
              topo={topo}
              simulationStatus={simulationStatus}
            />
          ))}
        </group>
      ))}

      {/* 2. Hiệu ứng sóng vô tuyến đồng thời trên TẤT CẢ hành lang */}
      {corridorsTopology.map((topo) => {
        if (!topo.links.length) return null;
        const isSelected = selectedItem?.type === 'corridor' && selectedItem.data.id === topo.corridorId;

        return (
          <CsiCorridorWaveRibbon
            key={`wave-${topo.corridorId}`}
            topo={topo}
            simulationStatus={simulationStatus}
            isHighlighted={isSelected}
          />
        );
      })}
    </group>
  );
});
