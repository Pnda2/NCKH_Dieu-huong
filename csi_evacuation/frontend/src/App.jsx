import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import MapCanvas from './components/MapCanvas';
import AreaForm from './components/AreaForm';
import CorridorEdgeForm from './components/CorridorEdgeForm';
import DeviceRegistryForm from './components/DeviceRegistryForm';

const SERVER_URL = 'http://localhost:3001';
const DEFAULT_CORRIDOR_WIDTH_METERS = 1.2;

const normalizeCorridor = (corridor) => {
  const parsedWidth = Number(corridor.widthMeters);
  const hasValidWidth = Number.isFinite(parsedWidth) && parsedWidth > 0;
  return {
    ...corridor,
    widthMeters: hasValidWidth ? parsedWidth : DEFAULT_CORRIDOR_WIDTH_METERS,
    widthEstimated: hasValidWidth ? Boolean(corridor.widthEstimated) : true,
  };
};

function App() {
  const [mode, setMode] = useState('view');
  const [editTool, setEditTool] = useState('select'); // 'select' | 'addArea' | 'addCorridor'

  const [areas, setAreas] = useState([]);       // Nodes
  const [corridors, setCorridors] = useState([]); // Edges
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
  const [densityStep, setDensityStep] = useState(5);
  const hazardRequestRef = useRef(null);
  const [guidanceState, setGuidanceState] = useState({ decisions: {}, devices: [] });

  const [floors, setFloors] = useState([1]);
  const [activeFloor, setActiveFloor] = useState(1);
  const [floorImages, setFloorImages] = useState({});

  useEffect(() => {
    fetch(`${SERVER_URL}/api/map`)
      .then(res => res.json())
      .then(data => {
        if (data?.areas) setAreas(data.areas);
        if (data?.edges) setCorridors(data.edges.map(normalizeCorridor));
        if (data?.devices) setDevices(data.devices);
        if (data?.floorImages) setFloorImages(data.floorImages);
        if (data?.floors?.length > 0) {
          setFloors(data.floors);
          setActiveFloor(data.floors[0]);
        }
      })
      .catch(err => console.error('Failed to load map:', err));

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
      setSimulationState(data);
      if (data?.status === 'idle') {
        setOccupancyData(data.edgeOccupancy || {});
        setGuidanceState({ decisions: {}, devices: [] });
      }
    });
    newSocket.on('occupancy_adjust_ack', (data) => {
      if (data?.success === false) console.error('Occupancy adjustment rejected:', data.error);
    });
    newSocket.on('guidance_state', (data) => setGuidanceState(data));

    return () => newSocket.close();
  }, []);

  // ─── Area (Node) Handlers ─────────────────────────
  const handleAddArea = (x, y) => {
    const newArea = {
      id: `a_${Date.now()}`,
      name: `Khu vực ${areas.length + 1}`,
      type: 'room',
      x,
      y,
      floor: activeFloor,
    };
    setAreas(prev => [...prev, newArea]);
    setSelectedItem({ type: 'area', data: newArea });
    setEditTool('select');
  };

  const handleUpdateArea = (updatedArea) => {
    setAreas(prev => prev.map(a => a.id === updatedArea.id ? updatedArea : a));
    setSelectedItem({ type: 'area', data: updatedArea });
  };

  const handleDeleteArea = (areaId) => {
    setAreas(prev => prev.filter(a => a.id !== areaId));
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
      length: 10,
      widthMeters: DEFAULT_CORRIDOR_WIDTH_METERS,
      widthEstimated: true,
      initialOccupancy: 0.5,
      areaA_id,
      areaB_id,
    };
    setCorridors(prev => [...prev, newCorridor]);
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
        id: `e_${Date.now()}_${Math.floor(Math.random()*1000)}`,
        name: `${areaA.name} – ${areaB.name}`,
        length: 10,
        widthMeters: DEFAULT_CORRIDOR_WIDTH_METERS,
        widthEstimated: true,
        initialOccupancy: 0.5,
        areaA_id: areaId1,
        areaB_id: areaId2,
      };
      setCorridors(prev => [...prev, newCorridor]);
    }
  };

  // ─── Floor Handlers ───────────────────────────────
  const handleAddFloor = () => {
    const newFloorNum = floors.length > 0 ? Math.max(...floors) + 1 : 1;
    setFloors(prev => [...prev, newFloorNum]);
    setActiveFloor(newFloorNum);
  };

  const handleDeleteFloor = (floorNum) => {
    if (!window.confirm(`Xóa Tầng ${floorNum} và tất cả khu vực, hành lang trên đó?`)) return;
    const remaining = floors.filter(f => f !== floorNum);
    const nextFloors = remaining.length === 0 ? [1] : remaining;
    setFloors(nextFloors);
    setActiveFloor(nextFloors[0]);

    const areaIdsOnFloor = areas.filter(a => a.floor === floorNum).map(a => a.id);
    setAreas(prev => prev.filter(a => a.floor !== floorNum));
    setCorridors(prev => prev.filter(c =>
      !areaIdsOnFloor.includes(c.areaA_id) && !areaIdsOnFloor.includes(c.areaB_id)
    ));
    setDevices(prev => prev.filter(device => !areaIdsOnFloor.includes(device.area_id)));
    setFloorImages(prev => { const n = { ...prev }; delete n[floorNum]; return n; });
    setSelectedItem(null);
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
      }),
    })
      .then(res => res.json())
      .then(data => { if (data.success) alert('Lưu bản đồ thành công và đã gửi xuống Pi 5!'); })
      .catch(err => console.error('Failed to save map:', err));
  };

  const handleStartSimulation = () => {
    const endpoint = simulationState.status === 'stopped'
      ? '/api/simulate/resume'
      : '/api/simulate';
    fetch(`${SERVER_URL}${endpoint}`, { method: 'POST' })
      .then(async res => {
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Không thể chạy mô phỏng');
      })
      .catch(err => alert(err.message));
  };

  const handleStopSimulation = () => {
    fetch(`${SERVER_URL}/api/simulate/stop`, { method: 'POST' })
      .catch(err => console.error('Failed to stop simulation:', err));
  };

  const handleResetSimulation = () => {
    fetch(`${SERVER_URL}/api/simulate/reset`, { method: 'POST' })
      .then(async res => {
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Không thể reset mô phỏng');
      })
      .catch(err => alert(err.message));
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
      .catch(err => alert(err.message));
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
        .catch(err => alert(err.message));
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
    <div className="h-screen bg-slate-900 flex flex-col overflow-hidden" style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>

      {/* ─── Header ─── */}
      <header className="bg-slate-800 border-b border-slate-700 px-5 py-2.5 flex justify-between items-center flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
               style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)' }}>W</div>
          <div>
            <div className="text-white font-semibold text-sm leading-none">WiEvac Monitor</div>
            <div className="text-slate-400 text-xs mt-0.5">CSI Evacuation Intelligence System</div>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-slate-700 p-1 rounded-xl">
          <button
            onClick={() => { setMode('view'); setEditTool('select'); setSelectedItem(null); }}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              mode === 'view' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'
            }`}
          >🔍 Giám sát</button>
          <button
            onClick={() => setMode('edit')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              mode === 'edit' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'
            }`}
          >✏️ Thiết kế</button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleStartSimulation}
            disabled={!['idle', 'stopped'].includes(simulationState.status)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white shadow-lg transition-all duration-200"
          >▶ {simulationState.status === 'stopped' ? 'Tiếp tục' : 'Chạy mô phỏng'}</button>
          <button
            onClick={handleStopSimulation}
            disabled={simulationState.status !== 'running'}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white shadow-lg transition-all duration-200"
          >■ Dừng</button>
          <button
            onClick={handleResetSimulation}
            disabled={simulationState.status === 'running'}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white shadow-lg transition-all duration-200"
          >↻ Reset</button>
        </div>

        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-500'}`}
               style={isConnected ? { animation: 'pulse 2s infinite' } : {}}></div>
          <span className={`text-xs font-semibold ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
            {isConnected ? 'LIVE' : 'Offline'}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ─── Canvas Area ─── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-100">

          {/* Toolbar */}
          <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Tầng:</span>
              {floors.map(f => (
                <div key={f} className="flex items-center group">
                  <button
                    onClick={() => { setActiveFloor(f); setSelectedItem(null); }}
                    className={`px-3 py-1 text-xs rounded-lg font-semibold transition-all ${
                      activeFloor === f ? 'bg-blue-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >Tầng {f}</button>
                  {mode === 'edit' && floors.length > 1 && (
                    <button
                      onClick={() => handleDeleteFloor(f)}
                      className="ml-0.5 opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center text-red-400 hover:text-red-600 text-xs transition-all"
                    >×</button>
                  )}
                </div>
              ))}
              {mode === 'edit' && (
                <button onClick={handleAddFloor}
                  className="w-6 h-6 flex items-center justify-center bg-green-100 text-green-600 hover:bg-green-200 rounded-lg text-sm font-bold transition-colors"
                >+</button>
              )}
            </div>

            {mode === 'edit' ? (
              <div className="flex items-center gap-2">
                <div className="flex gap-1 bg-slate-100 p-1 rounded-lg text-xs">
                  {[
                    { id: 'select', label: '↖ Chọn' },
                    { id: 'addArea', label: '⬤ Khu vực' },
                    { id: 'addCorridor', label: '─ Hành lang' },
                  ].map(t => (
                    <button key={t.id} onClick={() => setEditTool(t.id)}
                      className={`px-2.5 py-1 rounded font-medium transition-all ${
                        editTool === t.id ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >{t.label}</button>
                  ))}
                </div>
                <div className="w-px h-5 bg-slate-200"></div>
                <label className="px-3 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg cursor-pointer font-medium transition-colors">
                  🖼️ Ảnh nền
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
                {normalizedBgImage && (
                  <div className="flex items-center gap-2 bg-slate-100 px-2 py-1 rounded-lg">
                    <span className="text-xs font-semibold text-slate-500">Scale:</span>
                    <input 
                      type="range" min="0.1" max="3" step="0.05" 
                      value={normalizedBgImage.scale || 1} 
                      onChange={(e) => setFloorImages(prev => ({...prev, [activeFloor]: {...normalizedBgImage, scale: Number(e.target.value)}}))}
                      className="w-16 accent-blue-500"
                    />
                    <span className="text-xs font-semibold text-slate-500 ml-1">Mờ:</span>
                    <input 
                      type="range" min="0.1" max="1" step="0.1" 
                      value={normalizedBgImage.opacity || 0.5} 
                      onChange={(e) => setFloorImages(prev => ({...prev, [activeFloor]: {...normalizedBgImage, opacity: Number(e.target.value)}}))}
                      className="w-16 accent-blue-500"
                    />
                    <button 
                      onClick={() => setFloorImages(prev => { const n = { ...prev }; delete n[activeFloor]; return n; })}
                      className="ml-1 text-xs text-red-500 hover:text-red-700 font-bold"
                      title="Xóa ảnh nền"
                    >✖</button>
                  </div>
                )}
                <button onClick={handleSaveMap}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors"
                >💾 Lưu</button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-400">
                  {currentFloorAreas.length} khu vực · {currentFloorCorridors.length} hành lang
                </span>
                {criticalCount > 0 && (
                  <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">
                    ⚠ {criticalCount} hành lang ≥80%
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Canvas */}
          <div className="flex-1 relative overflow-hidden">
            <MapCanvas
              mode={mode}
              editTool={editTool}
              areas={currentFloorAreas}
              setAreas={(updated) => {
                const others = areas.filter(a => (a.floor || 1) !== activeFloor);
                setAreas([...others, ...updated]);
              }}
              corridors={currentFloorCorridors}
              crossFloorCorridors={crossFloorCorridors}
              allAreas={areas}
              selectedItem={selectedItem}
              onSelectItem={setSelectedItem}
              onAddArea={handleAddArea}
              onAddCorridor={handleAddCorridor}
              occupancyData={{ ...simulationState.edgeOccupancy, ...occupancyData }}
              incidentData={incidentData}
              edgeMetrics={simulationState.edgeMetrics || {}}
              devices={devices}
              guidanceState={guidanceState}
              backgroundImage={normalizedBgImage}
              onUpdateBackgroundImage={(updated) => setFloorImages(prev => ({ ...prev, [activeFloor]: updated }))}
            />

            {/* Legend */}
            {mode === 'view' && (
              <div className="absolute bottom-4 right-4 bg-white/95 backdrop-blur rounded-xl shadow-xl border border-slate-200 p-3 text-xs space-y-1.5">
                <div className="font-bold text-slate-700 text-xs uppercase tracking-wide mb-2">Chú thích</div>
                <div className="text-slate-500 font-medium text-xs mb-1">Độ lấp đầy hành lang k(e):</div>
                <div className="flex items-center gap-2"><div className="w-8 h-2 rounded-full bg-green-500"></div><span className="text-slate-600">Thấp (&lt;50%)</span></div>
                <div className="flex items-center gap-2"><div className="w-8 h-2 rounded-full bg-yellow-400"></div><span className="text-slate-600">Trung bình (50–80%)</span></div>
                <div className="flex items-center gap-2"><div className="w-8 h-2 rounded-full bg-red-500"></div><span className="text-slate-600">Cao (&gt;80%)</span></div>
                <hr className="border-slate-200 my-1" />
                <div className="text-slate-500 font-medium text-xs mb-1">Loại khu vực (khi thiết kế):</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500"></div><span className="text-slate-600">Phòng / Khu vực</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-orange-500"></div><span className="text-slate-600">Cầu thang</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-green-600"></div><span className="text-slate-600">Lối thoát khẩn cấp</span></div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Right Sidebar ─── */}
        <div className="w-72 bg-slate-800 border-l border-slate-700 flex flex-col overflow-hidden flex-shrink-0">
          {mode === 'edit' ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="text-slate-400 text-xs font-bold uppercase tracking-widest">Chi tiết</div>

              {selectedItem?.type === 'area' && (
                <>
                  <AreaForm
                    area={selectedItem.data}
                    allAreas={areas}
                    corridors={corridors}
                    onToggleCorridor={handleToggleCorridor}
                    onChange={handleUpdateArea}
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
                <div className="bg-slate-700 rounded-xl p-4 text-sm">
                  <div className="text-3xl mb-3">🗺️</div>
                  <p className="text-slate-300 font-medium mb-3">Thiết kế đồ thị tòa nhà</p>
                  <div className="space-y-2.5 text-xs text-slate-400">
                    <div className="flex items-start gap-2">
                      <span className="bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded font-mono flex-shrink-0">⬤</span>
                      <span><strong className="text-slate-300">Khu vực:</strong> Chọn công cụ "Khu vực" rồi click vào bản đồ để đặt node</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded font-mono flex-shrink-0">─</span>
                      <span><strong className="text-slate-300">Hành lang:</strong> Chọn "Hành lang", click node A rồi click node B để vẽ hành lang</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="bg-slate-600 text-slate-300 px-1.5 py-0.5 rounded font-mono flex-shrink-0">↖</span>
                      <span><strong className="text-slate-300">Chọn:</strong> Di chuyển khu vực, xem/sửa thuộc tính</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t border-slate-700 pt-4">
                <div className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-3">Thống kê</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: areas.length, label: 'Khu vực', color: 'text-blue-400' },
                    { value: corridors.length, label: 'Hành lang', color: 'text-green-400' },
                    { value: floors.length, label: 'Tầng', color: 'text-purple-400' },
                    { value: areas.filter(a => a.type === 'exit').length, label: 'Lối thoát', color: 'text-emerald-400' },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-700 rounded-lg p-3">
                      <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className={`p-3 border-b border-slate-700 ${simulationState.status === 'trapped' ? 'bg-red-950/60' : 'bg-slate-700/40'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-300 text-xs font-bold uppercase">Trạng thái mô phỏng</span>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                    simulationState.status === 'running' ? 'bg-blue-900 text-blue-300' :
                    simulationState.status === 'completed' ? 'bg-green-900 text-green-300' :
                    simulationState.status === 'trapped' ? 'bg-red-900 text-red-300' :
                    'bg-slate-600 text-slate-300'
                  }`}>{simulationStatusLabel}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-800/60 rounded p-2"><div className="text-slate-500">Thời gian</div><div className="text-white font-bold">{formatDuration(simulationState.elapsedSeconds)}</div></div>
                  <div className="bg-slate-800/60 rounded p-2"><div className="text-slate-500">Lấp đầy TB</div><div className="text-blue-400 font-bold">{Math.round((simulationState.averageOccupancy || 0) * 100)}%</div></div>
                  <div className="bg-slate-800/60 rounded p-2"><div className="text-slate-500">Hành lang còn tải</div><div className="text-yellow-400 font-bold">{simulationState.occupiedCorridors || 0}</div></div>
                  <div className="bg-slate-800/60 rounded p-2"><div className="text-slate-500">Hành lang mắc kẹt</div><div className="text-red-400 font-bold">{simulationState.trappedCorridors?.length || 0}</div></div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                  <div className="bg-slate-800/60 rounded p-2"><div className="text-slate-500">Lối thoát khả dụng</div><div className="text-emerald-400 font-bold">{simulationState.availableExits ?? '–'}</div></div>
                  <div className="bg-slate-800/60 rounded p-2"><div className="text-slate-500">Khu vực nguy hiểm</div><div className="text-orange-400 font-bold">{simulationState.hazardousCorridors ?? 0}</div></div>
                </div>
                {devices.length > 0 && (
                  <div className="mt-2 flex items-center justify-between text-xs bg-slate-800/60 rounded p-2">
                    <span className="text-slate-400">Thiết bị điều hướng</span>
                    <span>
                      <b className="text-green-400">{(guidanceState.devices || []).filter(device => device.status === 'online').length}</b>
                      <span className="text-slate-500"> / {devices.length} online</span>
                      {(guidanceState.devices || []).some(device => device.status === 'offline') && (
                        <b className="text-red-400 ml-2">
                          {(guidanceState.devices || []).filter(device => device.status === 'offline').length} offline
                        </b>
                      )}
                    </span>
                  </div>
                )}
                {simulationState.trappedCorridors?.length > 0 && (
                  <div className="mt-2 text-xs text-red-300 bg-red-950/60 rounded p-2">
                    Không có đường thoát: {simulationState.trappedCorridors.map(corridor => `${corridor.name} (${Math.round((corridor.k || 0) * 100)}%)`).join(', ')}
                  </div>
                )}
              </div>
              {selectedItem ? (
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <button onClick={() => setSelectedItem(null)} className="text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-700 text-xs font-semibold">← Quay lại</button>
                  </div>
                  
                  <div className="bg-slate-700 rounded-xl p-4 space-y-4">
                    <div className="text-white font-bold text-lg">{selectedItem.data.name}</div>
                    <div className="text-slate-400 text-xs">
                      {selectedItem.type === 'corridor' ? 'Hành lang' : (selectedItem.data.type === 'exit' ? 'Lối thoát' : 'Khu vực')}
                    </div>

                    {selectedItem.type === 'area' && guidanceState.decisions?.[selectedItem.data.id]?.routes?.length > 0 && (
                      <div className="pt-4 border-t border-slate-600 space-y-2">
                        <div className="text-slate-300 text-xs font-bold uppercase">Phân luồng đề xuất</div>
                        {guidanceState.decisions[selectedItem.data.id].routes.map((route, index) => {
                          const routeCorridor = corridors.find(corridor => corridor.id === route.edge_id);
                          return (
                            <div key={route.edge_id} className="flex items-center justify-between bg-slate-800/60 rounded p-2 text-xs">
                              <span className="text-slate-300 truncate mr-2">
                                {index + 1}. {routeCorridor?.name || route.edge_id}
                              </span>
                              <span className="text-cyan-300 font-bold">
                                {Math.round((route.probability || 0) * 100)}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {selectedItem.type === 'area' && devices.some(device => device.area_id === selectedItem.data.id) && (
                      <div className="pt-4 border-t border-slate-600 space-y-2">
                        <div className="text-slate-300 text-xs font-bold uppercase">Loa và bảng hiệu</div>
                        {devices.filter(device => device.area_id === selectedItem.data.id).map(device => {
                          const live = (guidanceState.devices || []).find(item => item.id === device.id);
                          const statusColor = live?.status === 'online' ? 'text-green-400' : live?.status === 'offline' ? 'text-red-400' : 'text-yellow-400';
                          return (
                            <div key={device.id} className="bg-slate-800/60 rounded p-2 text-xs">
                              <div className="flex justify-between">
                                <span className="text-white">{device.type === 'sign' ? '🚦' : '🔊'} {device.name}</span>
                                <span className={statusColor}>{live?.status || 'idle'}</span>
                              </div>
                              {live?.last_command && (
                                <div className="text-cyan-300 mt-1">Lệnh: {live.last_command.command}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {selectedItem.type === 'corridor' && (
                      <div className="pt-4 border-t border-slate-600">
                        {(() => {
                          const ratio = occupancyData[selectedItem.data.id]
                            ?? simulationState.edgeOccupancy?.[selectedItem.data.id]
                            ?? selectedItem.data.initialOccupancy
                            ?? 0;
                          const width = selectedItem.data.widthMeters || DEFAULT_CORRIDOR_WIDTH_METERS;
                          const receivingCapacity = width * (1 - ratio);
                          return (
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <div className="bg-slate-800/60 rounded p-2">
                                <div className="text-slate-500 text-xs">Độ rộng hữu dụng</div>
                                <div className="text-white font-bold">{width.toFixed(1)} m</div>
                              </div>
                              <div className="bg-slate-800/60 rounded p-2">
                                <div className="text-slate-500 text-xs">Khả năng tiếp nhận R</div>
                                <div className="text-cyan-300 font-bold">{receivingCapacity.toFixed(2)}</div>
                              </div>
                            </div>
                          );
                        })()}
                        <div className="grid grid-cols-2 gap-2 mb-3">
                          <div className="bg-slate-800/60 rounded p-2">
                            <div className="text-slate-500 text-xs">Người / sức chứa</div>
                            <div className="text-white font-bold">{simulationState.edgeMetrics?.[selectedItem.data.id]?.currentPeople ?? '–'} / {simulationState.edgeMetrics?.[selectedItem.data.id]?.capacityPeople ?? '–'}</div>
                          </div>
                          <div className="bg-slate-800/60 rounded p-2">
                            <div className="text-slate-500 text-xs">Trọng số D* Lite</div>
                            <div className="text-blue-300 font-bold">{simulationState.edgeMetrics?.[selectedItem.data.id]?.weight ?? 'Bị chặn'}</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-slate-300 text-xs font-bold uppercase">Độ lấp đầy k</span>
                          <span className="text-2xl text-white font-bold">
                            {Math.round((occupancyData[selectedItem.data.id] ?? simulationState.edgeOccupancy?.[selectedItem.data.id] ?? selectedItem.data.initialOccupancy ?? 0) * 100)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="1" max="100" value={densityStep}
                            onChange={event => setDensityStep(Math.max(1, Number(event.target.value) || 1))}
                            className="w-16 bg-slate-600 text-white rounded-lg px-2 py-2 text-sm border border-slate-500"
                            title="Số điểm phần trăm điều chỉnh mỗi lần"
                          />
                          <button
                            disabled={simulationState.status !== 'running'}
                            onClick={() => handleAdjustOccupancy(selectedItem.data.id, -densityStep)}
                            className="flex-1 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-40 text-white font-bold"
                          >− Giảm</button>
                          <button
                            disabled={simulationState.status !== 'running'}
                            onClick={() => handleAdjustOccupancy(selectedItem.data.id, densityStep)}
                            className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold"
                          >+ Tăng</button>
                        </div>
                        {simulationState.status !== 'running' && <p className="text-xs text-slate-500 mt-2">Chỉ điều chỉnh được khi mô phỏng đang chạy.</p>}
                        <div className="mt-3 pt-3 border-t border-slate-600">
                          <div className="flex justify-between text-xs mb-2">
                            <span className="text-slate-300 font-bold">Nguy cơ H(e)</span>
                            <span className="text-orange-300">{simulationState.edgeMetrics?.[selectedItem.data.id]?.hazard ?? 0}</span>
                          </div>
                          <input
                            type="range" min="0" max="100" step="1"
                            value={simulationState.edgeMetrics?.[selectedItem.data.id]?.hazard ?? 0}
                            onChange={event => handleAdjustHazard(selectedItem.data.id, event.target.value)}
                            className="w-full accent-orange-500"
                          />
                          <p className="text-xs text-slate-500 mt-1">100 là ngưỡng chặn hành lang.</p>
                        </div>
                      </div>
                    )}
                     
                    {/* Incident Toggle */}
                    {(selectedItem.type === 'corridor' || (selectedItem.type === 'area' && selectedItem.data.type === 'exit')) && (() => {
                      const isBlocked = selectedItem.type === 'corridor' 
                        ? incidentData.blockedEdges.includes(selectedItem.data.id)
                        : incidentData.blockedExits.includes(selectedItem.data.id);
                        
                      const toggleIncident = () => {
                        const endpoint = isBlocked ? '/api/incident/clear' : '/api/incident';
                        fetch(`http://localhost:3001${endpoint}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ 
                            type: selectedItem.type === 'corridor' ? 'edge' : 'exit', 
                            target_id: selectedItem.data.id 
                          })
                        }).catch(console.error);
                      };
                      
                      return (
                        <div className="pt-4 border-t border-slate-600">
                          <div className="text-slate-300 text-xs font-bold uppercase mb-2">Mô phỏng sự cố</div>
                          <button
                            onClick={toggleIncident}
                            className={`w-full py-2 rounded-lg font-bold text-sm transition-colors ${
                              isBlocked 
                                ? 'bg-green-600 hover:bg-green-500 text-white' 
                                : 'bg-red-600 hover:bg-red-500 text-white'
                            }`}
                          >
                            {isBlocked ? '✅ Mở lại luồng đi' : '🚧 Chặn (Báo cháy / Sự cố)'}
                          </button>
                          <p className="text-xs text-slate-400 mt-2">
                            {isBlocked 
                              ? 'Hệ thống đang bỏ qua khu vực này khi tìm đường. Nhấn để khôi phục.' 
                              : 'Chặn khu vực này sẽ buộc thuật toán tìm đường vòng ngay lập tức.'}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                <>
              <div className="p-4 bg-slate-700/50 border-b border-slate-700">
                <div className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-3 flex items-center justify-between">
                  <span>Sơ đồ Tòa nhà</span>
                  <span className="text-[10px] font-normal normal-case text-slate-500">Click để chuyển tầng</span>
                </div>
                <div className="flex flex-col gap-1.5 mb-2">
                  {[...floors].sort((a,b) => b - a).map(floor => {
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
                    
                    const bgClass = floorStatus === 'red' ? 'bg-red-500/80 hover:bg-red-500 text-white' 
                                  : floorStatus === 'yellow' ? 'bg-yellow-400/80 hover:bg-yellow-400 text-slate-900' 
                                  : 'bg-green-500/80 hover:bg-green-500 text-white';
                    
                    const isActive = floor === activeFloor;
                    
                    return (
                      <div 
                        key={floor} 
                        onClick={() => setActiveFloor(floor)}
                        className={`cursor-pointer rounded-lg flex items-center justify-between px-3 py-2 transition-all border-2 ${isActive ? 'border-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.5)]' : 'border-transparent'} ${bgClass}`}
                      >
                        <span className="text-xs font-bold">Tầng {floor}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/20`}>
                          {floorStatus === 'green' ? 'TRỐNG / AN TOÀN' : floorStatus === 'yellow' ? 'ĐANG CÓ TẢI' : 'LẤP ĐẦY CAO'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 bg-slate-700/50 border-b border-slate-700">
                <div className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-3">
                  Tổng quan · Tầng {activeFloor}
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-slate-700 rounded-lg p-3">
                    <div className="text-xl font-bold text-white">{currentFloorCorridors.length}</div>
                    <div className="text-xs text-slate-400">Hành lang</div>
                  </div>
                  <div className="bg-slate-700 rounded-lg p-3">
                    <div className={`text-xl font-bold ${criticalCount > 0 ? 'text-red-400' : 'text-slate-300'}`}>{criticalCount}</div>
                    <div className="text-xs text-slate-400">Lấp đầy ≥80%</div>
                  </div>
                </div>
                {occupancyRatios.length > 0 && (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-400">Lấp đầy TB</span>
                      <span className={`font-bold ${avgOccupancy >= 0.8 ? 'text-red-400' : avgOccupancy >= 0.5 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {(avgOccupancy * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 bg-slate-600 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${avgOccupancy >= 0.8 ? 'bg-red-500' : avgOccupancy >= 0.5 ? 'bg-yellow-400' : 'bg-green-500'}`}
                        style={{ width: `${avgOccupancy * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 space-y-2">
                <div className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Độ lấp đầy hành lang</div>
                {currentFloorCorridors.length === 0 && (
                  <div className="text-slate-500 text-sm text-center py-8">Chưa có hành lang nào trên tầng này</div>
                )}
                {currentFloorCorridors.map(corridor => {
                  const ratio = occupancyData[corridor.id] ?? simulationState.edgeOccupancy?.[corridor.id] ?? 0;
                  const pct = Math.round(ratio * 100);
                  const st = ratio >= 0.8
                    ? { label: 'Lấp đầy cao', bar: 'bg-red-500', badge: 'bg-red-900/60 text-red-300', val: 'text-red-400' }
                    : ratio >= 0.5
                    ? { label: 'Lấp đầy vừa', bar: 'bg-yellow-400', badge: 'bg-yellow-900/60 text-yellow-300', val: 'text-yellow-400' }
                    : { label: 'Lấp đầy thấp', bar: 'bg-green-500', badge: 'bg-green-900/60 text-green-300', val: 'text-green-400' };

                  return (
                    <div key={corridor.id} className="bg-slate-700 rounded-xl p-3">
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="flex-1 mr-2">
                          <div className="text-white text-xs font-semibold truncate">{corridor.name}</div>
                          <div className="text-slate-500 text-xs mt-0.5 truncate">
                            k = {ratio.toFixed(3)} · rộng {(corridor.widthMeters || DEFAULT_CORRIDOR_WIDTH_METERS).toFixed(1)} m
                            {' · '}R = {((corridor.widthMeters || DEFAULT_CORRIDOR_WIDTH_METERS) * (1 - ratio)).toFixed(2)}
                          </div>
                        </div>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${st.badge} font-medium flex-shrink-0`}>{st.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-600 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${st.bar}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-xs font-bold ${st.val} w-8 text-right`}>{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Lịch sử hệ thống (Logs) */}
              <div className="p-3 border-t border-slate-700">
                <div className="flex justify-between items-center mb-2">
                  <div className="text-slate-400 text-xs font-bold uppercase tracking-widest">Nhật ký Hệ thống</div>
                  <button onClick={() => setLogs([])} className="text-xs text-slate-500 hover:text-slate-300">Xóa</button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                  {logs.length === 0 ? (
                    <div className="text-slate-500 text-xs italic text-center py-4">Chưa có sự kiện nào</div>
                  ) : (
                    logs.map((log, idx) => (
                      <div key={idx} className={`p-2 rounded border-l-2 text-xs ${log.type === 'alert' ? 'bg-red-900/20 border-red-500 text-red-200' : 'bg-slate-700/50 border-blue-500 text-slate-300'}`}>
                        <div className="flex justify-between items-start mb-1">
                          <span className={`font-bold ${log.type === 'alert' ? 'text-red-400' : 'text-blue-400'}`}>
                            {log.type === 'alert' ? '⚠️ CẢNH BÁO' : '🔄 ĐIỀU HƯỚNG'}
                          </span>
                          <span className="text-slate-500 text-[10px]">{log.time}</span>
                        </div>
                        <div className="leading-relaxed">{log.message}</div>
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
