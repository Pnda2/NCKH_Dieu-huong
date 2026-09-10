import React, { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import MapCanvas from './components/MapCanvas';
import AreaForm from './components/AreaForm';
import CorridorEdgeForm from './components/CorridorEdgeForm';
import DeviceRegistryForm from './components/DeviceRegistryForm';
import { corridorDefaults, linkStairwell, pruneStairwells, syncStairwellUpdate, updateStairwellLanding } from './components/stairwells';

const BuildingScene3D = React.lazy(() => import('./components/BuildingScene3D'));

const SERVER_URL = import.meta.env.VITE_WIEVAC_API_URL || 'http://localhost:3001';
const DEFAULT_CORRIDOR_WIDTH_METERS = 1.2;
const DEFAULT_SCENE_3D = { planUnitsPerMeter: 40, floorHeightMeters: 3.2, floorExplodeMeters: 2, gridSizeMeters: 1 };

const normalizeCorridor = (corridor) => {
  const parsedWidth = Number(corridor.widthMeters);
  const hasValidWidth = Number.isFinite(parsedWidth) && parsedWidth > 0;
  return {
    ...corridor,
    widthMeters: hasValidWidth ? parsedWidth : DEFAULT_CORRIDOR_WIDTH_METERS,
    widthEstimated: hasValidWidth ? Boolean(corridor.widthEstimated) : true,
    lengthEstimated: corridor.lengthEstimated === undefined ? true : Boolean(corridor.lengthEstimated),
  };
};

function App() {
  const [mode, setMode] = useState('view');
  const [viewportMode, setViewportMode] = useState('2d');
  const [editTool, setEditTool] = useState('select'); // 'select' | 'addArea' | 'addCorridor'

  const [areas, setAreas] = useState([]);       // Nodes
  const [corridors, setCorridors] = useState([]); // Edges
  const [stairwells, setStairwells] = useState([]);
  const [devices, setDevices] = useState([]);

  const [selectedItem, setSelectedItem] = useState(null); // { type: 'area'|'corridor', data: {...} }

  const [occupancyData, setOccupancyData] = useState({});
  const [incidentData, setIncidentData] = useState({ blockedEdges: [], blockedExits: [] });
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState([]);
  const [simulationState, setSimulationState] = useState({
    status: 'idle', elapsedSeconds: 0, initialLoad: 0, evacuatedLoad: 0,
    remainingLoad: 0, trappedLoad: 0, trappedCorridors: [],
    averageOccupancy: 0, occupiedCorridors: 0, edgeOccupancy: {},
  });
  const [densityStep] = useState(5);
  const [behaviorSettings, setBehaviorSettings] = useState({ guidance_compliance: 0.7 });
  const [showChaosHelp, setShowChaosHelp] = useState(false);
  const [showCorridorDetails, setShowCorridorDetails] = useState(false);
  const hazardRequestRef = useRef(null);
  const [guidanceState, setGuidanceState] = useState({ decisions: {}, devices: [] });
  const [mapLoadState, setMapLoadState] = useState('loading');
  const [notice, setNotice] = useState(null);
  const [pendingFloorDelete, setPendingFloorDelete] = useState(null);

  const [floors, setFloors] = useState([1]);
  const [activeFloor, setActiveFloor] = useState(1);
  const [floorImages, setFloorImages] = useState({});
  const [scene3d, setScene3d] = useState(DEFAULT_SCENE_3D);

  const notify = (message, tone = 'info') => {
    setNotice({ message, tone, id: Date.now() });
  };

  const pendingSimStateRef = useRef(null);
  const pendingGuidanceRef = useRef(null);
  const rafIdRef = useRef(null);

  const flushTelemetry = () => {
    rafIdRef.current = null;
    if (pendingSimStateRef.current) {
      const data = pendingSimStateRef.current;
      pendingSimStateRef.current = null;
      setSimulationState(data);
      if (data?.status === 'running') {
        setMode('view');
        setEditTool('select');
      }
      if (data?.status === 'idle') {
        setOccupancyData(data.edgeOccupancy || {});
        setGuidanceState({ decisions: {}, devices: [] });
      }
    }
    if (pendingGuidanceRef.current) {
      const gData = pendingGuidanceRef.current;
      pendingGuidanceRef.current = null;
      setGuidanceState(gData);
    }
  };

  useEffect(() => {
    fetch(`${SERVER_URL}/api/map`)
      .then(res => res.json())
      .then(data => {
        if (data?.areas) setAreas(data.areas);
        if (data?.edges) setCorridors(data.edges.map(normalizeCorridor));
        if (data?.stairwells) setStairwells(data.stairwells);
        if (data?.devices) setDevices(data.devices);
        if (data?.floorImages) setFloorImages(data.floorImages);
        if (data?.scene3d) setScene3d({ ...DEFAULT_SCENE_3D, ...data.scene3d });
        if (data?.floors?.length > 0) {
          setFloors(data.floors);
          setActiveFloor(data.floors[0]);
        }
        setMapLoadState('ready');
      })
      .catch(() => {
        setMapLoadState('error');
        notify('Không thể tải cấu hình bản đồ. Kiểm tra kết nối backend.', 'danger');
      });

    const newSocket = io(SERVER_URL);
    newSocket.on('connect', () => setIsConnected(true));
    newSocket.on('disconnect', () => setIsConnected(false));
    newSocket.on('occupancy_update', (data) => setOccupancyData(prev => ({ ...prev, ...data })));
    newSocket.on('incident_update', (data) => {
      setIncidentData(prev => {
        const nextState = {
          blockedEdges: [...prev.blockedEdges],
          blockedExits: [...prev.blockedExits]
        };
        const list = data.type === 'edge' ? nextState.blockedEdges : nextState.blockedExits;

        if (data.action === 'blocked') {
          if (!list.includes(data.target_id)) list.push(data.target_id);
        } else if (data.action === 'cleared') {
          const idx = list.indexOf(data.target_id);
          if (idx >= 0) list.splice(idx, 1);
        }
        return nextState;
      });
    });
    newSocket.on('system_log', (data) => {
      setLogs(prev => {
        const newLogs = [...data.events, ...prev];
        return newLogs.slice(0, 50); // Keep last 50 events
      });
    });
    newSocket.on('simulation_state', (data) => {
      pendingSimStateRef.current = data;
      if (!rafIdRef.current) rafIdRef.current = requestAnimationFrame(flushTelemetry);
    });
    newSocket.on('occupancy_adjust_ack', (data) => {
      if (data?.success === false) notify(data.error || 'Yêu cầu điều chỉnh tải bị từ chối.', 'danger');
    });
    newSocket.on('guidance_state', (data) => {
      pendingGuidanceRef.current = data;
      if (!rafIdRef.current) rafIdRef.current = requestAnimationFrame(flushTelemetry);
    });
    newSocket.on('occupancy_state', (data) => {
      if (data?.edgeMetrics) {
        pendingSimStateRef.current = {
          ...(pendingSimStateRef.current || {}),
          edgeMetrics: data.edgeMetrics,
        };
        if (!rafIdRef.current) rafIdRef.current = requestAnimationFrame(flushTelemetry);
      }
    });

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  // ─── Area (Node) Handlers ─────────────────────────
  const handleAddArea = (x, y, visualKind = 'room') => {
    const newArea = {
      id: `a_${Date.now()}`,
      name: `Khu vực ${areas.length + 1}`,
      type: 'room',
      visualKind: visualKind === 'junction' ? 'junction' : 'room',
      x,
      y,
      floor: activeFloor,
    };
    setAreas(prev => [...prev, newArea]);
    setSelectedItem({ type: 'area', data: newArea });
    setEditTool('select');
  };

  const handleUpdateArea = (updatedArea) => {
    if (updatedArea.stairwellId) {
      const synced = syncStairwellUpdate(areas, stairwells, updatedArea);
      setAreas(synced.areas);
      setStairwells(synced.stairwells);
      setSelectedItem({ type: 'area', data: synced.areas.find((area) => area.id === updatedArea.id) });
      return;
    }
    setAreas(prev => prev.map(a => a.id === updatedArea.id ? updatedArea : a));
    setSelectedItem({ type: 'area', data: updatedArea });
  };

  const handleUpdateStairwellLanding = (stairwellId, areaId, entranceSide) => {
    setStairwells((previous) => updateStairwellLanding(previous, stairwellId, areaId, entranceSide));
  };

  const handleDeleteArea = (areaId) => {
    const nextAreas = areas.filter(a => a.id !== areaId);
    const pruned = pruneStairwells(nextAreas, stairwells);
    setAreas(pruned.areas);
    setStairwells(pruned.stairwells);
    setCorridors(prev => prev.filter(c => c.areaA_id !== areaId && c.areaB_id !== areaId));
    setDevices(prev => prev.filter(device => device.area_id !== areaId));
    setSelectedItem(null);
  };

  // ─── Corridor (Edge) Handlers ─────────────────────
  const handleAddCorridor = (areaA_id, areaB_id) => {
    const areaA = areas.find(a => a.id === areaA_id);
    const areaB = areas.find(a => a.id === areaB_id);
    if (!areaA || !areaB) return;

    const exists = corridors.some(
      c => (c.areaA_id === areaA_id && c.areaB_id === areaB_id) ||
        (c.areaA_id === areaB_id && c.areaB_id === areaA_id)
    );
    if (exists) return;

    const newCorridor = {
      id: `e_${Date.now()}`,
      name: `${areaA.name} – ${areaB.name}`,
      ...corridorDefaults(),
      initialOccupancy: 0.5,
      flowCapacity: undefined,
      areaA_id,
      areaB_id,
    };
    setCorridors(prev => [...prev, newCorridor]);
    if (areaA.type === 'stairs' && areaB.type === 'stairs' && areaA.floor !== areaB.floor) {
      const linked = linkStairwell(areas, stairwells, areaA_id, areaB_id, () => `sw_${Date.now()}`);
      setAreas(linked.areas);
      setStairwells(linked.stairwells);
    }
    setSelectedItem({ type: 'corridor', data: newCorridor });
  };

  const handleUpdateCorridor = (updatedCorridor) => {
    setCorridors(prev => prev.map(c => c.id === updatedCorridor.id ? updatedCorridor : c));
    setSelectedItem({ type: 'corridor', data: updatedCorridor });
  };

  const handleDeleteCorridor = (corridorId) => {
    setCorridors(prev => prev.filter(c => c.id !== corridorId));
    setSelectedItem(null);
  };

  const handleAddDevice = (type, areaId) => {
    const id = `d_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const device = {
      id,
      name: type === 'sign' ? `Bảng hiệu ${devices.filter(item => item.type === 'sign').length + 1}` : `Loa ${devices.filter(item => item.type === 'speaker').length + 1}`,
      type,
      area_id: areaId,
      orientation: 0,
      topic: '',
      edgeDirections: {},
    };
    setDevices(prev => [...prev, device]);
  };

  const handleUpdateDevice = (updatedDevice) => {
    setDevices(prev => prev.map(device => device.id === updatedDevice.id ? updatedDevice : device));
  };

  const handleDeleteDevice = (deviceId) => {
    setDevices(prev => prev.filter(device => device.id !== deviceId));
  };

  const handleToggleCorridor = (areaId1, areaId2) => {
    const existingIndex = corridors.findIndex(
      c => (c.areaA_id === areaId1 && c.areaB_id === areaId2) ||
        (c.areaA_id === areaId2 && c.areaB_id === areaId1)
    );

    if (existingIndex >= 0) {
      setCorridors(prev => prev.filter((_, idx) => idx !== existingIndex));
    } else {
      const areaA = areas.find(a => a.id === areaId1);
      const areaB = areas.find(a => a.id === areaId2);
      if (!areaA || !areaB) return;
      const newCorridor = {
        id: `e_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: `${areaA.name} – ${areaB.name}`,
        ...corridorDefaults(),
        initialOccupancy: 0.5,
        flowCapacity: undefined,
        areaA_id: areaId1,
        areaB_id: areaId2,
      };
      setCorridors(prev => [...prev, newCorridor]);
      if (areaA.type === 'stairs' && areaB.type === 'stairs' && areaA.floor !== areaB.floor) {
        const linked = linkStairwell(areas, stairwells, areaId1, areaId2, () => `sw_${Date.now()}`);
        setAreas(linked.areas);
        setStairwells(linked.stairwells);
      }
    }
  };

  // ─── Floor Handlers ───────────────────────────────
  const handleAddFloor = () => {
    const newFloorNum = floors.length > 0 ? Math.max(...floors) + 1 : 1;
    setFloors(prev => [...prev, newFloorNum]);
    setActiveFloor(newFloorNum);
  };

  const handleDuplicateFloor = (floorNum) => {
    const newFloorNum = floors.length > 0 ? Math.max(...floors) + 1 : 1;

    let maxAreaNum = 0;
    areas.forEach(a => {
      const match = a.name.match(/^Khu vực (\d+)$/i);
      if (match) {
        maxAreaNum = Math.max(maxAreaNum, parseInt(match[1], 10));
      }
    });
    let nextAreaNumber = maxAreaNum > 0 ? maxAreaNum + 1 : areas.length + 1;

    const idMap = {};
    const nameMap = {};
    const areasToClone = areas.filter(a => a.floor === floorNum);
    const newAreas = areasToClone.map(a => {
      const newId = `area_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      idMap[a.id] = newId;

      let newName = a.name;
      if (/^Khu vực \d+$/i.test(newName)) {
        newName = `Khu vực ${nextAreaNumber++}`;
      }
      nameMap[newId] = newName;

      const { stairwellId: _stairwellId, ...rest } = a;

      return { ...rest, id: newId, name: newName, floor: newFloorNum };
    });

    const corridorsToClone = corridors.filter(c => idMap[c.areaA_id] && idMap[c.areaB_id]);
    const newCorridors = corridorsToClone.map(c => {
      const newA = idMap[c.areaA_id];
      const newB = idMap[c.areaB_id];
      return {
        ...c,
        id: `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: `${nameMap[newA]} – ${nameMap[newB]}`,
        areaA_id: newA,
        areaB_id: newB
      };
    });

    if (floorImages[floorNum]) {
      setFloorImages(prev => ({ ...prev, [newFloorNum]: floorImages[floorNum] }));
    }

    setFloors(prev => [...prev, newFloorNum]);
    setAreas(prev => [...prev, ...newAreas]);
    setCorridors(prev => [...prev, ...newCorridors]);
    setActiveFloor(newFloorNum);
  };

  const handleDeleteFloor = (floorNum, confirmed = false) => {
    if (!confirmed) {
      setPendingFloorDelete(floorNum);
      return;
    }
    const remaining = floors.filter(f => f !== floorNum);
    const nextFloors = remaining.length === 0 ? [1] : remaining;
    setFloors(nextFloors);
    setActiveFloor(nextFloors[0]);

    const areaIdsOnFloor = areas.filter(a => a.floor === floorNum).map(a => a.id);
    const nextAreas = areas.filter(a => a.floor !== floorNum);
    const pruned = pruneStairwells(nextAreas, stairwells);
    setAreas(pruned.areas);
    setStairwells(pruned.stairwells);
    setCorridors(prev => prev.filter(c =>
      !areaIdsOnFloor.includes(c.areaA_id) && !areaIdsOnFloor.includes(c.areaB_id)
    ));
    setDevices(prev => prev.filter(device => !areaIdsOnFloor.includes(device.area_id)));
    setFloorImages(prev => { const n = { ...prev }; delete n[floorNum]; return n; });
    setSelectedItem(null);
    setPendingFloorDelete(null);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) =>
      setFloorImages(prev => ({
        ...prev,
        [activeFloor]: { src: evt.target.result, x: 0, y: 0, scale: 1, opacity: 0.5 }
      }));
    reader.readAsDataURL(file);
  };

  const handleSaveMap = () => {
    fetch(`${SERVER_URL}/api/map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        areas,
        edges: corridors.map(normalizeCorridor),
        devices,
        floorImages,
        floors,
        schemaVersion: 3,
        scene3d,
        stairwells,
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) notify('Đã lưu cấu hình bản đồ và gửi xuống Pi 5.', 'success');
        else notify(data.error || 'Không thể lưu bản đồ.', 'danger');
      })
      .catch(() => notify('Không thể lưu bản đồ. Backend không phản hồi.', 'danger'));
  };

  const handleStartSimulation = () => {
    if (!isConnected) {
      notify('Máy chủ Backend (port 3001) đang mất kết nối. Vui lòng đảm bảo dịch vụ đã được khởi động qua lệnh: python scripts/start_all.py', 'danger');
      return;
    }
    const endpoint = simulationState.status === 'stopped'
      ? '/api/simulate/resume'
      : '/api/simulate';
    fetch(`${SERVER_URL}${endpoint}`, { method: 'POST' })
      .then(async res => {
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Không thể chạy mô phỏng');
        setSimulationState(prev => ({ ...prev, status: 'running' }));
        setMode('view');
        setEditTool('select');
      })
      .catch(err => {
        const msg = err.message === 'Failed to fetch'
          ? 'Không thể kết nối đến máy chủ Backend (port 3001). Hãy đảm bảo đã chạy: python scripts/start_all.py'
          : err.message;
        notify(msg, 'danger');
      });
  };

  const handleStopSimulation = () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setSimulationState(prev => ({ ...prev, status: 'stopped' }));
    fetch(`${SERVER_URL}/api/simulate/stop`, { method: 'POST' })
      .then(async res => {
        if (!res.ok) throw new Error('Không thể dừng mô phỏng');
      })
      .catch(() => notify('Không thể dừng mô phỏng. Backend không phản hồi.', 'danger'));
  };

  const handleResetSimulation = () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingSimStateRef.current = null;
    pendingGuidanceRef.current = null;
    setOccupancyData({});
    setGuidanceState({ decisions: {}, devices: [] });
    setSimulationState(prev => ({ ...prev, status: 'idle', edgeOccupancy: {}, edgeMetrics: {}, forecast: null }));

    fetch(`${SERVER_URL}/api/simulate/reset`, { method: 'POST' })
      .then(async res => {
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Không thể reset mô phỏng');
      })
      .catch(err => {
        const msg = err.message === 'Failed to fetch'
          ? 'Không thể kết nối đến máy chủ Backend (port 3001).'
          : err.message;
        notify(msg, 'danger');
      });
  };

  const saveBehaviorSettings = () => {
    fetch(`${SERVER_URL}/api/simulation/behavior`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(behaviorSettings),
    }).then(async (res) => {
      const data = await res.json(); if (!res.ok || data.error) throw new Error(data.error || 'Không thể cập nhật kịch bản');
      notify('Đã cập nhật kịch bản hỗn loạn.', 'success');
    }).catch((err) => notify(err.message, 'danger'));
  };

  const handleAdjustOccupancy = (edgeId, deltaPercent) => {
    if (!edgeId || !deltaPercent) return;
    fetch(`${SERVER_URL}/api/occupancy/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edge_id: edgeId, delta: deltaPercent / 100 }),
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Không thể điều chỉnh mật độ');
      })
      .catch(err => notify(err.message, 'danger'));
  };

  // ─── Derived state ────────────────────────────────
  const handleAdjustHazard = (edgeId, hazard) => {
    if (hazardRequestRef.current) clearTimeout(hazardRequestRef.current);
    hazardRequestRef.current = setTimeout(() => {
      fetch(SERVER_URL + '/api/hazard/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edge_id: edgeId, hazard: Math.max(0, Number(hazard) || 0) }),
      })
        .then(async res => {
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error || 'Khong the cap nhat nguy co');
        })
        .catch(err => notify(err.message, 'danger'));
    }, 250);
  };

  const currentFloorAreas = areas.filter(a => (a.floor || 1) === activeFloor);
  const currentFloorAreaIds = new Set(currentFloorAreas.map(a => a.id));

  const currentFloorCorridors = corridors.filter(
    c => currentFloorAreaIds.has(c.areaA_id) && currentFloorAreaIds.has(c.areaB_id)
  );

  // Cross-floor corridors (stairs connecting different floors)
  const crossFloorCorridors = corridors.filter(c =>
    (currentFloorAreaIds.has(c.areaA_id) && !currentFloorAreaIds.has(c.areaB_id)) ||
    (!currentFloorAreaIds.has(c.areaA_id) && currentFloorAreaIds.has(c.areaB_id))
  );

  // View mode stats
  const occupancyRatios = currentFloorCorridors
    .map(corridor => occupancyData[corridor.id] ?? simulationState.edgeOccupancy?.[corridor.id] ?? 0);
  const avgOccupancy = occupancyRatios.length > 0
    ? occupancyRatios.reduce((a, b) => a + b, 0) / occupancyRatios.length : 0;
  const criticalCount = occupancyRatios.filter(ratio => ratio >= 0.8).length;
  const mapOccupancyData = useMemo(
    () => ({ ...simulationState.edgeOccupancy, ...occupancyData }),
    [simulationState.edgeOccupancy, occupancyData]
  );

  const currentBgImage = floorImages[activeFloor];
  const normalizedBgImage = typeof currentBgImage === 'string'
    ? { src: currentBgImage, x: 0, y: 0, scale: 1, opacity: 0.5 }
    : currentBgImage;

  const formatDuration = (seconds = 0) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const simulationStatusLabel = {
    idle: 'Chưa chạy', running: 'Đang chạy', stopped: 'Đã dừng',
    completed: 'Hoàn thành', trapped: 'Có hành lang mắc kẹt', error: 'Lỗi',
  }[simulationState.status] || simulationState.status;

  return (
    <div className="eoc-shell h-screen bg-slate-950 flex flex-col overflow-hidden text-slate-100" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {notice && (
        <div role="status" className={`fixed z-50 right-4 top-4 max-w-sm rounded border px-3.5 py-2.5 text-xs shadow-lg font-mono ${notice.tone === 'danger'
            ? 'border-red-600/80 bg-red-950 text-red-200'
            : notice.tone === 'success'
              ? 'border-emerald-600/80 bg-emerald-950 text-emerald-200'
              : 'border-slate-700 bg-slate-900 text-slate-200'
          }`}>
          <div className="flex items-start gap-2.5">
            <span className="font-bold uppercase tracking-wider">{notice.tone === 'danger' ? '[ALERT]' : notice.tone === 'success' ? '[SAVED]' : '[INFO]'}</span>
            <span className="flex-1 font-sans text-xs">{notice.message}</span>
            <button type="button" aria-label="Đóng thông báo" onClick={() => setNotice(null)} className="text-current opacity-70 hover:opacity-100 font-bold ml-1">✕</button>
          </div>
        </div>
      )}
      {pendingFloorDelete !== null && (
        <div role="dialog" aria-modal="true" aria-labelledby="delete-floor-title" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h2 id="delete-floor-title" className="text-sm font-bold uppercase tracking-wider text-red-400">Xác nhận xóa Tầng {pendingFloorDelete}?</h2>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">Tất cả khu vực, hành lang, thiết bị và ảnh nền trên tầng này sẽ bị xóa vĩnh viễn khỏi sơ đồ.</p>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button type="button" onClick={() => setPendingFloorDelete(null)} className="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800">Hủy</button>
              <button type="button" onClick={() => handleDeleteFloor(pendingFloorDelete, true)} className="rounded bg-red-700 px-3 py-1.5 font-semibold text-white hover:bg-red-600">Xác nhận xóa</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Header ─── */}
      <header className="bg-slate-950 border-b border-slate-800 px-4 flex justify-between items-center flex-shrink-0 h-[52px]">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-blue-700 border border-blue-500/40 flex items-center justify-center text-white font-bold text-xs tracking-wider">
            W
          </div>
          <div>
            <div className="text-white font-bold text-sm tracking-wide flex items-center gap-2 leading-none">
              <span>WiEvac</span>
              <span className="text-[10px] font-mono text-slate-400 border border-slate-700 px-1 py-0.5 rounded-sm bg-slate-900">MONITOR</span>
            </div>
            <div className="text-[10px] font-mono text-slate-400 mt-1 leading-none">WiFi CSI Emergency Coordination</div>
          </div>
        </div>

        {/* Mode Segmented Control */}
        <div className="flex items-center rounded border border-slate-800 bg-slate-900 p-0.5 text-xs">
          <button
            onClick={() => { setMode('view'); setEditTool('select'); setSelectedItem(null); }}
            className={`px-3 py-1 rounded-sm font-medium transition-colors ${mode === 'view' ? 'bg-blue-700 text-white font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
          >
            Giám sát
          </button>
          <button
            onClick={() => {
              if (simulationState.status === 'running') {
                notify('Dừng mô phỏng trước khi chỉnh sửa cấu trúc tòa nhà.', 'danger');
                return;
              }
              setMode('edit');
            }}
            className={`px-3 py-1 rounded-sm font-medium transition-colors ${mode === 'edit' ? 'bg-blue-700 text-white font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
          >
            Thiết kế
          </button>
        </div>

        {/* Viewport 2D / 3D Segmented Control */}
        <div className="flex items-center rounded border border-slate-800 bg-slate-900 p-0.5 text-xs">
          {['2d', '3d'].map(view => (
            <button
              key={view}
              type="button"
              onClick={() => setViewportMode(view)}
              className={`px-2.5 py-1 rounded-sm font-medium transition-colors ${viewportMode === view ? 'bg-slate-700 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              {view === '2d' ? '2D Sơ đồ' : '3D Khối'}
            </button>
          ))}
        </div>

        {/* Simulation Actions */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleStartSimulation}
            disabled={!['idle', 'stopped'].includes(simulationState.status)}
            className="px-3 py-1.5 rounded font-medium text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            <span>{simulationState.status === 'stopped' ? 'Tiếp tục' : 'Chạy mô phỏng'}</span>
          </button>
          <button
            onClick={handleStopSimulation}
            disabled={simulationState.status !== 'running'}
            className="px-3 py-1.5 rounded font-medium text-xs bg-slate-900 border border-red-800/80 hover:bg-red-950/60 disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600 disabled:cursor-not-allowed text-red-300 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1" /></svg>
            <span>Dừng</span>
          </button>
          <button
            onClick={handleResetSimulation}
            disabled={simulationState.status === 'running'}
            className="px-3 py-1.5 rounded font-medium text-xs bg-slate-900 border border-slate-700 hover:bg-slate-800 disabled:border-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-slate-300 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3 h-3 stroke-current fill-none stroke-2" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
            <span>Reset</span>
          </button>
        </div>

        {/* Live Telemetry Status */}
        <div className="flex items-center gap-2 pl-3 border-l border-slate-800 text-xs font-mono">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className={`font-semibold tracking-wider ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
            {isConnected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ─── Canvas Area ─── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-100">

          {/* Floor Toolbar */}
          <div className="bg-slate-900 border-b border-slate-800 px-3 py-1.5 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider font-semibold mr-1">TẦNG:</span>
              <div className="flex items-center gap-1">
                {floors.map(f => (
                  <div key={f} className="relative flex items-center group">
                    <button
                      onClick={() => { setActiveFloor(f); setSelectedItem(null); }}
                      className={`px-2.5 py-1 text-xs rounded-sm font-medium transition-colors border ${activeFloor === f
                          ? 'bg-blue-700 text-white font-semibold border-blue-600'
                          : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700 border-slate-700'
                        }`}
                    >
                      Tầng {f}
                    </button>
                    {mode === 'edit' && (
                      <div className="absolute left-full h-full flex items-center pl-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto z-10">
                        <div className="flex items-center gap-0.5 bg-slate-900 px-1 py-0.5 rounded border border-slate-700 shadow-md">
                          <button
                            onClick={() => handleDuplicateFloor(f)}
                            className="px-1 py-0.5 text-blue-400 hover:text-blue-300 text-[11px] font-mono"
                            title="Sao chép tầng này"
                          >
                            COPY
                          </button>
                          {floors.length > 1 && (
                            <button
                              onClick={() => handleDeleteFloor(f)}
                              className="px-1 py-0.5 text-red-400 hover:text-red-300 text-[11px] font-mono font-bold"
                              title="Xóa tầng"
                            >
                              DEL
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {mode === 'edit' && (
                  <button
                    onClick={handleAddFloor}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 rounded-sm text-xs font-bold transition-colors"
                    title="Thêm tầng mới"
                  >
                    + TẦNG
                  </button>
                )}
              </div>
            </div>

            {mode === 'edit' ? (
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5 bg-slate-950 p-0.5 rounded border border-slate-800 text-xs">
                  {[
                    { id: 'select', label: 'Chọn' },
                    { id: 'addArea', label: '+ Khu vực' },
                    { id: 'addCorridor', label: '+ Hành lang' },
                  ].map(t => (
                    <button key={t.id} onClick={() => setEditTool(t.id)}
                      className={`px-2.5 py-0.5 rounded-sm font-medium transition-colors ${editTool === t.id ? 'bg-slate-700 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                        }`}
                    >{t.label}</button>
                  ))}
                </div>
                <div className="w-px h-4 bg-slate-700"></div>
                <label className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-sm cursor-pointer font-medium transition-colors flex items-center gap-1">
                  <span>Ảnh nền</span>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
                {normalizedBgImage && (
                  <div className="flex items-center gap-2 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    <span className="text-[10px] font-mono text-slate-400">TỶ LỆ:</span>
                    <input
                      type="range" min="0.1" max="3" step="0.05"
                      value={normalizedBgImage.scale || 1}
                      onChange={(e) => setFloorImages(prev => ({ ...prev, [activeFloor]: { ...normalizedBgImage, scale: Number(e.target.value) } }))}
                      className="w-14 accent-blue-600"
                    />
                    <span className="text-[10px] font-mono text-slate-400 ml-1">MỜ:</span>
                    <input
                      type="range" min="0.1" max="1" step="0.1"
                      value={normalizedBgImage.opacity || 0.5}
                      onChange={(e) => setFloorImages(prev => ({ ...prev, [activeFloor]: { ...normalizedBgImage, opacity: Number(e.target.value) } }))}
                      className="w-14 accent-blue-600"
                    />
                    <button
                      onClick={() => setFloorImages(prev => { const n = { ...prev }; delete n[activeFloor]; return n; })}
                      className="ml-1 text-[11px] text-red-400 hover:text-red-300 font-bold"
                      title="Xóa ảnh nền"
                    >✕</button>
                  </div>
                )}
                <button onClick={handleSaveMap}
                  className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded-sm font-semibold transition-colors flex items-center gap-1 shadow-sm"
                >
                  <svg className="w-3 h-3 stroke-current fill-none stroke-2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                  <span>Lưu sơ đồ</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-slate-400">
                  {currentFloorAreas.length} KV · {currentFloorCorridors.length} HL
                </span>
                {criticalCount > 0 && (
                  <span className="text-red-400 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                    <span>{criticalCount} HL QUÁ TẢI (≥80%)</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Canvas */}
          <div className="flex-1 relative overflow-hidden">
            {mapLoadState === 'loading' ? (
              <div className="h-full grid place-items-center bg-slate-950 text-slate-300"><div className="text-center"><div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" /><p className="font-semibold">Đang tải sơ đồ vận hành…</p><p className="mt-1 text-sm text-slate-500">Đồng bộ cấu hình từ backend</p></div></div>
            ) : mapLoadState === 'error' ? (
              <div className="h-full grid place-items-center bg-slate-950 px-6 text-center text-slate-300"><div><p className="text-lg font-semibold text-red-300">Không thể kết nối backend</p><p className="mt-2 max-w-md text-sm text-slate-400">Dashboard vẫn hiển thị khi máy chủ sẵn sàng. Kiểm tra VITE_WIEVAC_API_URL và trạng thái backend rồi tải lại trang.</p><button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600">Tải lại</button></div></div>
            ) : viewportMode === '3d' ? (
              <React.Suspense fallback={<div className="h-full grid place-items-center bg-slate-950 text-slate-300"><div className="text-center"><div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" /><p className="font-semibold">Đang tải không gian 3D…</p></div></div>}>
                <BuildingScene3D
                  areas={areas}
                  corridors={corridors}
                  stairwells={stairwells}
                  activeFloor={activeFloor}
                  scene={scene3d}
                  selectedItem={selectedItem}
                  onSelectItem={setSelectedItem}
                  onAddArea={handleAddArea}
                  onUpdateArea={handleUpdateArea}
                  onAddCorridor={handleAddCorridor}
                  editTool={editTool}
                  editable={mode === 'edit' && simulationState.status !== 'running'}
                  occupancyData={mapOccupancyData}
                  edgeMetrics={simulationState.edgeMetrics || {}}
                  movementByCorridor={simulationState.movementByCorridor || {}}
                  incidentData={incidentData}
                  devices={devices}
                  guidanceState={guidanceState}
                  simulationStatus={simulationState.status}
                  onSwitchTo2d={() => {
                    setViewportMode('2d');
                    notify('Đã chuyển về chế độ 2D.', 'info');
                  }}
                />
              </React.Suspense>
            ) : currentFloorAreas.length === 0 && mode !== 'edit' ? (
              <div className="h-full grid place-items-center bg-slate-950 px-6 text-center text-slate-300"><div><p className="text-lg font-semibold">Tầng {activeFloor} chưa có khu vực</p><p className="mt-2 text-sm text-slate-500">Chuyển sang chế độ Thiết kế để thêm khu vực và hành lang.</p></div></div>
            ) : <MapCanvas
              mode={mode}
              editTool={editTool}
              areas={currentFloorAreas}
              onAreaUpdate={handleUpdateArea}
              corridors={currentFloorCorridors}
              crossFloorCorridors={crossFloorCorridors}
              allAreas={areas}
              selectedItem={selectedItem}
              onSelectItem={setSelectedItem}
              onAddArea={handleAddArea}
              onAddCorridor={handleAddCorridor}
              occupancyData={mapOccupancyData}
              incidentData={incidentData}
              edgeMetrics={simulationState.edgeMetrics || {}}
              simulationStatus={simulationState.status}
              devices={devices}
              guidanceState={guidanceState}
              backgroundImage={normalizedBgImage}
              onUpdateBackgroundImage={(updated) => setFloorImages(prev => ({ ...prev, [activeFloor]: updated }))}
            />}

            {/* Legend */}
            {mode === 'view' && (
              <div className="absolute bottom-3 right-3 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded text-[11px] text-slate-300 flex items-center gap-3 font-mono shadow-sm pointer-events-none">
                <span className="text-slate-400 uppercase font-semibold">Tải hành lang:</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /><span>Thấp</span></span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /><span>Vừa</span></span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-600 inline-block" /><span>Cao</span></span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-slate-600 inline-block" /><span>Phong tỏa</span></span>
              </div>
            )}
            {mode === 'edit' && (
              <div className="absolute bottom-3 right-3 bg-slate-900/90 border border-slate-700/80 px-3 py-1.5 rounded text-[11px] text-slate-300 flex items-center gap-3 font-mono shadow-sm pointer-events-none">
                <span className="text-slate-400 uppercase font-semibold">Nút:</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-slate-600 inline-block" /><span>Phòng</span></span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-600 inline-block" /><span>Cầu thang</span></span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" /><span>Lối thoát</span></span>
              </div>
            )}
          </div>
        </div>

        {/* ─── Right Sidebar (Control Console) ─── */}
        <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col overflow-hidden flex-shrink-0">
          {mode === 'edit' ? (
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
              <div className="text-slate-400 text-[11px] font-bold uppercase tracking-wider">Cấu hình Đối tượng</div>

              {selectedItem?.type === 'area' && (
                <>
                  <AreaForm
                    area={selectedItem.data}
                    allAreas={areas}
                    stairwells={stairwells}
                    corridors={corridors}
                    onToggleCorridor={handleToggleCorridor}
                    onChange={handleUpdateArea}
                    onUpdateLanding={handleUpdateStairwellLanding}
                    onDelete={() => handleDeleteArea(selectedItem.data.id)}
                  />
                  <DeviceRegistryForm
                    area={selectedItem.data}
                    corridors={corridors}
                    areas={areas}
                    devices={devices}
                    guidanceDevices={guidanceState.devices || []}
                    onAdd={handleAddDevice}
                    onUpdate={handleUpdateDevice}
                    onDelete={handleDeleteDevice}
                  />
                </>
              )}
              {selectedItem?.type === 'corridor' && (
                <CorridorEdgeForm
                  corridor={selectedItem.data}
                  areas={areas}
                  onChange={handleUpdateCorridor}
                  onDelete={() => handleDeleteCorridor(selectedItem.data.id)}
                />
              )}
              {!selectedItem && (
                <div className="bg-slate-800/60 rounded border border-slate-700/80 p-3.5 text-xs">
                  <div className="text-white font-semibold mb-2">Cấu hình Đồ thị Tòa nhà</div>
                  <div className="space-y-2 text-slate-400 leading-relaxed">
                    <div className="flex items-start gap-2">
                      <span className="text-blue-400 font-mono font-bold">•</span>
                      <span><strong>Khu vực:</strong> Chọn công cụ "Khu vực" rồi click lên bản đồ để tạo node</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-mono font-bold">•</span>
                      <span><strong>Hành lang:</strong> Chọn "Hành lang", click node nguồn rồi click node đích</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-slate-400 font-mono font-bold">•</span>
                      <span><strong>Chọn:</strong> Di chuyển node hoặc cấu hình tham số</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t border-slate-800 pt-3">
                <div className="text-slate-400 text-[11px] font-semibold uppercase tracking-wider mb-2">Thống kê đồ thị</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-800/70 border border-slate-700/60 rounded p-2">
                    <div className="text-slate-400 text-[10px] uppercase font-mono">Khu vực</div>
                    <div className="text-lg font-bold text-white font-mono mt-0.5">{areas.length}</div>
                  </div>
                  <div className="bg-slate-800/70 border border-slate-700/60 rounded p-2">
                    <div className="text-slate-400 text-[10px] uppercase font-mono">Hành lang</div>
                    <div className="text-lg font-bold text-white font-mono mt-0.5">{corridors.length}</div>
                  </div>
                  <div className="bg-slate-800/70 border border-slate-700/60 rounded p-2">
                    <div className="text-slate-400 text-[10px] uppercase font-mono">Số tầng</div>
                    <div className="text-lg font-bold text-white font-mono mt-0.5">{floors.length}</div>
                  </div>
                  <div className="bg-slate-800/70 border border-slate-700/60 rounded p-2">
                    <div className="text-slate-400 text-[10px] uppercase font-mono">Lối thoát</div>
                    <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5">{areas.filter(a => a.type === 'exit').length}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {/* Operational Status */}
              <div className={`p-3 border-b border-slate-800 ${simulationState.status === 'trapped' ? 'bg-red-950/40' : 'bg-slate-900'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-400 text-[11px] font-bold uppercase tracking-wider">Trạng thái hệ thống</span>
                  <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded ${simulationState.status === 'running' ? 'bg-blue-900/60 text-blue-300 border border-blue-700/60' :
                      simulationState.status === 'completed' ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60' :
                        simulationState.status === 'trapped' ? 'bg-red-900/60 text-red-300 border border-red-700/60' :
                          'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}>
                    {simulationState.status === 'running' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse mr-1.5" />}
                    {simulationStatusLabel}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
                  <div className="bg-slate-800/80 border border-slate-700/60 rounded p-2">
                    <div className="text-slate-400 text-[10px]">THỜI GIAN</div>
                    <div className="text-sm font-bold text-white mt-0.5">{formatDuration(simulationState.elapsedSeconds)}</div>
                  </div>
                  <div className="bg-slate-800/80 border border-slate-700/60 rounded p-2">
                    <div className="text-slate-400 text-[10px]">HÀNH LANG CÒN TẢI</div>
                    <div className="text-sm font-bold text-amber-400 mt-0.5">{simulationState.occupiedCorridors || 0}</div>
                  </div>
                  <div className="bg-slate-800/80 border border-slate-700/60 rounded p-2">
                    <div className="text-slate-400 text-[10px]">HÀNH LANG MẮC KẸT</div>
                    <div className={`text-sm font-bold mt-0.5 ${simulationState.trappedCorridors?.length ? 'text-red-400' : 'text-slate-400'}`}>
                      {simulationState.trappedCorridors?.length || 0}
                    </div>
                  </div>
                  <div className="bg-slate-800/80 border border-slate-700/60 rounded p-2">
                    <div className="text-slate-400 text-[10px]">LỐI THOÁT</div>
                    <div className="text-sm font-bold text-emerald-400 mt-0.5">{simulationState.availableExits ?? '–'}</div>
                  </div>
                </div>
                {devices.length > 0 && (
                  <div className="mt-2 flex items-center justify-between text-xs bg-slate-800/80 border border-slate-700/60 rounded px-2 py-1.5 font-mono">
                    <span className="text-slate-400 text-[11px]">THIẾT BỊ CHỈ DẪN</span>
                    <span>
                      <b className="text-emerald-400">{(guidanceState.devices || []).filter(device => device.status === 'online').length}</b>
                      <span className="text-slate-400"> / {devices.length} ONLINE</span>
                      {(guidanceState.devices || []).some(device => device.status === 'offline') && (
                        <b className="text-red-400 ml-2">
                          {(guidanceState.devices || []).filter(device => device.status === 'offline').length} OFFLINE
                        </b>
                      )}
                    </span>
                  </div>
                )}
                {simulationState.trappedCorridors?.length > 0 && (
                  <div className="mt-2 text-[11px] font-mono text-red-300 bg-red-950/60 border border-red-800/60 rounded p-2">
                    Cảnh báo tắc nghẽn: {simulationState.trappedCorridors.map(corridor => `${corridor.name} (${Math.round((corridor.k || 0) * 100)}%)`).join(', ')}
                  </div>
                )}
              </div>

              {/* Scenario & Compliance */}
              <div className="p-3 border-b border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px] font-bold uppercase tracking-wider">Kịch bản hành vi</span>
                  <button
                    type="button"
                    onClick={() => setShowChaosHelp(prev => !prev)}
                    className="text-blue-400 hover:text-blue-300 text-[11px] font-mono cursor-pointer transition-colors"
                  >
                    {showChaosHelp ? '[ Thu gọn ]' : '[ Hướng dẫn ]'}
                  </button>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-slate-300 text-[11px] font-mono">
                    <span>Tuân thủ chỉ dẫn:</span>
                    <strong className="text-blue-400 font-bold">{Math.round(behaviorSettings.guidance_compliance * 100)}%</strong>
                  </div>
                  <input
                    className="w-full accent-blue-600 h-1.5 bg-slate-700 rounded-sm cursor-pointer"
                    type="range" min="0" max="1" step="0.05"
                    value={behaviorSettings.guidance_compliance}
                    onChange={event => setBehaviorSettings(prev => ({ ...prev, guidance_compliance: Number(event.target.value) }))}
                  />
                </div>
                <button
                  onClick={saveBehaviorSettings}
                  className="w-full rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 py-1 text-xs font-medium cursor-pointer transition-colors"
                >
                  Áp dụng kịch bản
                </button>
                {simulationState.behavior?.automaticMix && (
                  <div className="text-[11px] text-slate-400 font-mono bg-slate-950/40 p-1.5 rounded border border-slate-800">
                    Quen: {Math.round(simulationState.behavior.automaticMix.familiar * 100)}% · Đám đông: {Math.round(simulationState.behavior.automaticMix.followCrowd * 100)}% · Ngẫu nhiên: {Math.round(simulationState.behavior.automaticMix.randomSafe * 100)}%
                  </div>
                )}
                {simulationState.behavior && (
                  <div className="text-[11px] text-slate-400 font-mono">
                    Lệch hướng: {Number(simulationState.behavior.deviated_load || 0).toFixed(2)} · Bị chặn: {Number(simulationState.behavior.rejected_unsafe_deviation || 0).toFixed(2)}
                  </div>
                )}

                {/* Collapsible simple guide */}
                {showChaosHelp && (
                  <div className="mt-2 p-2.5 rounded bg-slate-950/90 border border-slate-800 text-slate-300 space-y-1.5 leading-relaxed text-[11px]">
                    <div className="font-semibold text-slate-200 flex items-center justify-between">
                      <span>Cơ chế mô phỏng hành vi:</span>
                      <button
                        type="button"
                        onClick={() => setShowChaosHelp(false)}
                        className="text-slate-500 hover:text-white text-xs cursor-pointer"
                        title="Đóng"
                      >
                        ✕
                      </button>
                    </div>
                    <p className="text-slate-400">
                      Mô phỏng phản ứng thực tế khi xảy ra sự cố: tỷ lệ người nghe theo chỉ dẫn đèn/loa vs. người hoảng loạn tự tìm đường.
                    </p>
                    <div className="space-y-1 border-t border-slate-800 pt-1 text-slate-400">
                      <div><strong className="text-slate-300">• Tuân thủ cao (≥80%):</strong> Dòng người đi đúng hướng tối ưu của D* Lite.</div>
                      <div><strong className="text-slate-300">• Tuân thủ thấp (&lt;70%):</strong> Dòng người rẽ lối quen hoặc dồn vào đám đông, giúp kiểm thử điểm nghẽn.</div>
                    </div>
                  </div>
                )}
              </div>

              {selectedItem ? (
                <div className="p-3">
                  {selectedItem.type === 'corridor' ? (() => {
                    const corridor = selectedItem.data;
                    const areaA = areas.find(a => a.id === corridor.areaA_id);
                    const areaB = areas.find(a => a.id === corridor.areaB_id);
                    const corridorTitle = (areaA && areaB)
                      ? `${areaA.name} → ${areaB.name}`
                      : corridor.name;

                    const metric = simulationState.edgeMetrics?.[corridor.id] || {};
                    const ratio = occupancyData[corridor.id]
                      ?? simulationState.edgeOccupancy?.[corridor.id]
                      ?? corridor.initialOccupancy
                      ?? 0;
                    const densityPct = Math.round(ratio * 100);
                    const width = corridor.widthMeters || DEFAULT_CORRIDOR_WIDTH_METERS;
                    const receivingCapacity = width * (1 - ratio);
                    const isBlocked = incidentData.blockedEdges.includes(corridor.id);
                    const weightVal = metric.weight;
                    const flowCap = metric.flowCapacity ?? corridor.flowCapacity;
                    const capPeople = metric.capacityPeople ?? corridor.capacityPeople ?? Math.round((corridor.length || 10) * width * 2);
                    const curPeople = metric.currentPeople !== undefined ? metric.currentPeople : Math.round(ratio * capPeople);
                    const speed = (Math.max(0.3, 1.6 * (1 - 0.75 * Math.min(1, ratio)))).toFixed(1);

                    const statusConfig = isBlocked
                      ? {
                        dot: 'bg-red-500',
                        text: 'text-red-400',
                        border: 'border-red-600/60',
                        bg: 'bg-red-950/30',
                        title: 'BỊ PHONG TỎA',
                        desc: 'Lối đi đang cấm lưu thông do sự cố khẩn cấp.',
                        advice: 'Hành lang đang bị phong tỏa. D* Lite đã điều hướng dòng người sang tuyến an toàn khác.'
                      }
                      : ratio >= 0.8
                        ? {
                          dot: 'bg-red-500',
                          text: 'text-red-400',
                          border: 'border-red-600/60',
                          bg: 'bg-red-950/30',
                          title: 'QUÁ TẢI',
                          desc: 'Lưu lượng vượt ngưỡng an toàn, nguy cơ ùn ứ.',
                          advice: 'Mật độ cao. Hệ thống đang tự động phân luồng sang hành lang còn thông thoáng.'
                        }
                        : ratio >= 0.5
                          ? {
                            dot: 'bg-amber-400',
                            text: 'text-amber-400',
                            border: 'border-amber-600/60',
                            bg: 'bg-amber-950/30',
                            title: 'CẦN LƯU Ý',
                            desc: 'Mật độ đang tăng nhưng vẫn lưu thông.',
                            advice: 'Lưu lượng ổn định, đang được hệ thống điều tiết nhịp nhàng.'
                          }
                          : {
                            dot: 'bg-emerald-400',
                            text: 'text-emerald-400',
                            border: 'border-emerald-600/60',
                            bg: 'bg-emerald-950/30',
                            title: 'THÔNG THOÁNG',
                            desc: 'Lưu lượng an toàn, sẵn sàng đón tải.',
                            advice: 'Hành lang thông thoáng, đảm bảo khả năng sơ tán tiêu chuẩn.'
                          };

                    const toggleIncident = () => {
                      const endpoint = isBlocked ? '/api/incident/clear' : '/api/incident';
                      fetch(`${SERVER_URL}${endpoint}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: 'edge',
                          target_id: corridor.id
                        })
                      }).catch(() => notify('Không thể cập nhật trạng thái sự cố.', 'danger'));
                    };

                    return (
                      <div className="bg-slate-900 rounded border border-slate-700/80 p-3 space-y-3 shadow-sm">
                        {/* 1. Header */}
                        <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-800">
                          <div className="min-w-0 flex-1">
                            <div className="text-white font-bold text-sm leading-tight tracking-wide break-words">{corridorTitle}</div>
                            <div className="text-slate-400 text-[10px] font-mono uppercase mt-0.5">Hành lang liên kết</div>
                          </div>
                          <button
                            onClick={() => setSelectedItem(null)}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex-shrink-0"
                            title="Đóng panel"
                          >
                            <svg className="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
                          </button>
                        </div>

                        {/* 2. Status Badge */}
                        <div className={`rounded p-2 border ${statusConfig.border} ${statusConfig.bg}`}>
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${statusConfig.dot}`} />
                            <span className={`text-[11px] font-mono font-bold tracking-wider uppercase ${statusConfig.text}`}>
                              {statusConfig.title}
                            </span>
                          </div>
                          <div className="text-slate-300 text-xs mt-0.5">{statusConfig.desc}</div>
                        </div>

                        {/* 3. Metrics Matrix */}
                        <div className="grid grid-cols-2 gap-1.5 font-mono">
                          <div className="bg-slate-950/60 rounded border border-slate-800 p-2">
                            <div className="text-slate-400 text-[10px]">MẬT ĐỘ TẢI</div>
                            <div className={`text-xl font-bold mt-0.5 ${isBlocked || ratio >= 0.8 ? 'text-red-400' : ratio >= 0.5 ? 'text-amber-400' : 'text-emerald-400'
                              }`}>
                              {densityPct}%
                            </div>
                          </div>
                          <div className="bg-slate-950/60 rounded border border-slate-800 p-2">
                            <div className="text-slate-400 text-[10px]">TẢI QUY ĐỔI</div>
                            <div className="text-xl font-bold text-white mt-0.5">
                              {curPeople} <span className="text-[10px] font-normal text-slate-400">/ {capPeople}</span>
                            </div>
                          </div>
                          <div className="bg-slate-950/60 rounded border border-slate-800 p-2">
                            <div className="text-slate-400 text-[10px]">VẬN TỐC DÒNG</div>
                            <div className="text-xl font-bold text-blue-400 mt-0.5">
                              {speed} <span className="text-[10px] font-normal text-slate-400">m/s</span>
                            </div>
                          </div>
                          <div className="bg-slate-950/60 rounded border border-slate-800 p-2">
                            <div className="text-slate-400 text-[10px]">BỀ RỘNG</div>
                            <div className="text-xl font-bold text-white mt-0.5">
                              {width.toFixed(1)} <span className="text-[10px] font-normal text-slate-400">m</span>
                            </div>
                          </div>
                        </div>

                        {/* 4. Guidance note */}
                        <div className="bg-slate-950/50 rounded border border-slate-800 p-2 text-xs text-slate-300 leading-relaxed">
                          {statusConfig.advice}
                        </div>

                        {/* 5. Collapsible Technical Details */}
                        <div className="border border-slate-800 rounded bg-slate-950/40 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setShowCorridorDetails(prev => !prev)}
                            className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/50 transition-colors cursor-pointer"
                          >
                            <span className="font-mono text-[11px] text-slate-300">
                              {showCorridorDetails ? '▼ THÔNG SỐ KỸ THUẬT' : '▶ THÔNG SỐ KỸ THUẬT'}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {showCorridorDetails ? 'Thu gọn' : 'Chi tiết'}
                            </span>
                          </button>

                          {showCorridorDetails && (
                            <div className="p-2.5 border-t border-slate-800 space-y-1.5 text-xs text-slate-300 font-mono">
                              <div className="flex justify-between py-0.5 border-b border-slate-900">
                                <span className="text-slate-400">Cảm biến</span>
                                <span className="text-blue-400">WiFi CSI Sensing</span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-slate-900">
                                <span className="text-slate-400">Sức chứa thiết kế</span>
                                <span className="text-white">{capPeople} người</span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-slate-900">
                                <span className="text-slate-400">Thông thoáng còn lại</span>
                                <span className="text-emerald-400">{receivingCapacity.toFixed(2)} m ({Math.round(Math.max(0, 1 - ratio) * 100)}%)</span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-slate-900">
                                <span className="text-slate-400">Tốc độ xả lưu lượng</span>
                                <span className="text-white">{flowCap ? `${Number(flowCap).toFixed(1)} ng/s` : `${(width * 1.3).toFixed(1)} ng/s`}</span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-slate-900">
                                <span className="text-slate-400">Chiều dài lối đi</span>
                                <span className="text-white">{corridor.length || 10} m</span>
                              </div>
                              <div className="flex justify-between py-0.5 border-b border-slate-900">
                                <span className="text-slate-400">Ưu tiên điều hướng</span>
                                <span>
                                  {isBlocked ? (
                                    <span className="text-red-400 font-bold">[PHONG TỎA]</span>
                                  ) : weightVal !== undefined && weightVal !== 'Bị chặn' && Number(weightVal) < 15 ? (
                                    <span className="text-emerald-400 font-bold">[ƯU TIÊN CAO]</span>
                                  ) : (
                                    <span className="text-amber-400 font-bold">[THỨ CẤP]</span>
                                  )}
                                </span>
                              </div>

                              {/* Forecast */}
                              {simulationState.forecast?.edges?.[corridor.id] && (() => {
                                const forecast = simulationState.forecast.edges[corridor.id];
                                const valueAt = (seconds) => Math.round((forecast.median?.[seconds - 1] ?? 0) * 100);
                                return (
                                  <div className="pt-2">
                                    <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Dự báo tải (60s tới)</div>
                                    <div className="grid grid-cols-3 gap-1 text-center">
                                      <div className="bg-slate-900 rounded p-1 border border-slate-800">
                                        <div className="text-[9px] text-slate-500">15s</div>
                                        <div className="text-xs font-bold text-white">{valueAt(15)}%</div>
                                      </div>
                                      <div className="bg-slate-900 rounded p-1 border border-slate-800">
                                        <div className="text-[9px] text-slate-500">30s</div>
                                        <div className="text-xs font-bold text-white">{valueAt(30)}%</div>
                                      </div>
                                      <div className="bg-slate-900 rounded p-1 border border-slate-800">
                                        <div className="text-[9px] text-slate-500">60s</div>
                                        <div className="text-xs font-bold text-white">{valueAt(60)}%</div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Manual Simulation adjustment */}
                              <div className="pt-2 border-t border-slate-900 space-y-1.5">
                                <div className="text-[10px] uppercase font-bold text-slate-400">Thử nghiệm phản ứng phân luồng</div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    disabled={simulationState.status !== 'running'}
                                    onClick={() => handleAdjustOccupancy(corridor.id, -densityStep)}
                                    className="flex-1 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white font-medium cursor-pointer text-xs border border-slate-700"
                                  >− Giảm tải</button>
                                  <button
                                    disabled={simulationState.status !== 'running'}
                                    onClick={() => handleAdjustOccupancy(corridor.id, densityStep)}
                                    className="flex-1 py-1 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-30 text-white font-medium cursor-pointer text-xs border border-blue-600"
                                  >+ Tăng tải</button>
                                </div>
                                <div className="pt-1 space-y-0.5">
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-400">Mức nguy cơ H(e)</span>
                                    <span className="text-amber-400 font-bold">{metric.hazard ?? 0}/100</span>
                                  </div>
                                  <input
                                    type="range" min="0" max="100" step="1"
                                    value={metric.hazard ?? 0}
                                    onChange={event => handleAdjustHazard(corridor.id, event.target.value)}
                                    className="w-full accent-amber-500 cursor-pointer h-1 bg-slate-700 rounded-sm"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 6. Emergency Incident Button */}
                        <div className="pt-1">
                          <button
                            onClick={toggleIncident}
                            className={`w-full py-2 rounded font-semibold text-xs transition-colors flex items-center justify-center gap-2 border ${isBlocked
                                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300 hover:bg-emerald-900/80'
                                : 'bg-red-950/60 border-red-700 text-red-300 hover:bg-red-900/80'
                              }`}
                          >
                            <span>{isBlocked ? 'Khôi phục lưu thông hành lang' : 'Phong tỏa hành lang (Báo cháy / Sự cố)'}</span>
                          </button>
                          <p className="text-[10px] text-slate-500 mt-1 text-center font-mono">
                            {isBlocked
                              ? 'Lối đi đang phong tỏa. Nhấn để mở lại.'
                              : 'Thử chặn hành lang để quan sát D* Lite tái định tuyến tăng dần.'}
                          </p>
                        </div>
                      </div>
                    );
                  })() : (
                    /* Area Panel (Room, Exit, Stairs) */
                    <div className="bg-slate-900 rounded border border-slate-700/80 p-3 space-y-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-800">
                        <div className="min-w-0 flex-1">
                          <div className="text-white font-bold text-sm leading-tight tracking-wide break-words">
                            {selectedItem.data.name}
                          </div>
                          <div className="text-slate-400 text-[10px] font-mono uppercase mt-0.5">
                            {selectedItem.data.type === 'exit' ? 'Lối thoát khẩn cấp' : selectedItem.data.type === 'stairs' ? 'Thang bộ' : 'Khu vực / Phòng'}
                          </div>
                        </div>
                        <button
                          onClick={() => setSelectedItem(null)}
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex-shrink-0"
                          title="Đóng panel"
                        >
                          <svg className="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                      </div>

                      {/* Phân luồng đề xuất */}
                      {guidanceState.decisions?.[selectedItem.data.id]?.routes?.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-slate-400 text-[10px] font-mono uppercase font-semibold">Tuyến D* Lite chỉ định</div>
                          {guidanceState.decisions[selectedItem.data.id].routes.map((route, index) => {
                            const routeCorridor = corridors.find(corridor => corridor.id === route.edge_id);
                            return (
                              <div key={route.edge_id} className="flex items-center justify-between bg-slate-950/60 rounded p-1.5 text-xs font-mono border border-slate-800">
                                <span className="text-slate-300 truncate mr-2">
                                  {index + 1}. {routeCorridor?.name || route.edge_id}
                                </span>
                                <span className="text-blue-400 font-bold">
                                  {Math.round((route.probability || 0) * 100)}%
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Loa và bảng hiệu */}
                      {devices.some(device => device.area_id === selectedItem.data.id) && (
                        <div className="space-y-1.5">
                          <div className="text-slate-400 text-[10px] font-mono uppercase font-semibold">Thiết bị chấp hành</div>
                          {devices.filter(device => device.area_id === selectedItem.data.id).map(device => {
                            const live = (guidanceState.devices || []).find(item => item.id === device.id);
                            const statusColor = live?.status === 'online' ? 'text-emerald-400' : live?.status === 'offline' ? 'text-red-400' : 'text-amber-400';
                            return (
                              <div key={device.id} className="bg-slate-950/60 rounded p-2 text-xs font-mono border border-slate-800">
                                <div className="flex justify-between items-center">
                                  <span className="text-white font-medium">[{device.type === 'sign' ? 'SIGN' : 'SPEAKER'}] {device.name}</span>
                                  <span className={`text-[10px] uppercase font-bold ${statusColor}`}>{live?.status || 'idle'}</span>
                                </div>
                                {live?.last_command && (
                                  <div className="text-slate-400 text-[11px] mt-1">Lệnh: {live.last_command.command}</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Exit Incident Toggle */}
                      {selectedItem.data.type === 'exit' && (() => {
                        const isBlocked = incidentData.blockedExits.includes(selectedItem.data.id);
                        const toggleExitIncident = () => {
                          const endpoint = isBlocked ? '/api/incident/clear' : '/api/incident';
                          fetch(`${SERVER_URL}${endpoint}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              type: 'exit',
                              target_id: selectedItem.data.id
                            })
                          }).catch(() => notify('Không thể cập nhật trạng thái sự cố.', 'danger'));
                        };
                        return (
                          <div className="pt-2">
                            <button
                              onClick={toggleExitIncident}
                              className={`w-full py-2 rounded font-semibold text-xs transition-colors flex items-center justify-center gap-2 border ${isBlocked
                                  ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300 hover:bg-emerald-900/80'
                                  : 'bg-red-950/60 border-red-700 text-red-300 hover:bg-red-900/80'
                                }`}
                            >
                              <span>{isBlocked ? 'Khôi phục lối thoát này' : 'Phong tỏa lối thoát này (Có khói/lửa)'}</span>
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Floor Overview */}
                  <div className="p-3 border-b border-slate-800">
                    <div className="text-slate-400 text-[11px] font-bold uppercase tracking-wider mb-2 flex items-center justify-between">
                      <span>Giám sát các tầng</span>
                      <span className="text-[10px] font-normal font-mono text-slate-500">CHỌN TẦNG</span>
                    </div>
                    <div className="space-y-1">
                      {[...floors].sort((a, b) => b - a).map(floor => {
                        const floorCorridors = corridors.filter(corridor => {
                          const areaA = areas.find(area => area.id === corridor.areaA_id);
                          const areaB = areas.find(area => area.id === corridor.areaB_id);
                          return areaA?.floor === floor && areaB?.floor === floor;
                        });

                        let floorStatus = 'green';
                        let totalOccupancy = 0;
                        let hasCritical = false;

                        if (floorCorridors.length > 0) {
                          floorCorridors.forEach(corridor => {
                            const ratio = occupancyData[corridor.id] ?? simulationState.edgeOccupancy?.[corridor.id] ?? 0;
                            totalOccupancy += ratio;
                            if (ratio >= 0.8) hasCritical = true;
                          });
                          const avg = totalOccupancy / floorCorridors.length;
                          if (hasCritical || avg >= 0.5) floorStatus = 'red';
                          else if (avg > 0) floorStatus = 'yellow';
                        }

                        const isActive = floor === activeFloor;

                        return (
                          <div
                            key={floor}
                            onClick={() => setActiveFloor(floor)}
                            className={`cursor-pointer rounded px-2.5 py-1.5 flex items-center justify-between text-xs transition-colors border ${isActive
                                ? 'bg-slate-800 border-blue-500/80 text-white'
                                : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800/60 hover:text-white'
                              }`}
                          >
                            <span className="font-medium">Tầng {floor}</span>
                            <span className="font-mono text-[11px] flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${floorStatus === 'red' ? 'bg-red-500' : floorStatus === 'yellow' ? 'bg-amber-500' : 'bg-emerald-500'
                                }`} />
                              <span className={
                                floorStatus === 'red' ? 'text-red-400 font-semibold' : floorStatus === 'yellow' ? 'text-amber-400 font-semibold' : 'text-emerald-400 font-semibold'
                              }>
                                {floorStatus === 'red' ? 'NGUY CƠ' : floorStatus === 'yellow' ? 'CÓ TẢI' : 'AN TOÀN'}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Current floor metrics */}
                  <div className="p-3 border-b border-slate-800">
                    <div className="text-slate-400 text-[11px] font-bold uppercase tracking-wider mb-2 font-mono">
                      THÔNG SỐ TẦNG {activeFloor}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 font-mono text-xs mb-2">
                      <div className="bg-slate-800/80 border border-slate-700/60 rounded p-2">
                        <div className="text-slate-400 text-[10px]">HÀNH LANG</div>
                        <div className="text-base font-bold text-white mt-0.5">{currentFloorCorridors.length}</div>
                      </div>
                      <div className="bg-slate-800/80 border border-slate-700/60 rounded p-2">
                        <div className="text-slate-400 text-[10px]">LẤP ĐẦY ≥80%</div>
                        <div className={`text-base font-bold mt-0.5 ${criticalCount > 0 ? 'text-red-400' : 'text-slate-300'}`}>{criticalCount}</div>
                      </div>
                    </div>
                    {occupancyRatios.length > 0 && (
                      <div className="font-mono">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400 text-[10px]">MẬT ĐỘ TRUNG BÌNH:</span>
                          <span className={`font-bold ${avgOccupancy >= 0.8 ? 'text-red-400' : avgOccupancy >= 0.5 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {(avgOccupancy * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-sm overflow-hidden border border-slate-700/60">
                          <div
                            className={`h-full rounded-sm transition-all duration-500 ${avgOccupancy >= 0.8 ? 'bg-red-500' : avgOccupancy >= 0.5 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${avgOccupancy * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* System Event Logs */}
                  <div className="p-3">
                    <div className="flex justify-between items-center mb-2">
                      <div className="text-slate-400 text-[11px] font-bold uppercase tracking-wider font-mono">Nhật ký sự kiện</div>
                      <button onClick={() => setLogs([])} className="text-[11px] font-mono text-slate-500 hover:text-slate-300">XÓA</button>
                    </div>
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {logs.length === 0 ? (
                        <div className="text-slate-500 text-xs italic text-center py-4 font-mono">Chưa có sự kiện nào</div>
                      ) : (
                        logs.map((log, idx) => (
                          <div key={idx} className={`p-1.5 rounded border text-[11px] font-mono ${log.type === 'alert'
                              ? 'bg-red-950/30 border-red-800/60 text-red-200'
                              : 'bg-slate-800/40 border-slate-700/60 text-slate-300'
                            }`}>
                            <div className="flex justify-between items-center mb-0.5">
                              <span className={`font-bold ${log.type === 'alert' ? 'text-red-400' : 'text-blue-400'}`}>
                                {log.type === 'alert' ? '[CẢNH BÁO]' : '[ĐIỀU HƯỚNG]'}
                              </span>
                              <span className="text-slate-500 text-[10px]">{log.time}</span>
                            </div>
                            <div className="leading-snug text-slate-300">{log.message}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
