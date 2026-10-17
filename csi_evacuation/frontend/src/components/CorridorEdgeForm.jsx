import React, { useState, useEffect } from 'react';

const AREA_DOT_COLOR = {
  room: 'bg-cyan-500',
  stairs: 'bg-amber-500',
  exit: 'bg-emerald-500',
};

export default function CorridorEdgeForm({
  corridor,
  areas,
  devices = [],
  guidanceDevices = [],
  onChange,
  onDelete,
  onSelectArea,
  onUpdateDevice,
  onAddDevice,
  onDeleteDevice,
}) {
  const [name, setName] = useState(corridor.name || '');
  const [length, setLength] = useState(corridor.length || 10);
  const [widthMeters, setWidthMeters] = useState(corridor.widthMeters || 1.2);
  const [capacityPeople, setCapacityPeople] = useState(
    corridor.capacityPeople ?? Math.round((corridor.length || 10) * (corridor.widthMeters || 1.2) * 2)
  );
  const [flowCapacity, setFlowCapacity] = useState(corridor.flowCapacity ?? '');
  const [initialOccupancy, setInitialOccupancy] = useState(corridor.initialOccupancy ?? 0.5);
  const [csiLinkId, setCsiLinkId] = useState(corridor.csiLinkId || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState('basic'); // 'basic' | 'advanced'

  useEffect(() => {
    setName(corridor.name || '');
    setLength(corridor.length || 10);
    setWidthMeters(corridor.widthMeters || 1.2);
    setCapacityPeople(
      corridor.capacityPeople ?? Math.round((corridor.length || 10) * (corridor.widthMeters || 1.2) * 2)
    );
    setFlowCapacity(corridor.flowCapacity ?? '');
    setInitialOccupancy(corridor.initialOccupancy ?? 0.5);
    setCsiLinkId(corridor.csiLinkId || '');
    setShowDeleteConfirm(false);
  }, [
    corridor.id,
    corridor.name,
    corridor.length,
    corridor.widthMeters,
    corridor.capacityPeople,
    corridor.flowCapacity,
    corridor.initialOccupancy,
    corridor.csiLinkId,
  ]);

  const areaA = (areas || []).find(a => a.id === corridor.areaA_id);
  const areaB = (areas || []).find(a => a.id === corridor.areaB_id);

  const corridorDevices = devices.filter(
    d => d.edge_id === corridor.id || (d.type === 'speaker' && d.csiLinkId && corridor.csiLinkId && corridor.csiLinkId.includes(d.csiLinkId))
  );

  const isCrossFloor = areaA && areaB && (areaA.floor !== areaB.floor);
  const isStair = areaA?.type === 'stairs' || areaB?.type === 'stairs' || isCrossFloor;
  const autoFlow = Number((widthMeters * 1.3 * (isStair ? 0.75 : 1.0)).toFixed(2));

  const displayName = corridor.name || `${areaA?.name || 'Khu vực A'} → ${areaB?.name || 'Khu vực B'}`;

  const hasWarnings = corridor.lengthEstimated || corridor.widthEstimated || capacityPeople <= 0;

  const handleNameChange = (e) => {
    setName(e.target.value);
    onChange({ ...corridor, name: e.target.value });
  };

  const handleLengthChange = (e) => {
    const val = Math.max(1, Number(e.target.value));
    setLength(val);
    onChange({ ...corridor, length: val, lengthEstimated: false });
  };

  const handleWidthChange = (e) => {
    const value = Math.max(0.1, Number(e.target.value) || 0.1);
    setWidthMeters(value);
    onChange({ ...corridor, widthMeters: value, widthEstimated: false });
  };

  const handleCapacityChange = (e) => {
    const value = Math.max(0, Number(e.target.value) || 0);
    setCapacityPeople(value);
    onChange({ ...corridor, capacityPeople: value });
  };

  const handleFlowCapacityChange = (e) => {
    const value = e.target.value === '' ? '' : Math.max(0.01, Number(e.target.value) || 0.01);
    setFlowCapacity(value);
    onChange({ ...corridor, flowCapacity: value === '' ? undefined : value });
  };

  const handleInitialOccupancyChange = (e) => {
    const value = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100;
    setInitialOccupancy(value);
    onChange({ ...corridor, initialOccupancy: value });
  };

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3.5 space-y-3.5 text-slate-200 shadow-sm backdrop-blur-sm">
      {/* ── 1. Header (Tổng quan & Thao tác) ── */}
      <div className="pb-2.5 border-b border-slate-800">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 font-mono">
              HÀNH LANG LIÊN KẾT
            </div>
            <div className="text-white text-sm font-bold truncate mt-0.5" title={displayName}>
              {displayName}
            </div>
          </div>

          {!showDeleteConfirm && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-colors flex items-center gap-1 flex-shrink-0"
              title="Xóa hành lang"
            >
              <svg className="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Xóa</span>
            </button>
          )}
        </div>

        {/* Hộp thoại xác nhận xóa */}
        {showDeleteConfirm && (
          <div className="mt-2.5 p-3 rounded-xl border border-rose-500/40 bg-rose-950/40 space-y-2">
            <div className="text-xs font-bold text-rose-200">Xác nhận xóa hành lang?</div>
            <div className="text-[11px] text-rose-300/80 leading-normal">
              Hành lang <strong>{displayName}</strong> sẽ bị xóa khỏi bản đồ và thuật toán dẫn đường D* Lite.
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-2.5 py-1 text-xs rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => { setShowDeleteConfirm(false); onDelete(); }}
                className="px-2.5 py-1 text-xs rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-colors"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 2. Segmented Mode Switcher (Cơ bản vs Nâng cao) ── */}
      <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('basic')}
          className={`flex-1 py-1 rounded-md font-medium text-xs transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'basic'
              ? 'bg-slate-800 text-cyan-400 font-semibold border border-cyan-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>⚡</span>
          <span>Cơ bản & Thiết bị IoT</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('advanced')}
          className={`flex-1 py-1 rounded-md font-medium text-xs transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'advanced'
              ? 'bg-slate-800 text-cyan-400 font-semibold border border-cyan-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>⚙️</span>
          <span>Vận hành & D* Lite</span>
        </button>
      </div>

      {/* ── 3. Tab CƠ BẢN (Dành cho người mới) ── */}
      {activeTab === 'basic' && (
        <div className="space-y-3.5">
          {/* 3.1 Tuyến đường kết nối */}
          <div className="space-y-1.5">
            <label className="block text-slate-300 text-xs font-semibold">
              Tuyến đường kết nối giữa hai khu vực:
            </label>
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-bold text-white">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${AREA_DOT_COLOR[areaA?.type || 'room']}`} />
                  <span className="truncate" title={areaA?.name || 'Điểm A'}>{areaA?.name || 'Điểm A'}</span>
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5 pl-3.5">
                  Tầng {areaA?.floor ?? 1}
                </div>
              </div>

              <div className="flex flex-col items-center px-1 flex-shrink-0 text-cyan-400 font-bold">
                <span className="text-xs font-mono">─── ⇄ ───</span>
                {isCrossFloor && (
                  <span className="text-[9px] font-mono text-amber-400 font-semibold mt-0.5">
                    Liên tầng
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1 text-right">
                <div className="flex items-center justify-end gap-1.5 font-bold text-white">
                  <span className="truncate" title={areaB?.name || 'Điểm B'}>{areaB?.name || 'Điểm B'}</span>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${AREA_DOT_COLOR[areaB?.type || 'room']}`} />
                </div>
                <div className="text-[10px] text-slate-400 font-mono mt-0.5 pr-3.5">
                  Tầng {areaB?.floor ?? 1}
                </div>
              </div>
            </div>
          </div>

          {/* 3.2 Tên hành lang */}
          <div className="space-y-1">
            <label className="block text-slate-300 text-xs font-semibold">
              Tên gọi hành lang (Tùy chọn)
            </label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder={`${areaA?.name || 'Khu vực A'} → ${areaB?.name || 'Khu vực B'}`}
              className="w-full bg-slate-900/90 text-white rounded-lg px-3 py-2 text-xs border border-slate-700/80 focus:border-cyan-500 focus:outline-none transition-colors placeholder:text-slate-500 shadow-inner"
            />
          </div>

          {/* 3.3 Kích thước hành lang */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
            <div className="text-xs font-semibold text-slate-300">
              Kích thước thực tế
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                  <span>Chiều rộng</span>
                  <span className="font-mono text-cyan-300 font-bold">{widthMeters} m</span>
                </div>
                <input
                  type="number"
                  min="0.2"
                  max="10"
                  step="0.1"
                  value={widthMeters}
                  onChange={handleWidthChange}
                  className="w-full bg-slate-900 text-white rounded-lg px-2.5 py-1.5 text-xs font-mono border border-slate-700 focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                  <span>Chiều dài</span>
                  <span className="font-mono text-cyan-300 font-bold">{length} m</span>
                </div>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={length}
                  onChange={handleLengthChange}
                  className="w-full bg-slate-900 text-white rounded-lg px-2.5 py-1.5 text-xs font-mono border border-slate-700 focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-500 leading-snug">
              💡 Hệ thống sẽ tự động ước tính sức chứa ({capacityPeople} người) và vận tốc dòng người dựa trên kích thước này.
            </p>
          </div>

          {/* 3.4 Cảm biến sóng WiFi CSI */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${csiLinkId ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                <span>Cảm biến sóng WiFi (CSI)</span>
              </div>
              <span className="text-[10px] text-emerald-400 font-mono font-semibold">ESP32-S3</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Chọn cặp cảm biến WiFi được gắn trên hành lang này để nhận diện mật độ người:
            </p>
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              {[
                { id: '', label: 'Chưa gắn cảm biến' },
                { id: 'link-1', label: 'Cặp #1 (link-1)' },
                { id: 'link-2', label: 'Cặp #2 (link-2)' },
                { id: 'link-3', label: 'Cặp #3 (link-3)' },
              ].map(item => {
                const isSelected = item.id === '' ? !csiLinkId : csiLinkId.split(',').map(s => s.trim()).includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setCsiLinkId(item.id);
                      onChange({ ...corridor, csiLinkId: item.id || undefined });
                    }}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium border text-left transition-all ${
                      isSelected
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 font-bold shadow-sm'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isSelected ? '✓ ' : ''}{item.label}
                  </button>
                );
              })}
            </div>
            {csiLinkId && (
              <div className="text-[10px] text-emerald-400 font-mono bg-emerald-950/40 border border-emerald-800/40 rounded-lg p-2 flex items-center gap-1.5">
                <span>✓</span>
                <span>Đang kết nối luồng cảm biến <strong>[{csiLinkId}]</strong> từ Raspberry Pi.</span>
              </div>
            )}
          </div>

          {/* 3.5 Loa phát thanh điều hướng */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
                <span>Loa phát âm thanh điều hướng ({corridorDevices.length})</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const nextNodeId = corridorDevices.length + 1;
                  const newDev = {
                    id: `node_spkr_${Date.now()}`,
                    name: `Node ${nextNodeId} - Loa Hành Lang`,
                    type: 'speaker',
                    edge_id: corridor.id,
                    csiLinkId: corridor.csiLinkId || undefined,
                    node_id: nextNodeId,
                    placement: 'middle',
                    topic: `building/guidance/speaker/node_${nextNodeId}`,
                  };
                  onAddDevice?.(newDev);
                }}
                className="px-2.5 py-1 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-all shadow-sm flex items-center gap-1 cursor-pointer"
              >
                <span>+ Thêm Loa</span>
              </button>
            </div>

            {corridorDevices.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic">
                Hành lang chưa gắn loa. Nhấn nút <strong>"+ Thêm Loa"</strong> nếu bạn có lắp đặt node loa ESP32 tại đây.
              </p>
            ) : (
              <div className="space-y-2">
                {corridorDevices.map((dev) => {
                  const live = guidanceDevices.find(item => item.id === dev.id || (item.node_id != null && item.node_id === dev.node_id));
                  const isOnline = live?.status === 'online';

                  return (
                    <div key={dev.id} className="bg-slate-900/90 rounded-xl p-2.5 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                          <span className="text-xs font-bold text-white truncate">
                            {dev.name || `Node Loa #${dev.node_id || 1}`}
                          </span>
                        </div>
                        <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
                          isOnline ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {isOnline ? 'ONLINE' : 'CHỜ KẾT NỐI'}
                        </span>
                        <button
                          type="button"
                          onClick={() => onDeleteDevice?.(dev.id)}
                          className="text-slate-500 hover:text-rose-400 text-xs p-1"
                          title="Gỡ bỏ loa này khỏi hành lang"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Chọn vị trí gắn loa */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                          Vị trí lắp đặt loa trên thực địa:
                        </span>
                        <select
                          value={dev.placement || 'middle'}
                          onChange={e => {
                            const pl = e.target.value;
                            const posName = pl === 'near_a' ? `Đầu ${areaA?.name || 'A'}` : pl === 'near_b' ? `Đầu ${areaB?.name || 'B'}` : 'Ở giữa HL';
                            onUpdateDevice?.({
                              ...dev,
                              placement: pl,
                              name: `Node ${dev.node_id || 1} - Loa (${posName})`,
                            });
                          }}
                          className="w-full bg-slate-950 text-cyan-300 font-semibold rounded-lg px-2.5 py-1.5 border border-slate-700 focus:outline-none text-xs cursor-pointer"
                        >
                          <option value="near_a">📍 Đầu phía {areaA?.name || 'Điểm A'}</option>
                          <option value="middle">📍 Ở đoạn giữa hành lang</option>
                          <option value="near_b">📍 Đầu phía {areaB?.name || 'Điểm B'}</option>
                        </select>
                      </div>

                      {live?.last_command && (
                        <div className="text-[11px] font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 rounded-lg p-2 flex items-center justify-between">
                          <span>Bản tin gần nhất: <strong>{live.last_command.command}</strong></span>
                          <span className="text-slate-500 text-[10px]">seq #{live.last_command.sequence}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 4. Tab NÂNG CAO (D* Lite & Tham số vận hành) ── */}
      {activeTab === 'advanced' && (
        <div className="space-y-3.5">
          {/* Sức chứa tối đa Cmax */}
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-300">
              Sức chứa tối đa (Cmax)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                value={capacityPeople}
                onChange={handleCapacityChange}
                className="flex-1 bg-slate-900 text-white rounded-lg px-3 py-1.5 text-xs font-mono border border-slate-700 focus:border-cyan-500 focus:outline-none"
              />
              <span className="text-slate-400 text-xs font-mono">người</span>
            </div>
            <p className="text-[10px] text-slate-500">
              Ngưỡng số người tối đa trước khi hành lang bị tắc nghẽn hoàn toàn.
            </p>
          </div>

          {/* Khả năng thông hành */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">
                Tốc độ xả lưu lượng
              </label>
              {flowCapacity !== '' && flowCapacity !== undefined ? (
                <button
                  type="button"
                  onClick={() => { setFlowCapacity(''); onChange({ ...corridor, flowCapacity: undefined }); }}
                  className="text-[10px] text-cyan-400 hover:underline"
                >
                  Đặt lại tự tính
                </button>
              ) : (
                <span className="text-[10px] text-slate-400 font-mono">
                  Tự tính: {autoFlow} ng/s
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0.01"
                step="0.1"
                value={flowCapacity}
                onChange={handleFlowCapacityChange}
                placeholder={`Tự động: ${autoFlow}`}
                className="flex-1 bg-slate-900 text-white placeholder-slate-500 rounded-lg px-3 py-1.5 text-xs font-mono border border-slate-700 focus:border-cyan-500 focus:outline-none"
              />
              <span className="text-slate-400 text-xs font-mono">người/giây</span>
            </div>
          </div>

          {/* Độ lấp đầy ban đầu k(e) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">
                Độ lấp đầy ban đầu k(e)
              </label>
              <span className="text-xs font-mono font-bold text-cyan-400">
                {Math.round(initialOccupancy * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(initialOccupancy * 100)}
                onChange={handleInitialOccupancyChange}
                className="flex-1 accent-cyan-500 h-1.5 bg-slate-800 rounded cursor-pointer"
              />
              <input
                type="number"
                min="0"
                max="100"
                value={Math.round(initialOccupancy * 100)}
                onChange={handleInitialOccupancyChange}
                className="w-16 bg-slate-900 text-white rounded-lg px-2 py-1 text-xs font-mono border border-slate-700 focus:outline-none text-right"
              />
              <span className="text-slate-400 text-xs font-mono">%</span>
            </div>
          </div>

          {/* Bảng hiệu 2 đầu hành lang */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5">
            <div className="text-xs font-semibold text-slate-300">
              Kiểm tra bảng hiệu IoT tại 2 đầu hành lang:
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {areaA && (
                <button
                  type="button"
                  onClick={() => onSelectArea?.(areaA)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-xs font-mono text-center cursor-pointer transition-colors"
                >
                  📍 Đầu: {areaA.name}
                </button>
              )}
              {areaB && (
                <button
                  type="button"
                  onClick={() => onSelectArea?.(areaB)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-xs font-mono text-center cursor-pointer transition-colors"
                >
                  📍 Đầu: {areaB.name}
                </button>
              )}
            </div>
          </div>

          {/* Cảnh báo cấu hình */}
          {hasWarnings && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs space-y-1">
              <div className="font-bold text-amber-300 flex items-center gap-1.5">
                <span>⚠</span>
                <span>Lưu ý tham số:</span>
              </div>
              <ul className="text-[11px] text-amber-200/80 space-y-0.5 pl-1">
                {corridor.lengthEstimated && (
                  <li>• Chiều dài đang dùng số đo mặc định ({length}m).</li>
                )}
                {corridor.widthEstimated && (
                  <li>• Chiều rộng đang dùng số đo mặc định ({widthMeters}m).</li>
                )}
                {capacityPeople <= 0 && (
                  <li className="text-rose-300">• Sức chứa ≤ 0: hành lang sẽ bị loại khỏi tuyến dẫn đường.</li>
                )}
              </ul>
            </div>
          )}

          {/* Thông tin kỹ thuật & Trọng số D* Lite */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs font-mono space-y-1.5">
            <div className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">
              Mô hình trọng số D* Lite
            </div>
            <div className="flex justify-between text-slate-400 text-[11px]">
              <span>Mã Edge ID:</span>
              <span className="text-slate-200">#{corridor.id}</span>
            </div>
            <div className="flex justify-between text-slate-400 text-[11px]">
              <span>Thời gian gốc t₀:</span>
              <span className="text-slate-200">{(length / 1.2).toFixed(2)}s (v = 1.2 m/s)</span>
            </div>
            <div className="flex justify-between text-slate-400 text-[11px]">
              <span>Bề rộng khả dụng R(e):</span>
              <span className="text-emerald-400">{widthMeters.toFixed(2)} × [1 − k(e)]</span>
            </div>
            <div className="text-[10px] text-cyan-400 pt-1 border-t border-slate-800">
              Trọng số thời gian thực: w(e) = t₀ × [1 + 1.5 × k(e)⁴] + H(e)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
