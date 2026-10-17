import React, { useState, useEffect } from 'react';

const AREA_DOT_COLOR = {
  room: 'bg-blue-500',
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
    <div className="rounded border border-slate-800 bg-slate-900/80 p-3 space-y-3.5 text-slate-200">
      {/* ── 1. Header (Tổng quan & Thao tác) ── */}
      <div className="pb-2.5 border-b border-slate-800">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Hành lang
            </div>
            <div className="text-white text-sm font-semibold truncate mt-0.5" title={displayName}>
              {displayName}
            </div>
          </div>

          {!showDeleteConfirm && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/50 border border-red-800/40 rounded transition-colors flex items-center gap-1 flex-shrink-0"
              title="Xóa hành lang"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Xóa</span>
            </button>
          )}
        </div>

        {/* Hộp thoại xác nhận xóa */}
        {showDeleteConfirm && (
          <div className="mt-2.5 p-2.5 rounded border border-red-700/60 bg-red-950/40 space-y-2">
            <div className="text-xs font-semibold text-red-200">Xác nhận xóa hành lang?</div>
            <div className="text-[11px] text-red-300/80 leading-normal">
              Hành lang <strong>{displayName}</strong> sẽ bị xóa khỏi bản đồ và thuật toán dẫn đường.
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-2.5 py-1 text-xs rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => { setShowDeleteConfirm(false); onDelete(); }}
                className="px-2.5 py-1 text-xs rounded bg-red-700 hover:bg-red-600 text-white font-semibold transition-colors"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Gắn thiết bị bảng hiệu / loa tại 2 đầu hành lang */}
      <div className="bg-slate-950/80 rounded border border-slate-800 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-slate-300 text-[10px] font-bold uppercase tracking-wider">
            Bảng hiệu chỉ dẫn hành lang
          </div>
          <span className="text-[9px] text-cyan-400 font-mono">Gắn tại 2 đầu</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-snug">
          Bảng hiệu IoT được gắn tại các nút giao ở hai đầu hành lang để chỉ hướng người thoát nạn:
        </p>
        <div className="grid grid-cols-2 gap-2 pt-1">
          {areaA && (
            <button
              type="button"
              onClick={() => onSelectArea?.(areaA)}
              className="px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-xs font-mono text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-0.5"
            >
              <span className="text-[9px] text-slate-400 uppercase">Đầu hành lang</span>
              <span className="font-bold truncate w-full">📍 {areaA.name}</span>
            </button>
          )}
          {areaB && (
            <button
              type="button"
              onClick={() => onSelectArea?.(areaB)}
              className="px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-xs font-mono text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-0.5"
            >
              <span className="text-[9px] text-slate-400 uppercase">Đầu hành lang</span>
              <span className="font-bold truncate w-full">📍 {areaB.name}</span>
            </button>
          )}
        </div>
      </div>

      {/* Gắn cặp cảm biến CSI đo đạc hành lang */}
      <div className="bg-slate-950/80 rounded border border-slate-800 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-slate-300 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Cặp cảm biến CSI thực tế
          </div>
          <span className="text-[9px] text-emerald-400 font-mono font-semibold">WiEvac ESP32-S3</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-snug">
          Gán cặp node phát-thu CSI thực tế (trên Pi) vào hành lang này. Mô hình các chấm cảm biến 3D trên tường sẽ liên kết với node được chọn:
        </p>
        <div className="pt-1 space-y-1.5">
          <input
            type="text"
            value={csiLinkId}
            placeholder="VD: link-1 hoặc link-1, link-2, link-3..."
            onChange={(e) => {
              const val = e.target.value;
              setCsiLinkId(val);
              onChange({ ...corridor, csiLinkId: val || undefined });
            }}
            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2.5 py-1.5 font-mono focus:outline-none focus:border-emerald-500 placeholder:text-slate-600"
          />
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
            <span className="text-slate-500">Gán nhanh:</span>
            {['link-1', 'link-2', 'link-3', 'link-4'].map((lnk) => {
              const isIncluded = csiLinkId.split(',').map(s => s.trim()).includes(lnk);
              return (
                <button
                  key={lnk}
                  type="button"
                  onClick={() => {
                    let parts = csiLinkId ? csiLinkId.split(',').map(s => s.trim()).filter(Boolean) : [];
                    if (parts.includes(lnk)) {
                      parts = parts.filter(p => p !== lnk);
                    } else {
                      parts.push(lnk);
                    }
                    const newVal = parts.join(', ');
                    setCsiLinkId(newVal);
                    onChange({ ...corridor, csiLinkId: newVal || undefined });
                  }}
                  className={`px-1.5 py-0.5 rounded border transition-colors ${
                    isIncluded
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                      : 'bg-slate-900 text-slate-400 border-slate-700 hover:border-slate-500'
                  }`}
                >
                  {isIncluded ? '✓ ' : '+ '}{lnk}
                </button>
              );
            })}
          </div>
        </div>
        {csiLinkId && (
          <div className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
            <span>✓</span> Đang liên kết với luồng dữ liệu <strong>[{csiLinkId}]</strong> từ Raspberry Pi.
          </div>
        )}

        {/* Danh sách Node ESP32-S3 tích hợp Loa DFPlayer Mini trên hành lang */}
        <div className="pt-2.5 border-t border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-violet-300 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
              Node Loa điều hướng ({corridorDevices.length} node)
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
                  topic: `building/guidance/speaker/node_${nextNodeId}`,
                };
                onAddDevice?.(newDev);
              }}
              className="px-2 py-0.5 text-[10px] rounded bg-violet-950/80 hover:bg-violet-900 border border-violet-700 text-violet-200 font-mono transition-colors"
            >
              + Thêm Node Loa
            </button>
          </div>

          {corridorDevices.length === 0 ? (
            <div className="flex items-center justify-between p-2 rounded bg-slate-900/50 border border-slate-800/60">
              <span className="text-[10px] text-slate-400 font-mono">Chưa gán Node Loa nào cho hành lang này</span>
            </div>
          ) : (
            <div className="space-y-2">
              {corridorDevices.map((dev) => {
                const live = guidanceDevices.find(item => item.id === dev.id || (item.node_id != null && item.node_id === dev.node_id));
                const status = live?.status || 'idle';
                const statusStyle = {
                  online: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
                  waiting_ack: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
                  offline: 'bg-rose-950/60 text-rose-300 border-rose-800/60',
                  idle: 'bg-slate-800 text-slate-400 border-slate-700',
                }[status] || 'bg-slate-800 text-slate-400 border-slate-700';

                return (
                  <div key={dev.id} className="bg-slate-900/90 rounded p-2 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        value={dev.name || ''}
                        onChange={e => onUpdateDevice?.({ ...dev, name: e.target.value })}
                        className="flex-1 min-w-0 bg-slate-800 text-white rounded px-2 py-1 text-xs font-mono border border-slate-700 focus:border-violet-500 focus:outline-none"
                        placeholder="Tên Node Loa"
                      />
                      <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wider ${statusStyle}`}>
                        {status}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteDevice?.(dev.id)}
                        className="text-slate-500 hover:text-rose-400 text-xs px-1.5"
                        title="Hủy gán loa khỏi hành lang này"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                      <div>
                        <span className="text-slate-500 block">NODE PHẦN CỨNG:</span>
                        <select
                          value={dev.node_id || 1}
                          onChange={e => {
                            const nid = Number(e.target.value);
                            onUpdateDevice?.({
                              ...dev,
                              node_id: nid,
                              topic: `building/guidance/speaker/node_${nid}`,
                            });
                          }}
                          className="w-full bg-slate-800 text-violet-300 font-bold rounded px-1.5 py-1 border border-slate-700 focus:outline-none text-[10px] cursor-pointer"
                        >
                          <option value={1}>Node #1 (Loa/RX)</option>
                          <option value={2}>Node #2 (Loa/TX1)</option>
                          <option value={3}>Node #3 (Loa/TX2)</option>
                        </select>
                      </div>
                      <div>
                        <span className="text-slate-500 block">VỊ TRÍ LẮP ĐẶT:</span>
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
                          className="w-full bg-slate-800 text-cyan-300 font-semibold rounded px-1.5 py-1 border border-slate-700 focus:outline-none text-[10px] cursor-pointer"
                        >
                          <option value="near_a">📍 Đầu {areaA?.name || 'Điểm A'}</option>
                          <option value="middle">📍 Ở giữa hành lang</option>
                          <option value="near_b">📍 Đầu {areaB?.name || 'Điểm B'}</option>
                        </select>
                      </div>
                      <div>
                        <span className="text-slate-500 block">MQTT TOPIC:</span>
                        <input
                          value={dev.topic || ''}
                          onChange={e => onUpdateDevice?.({ ...dev, topic: e.target.value })}
                          className="w-full bg-slate-800 text-slate-300 rounded px-1.5 py-1 border border-slate-700 focus:outline-none text-[10px]"
                          placeholder="Tự động"
                        />
                      </div>
                    </div>

                    {live?.last_command && (
                      <div className="text-[10px] font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-800/50 rounded p-1.5 flex items-center justify-between">
                        <span>Lệnh âm thanh: <strong>{live.last_command.command}</strong></span>
                        <span className="text-slate-400 text-[9px]">seq: {live.last_command.sequence}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 2. Điểm kết nối ── */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Điểm kết nối
        </div>
        <div className="flex items-center justify-between gap-2 p-2.5 rounded bg-slate-950/60 border border-slate-800 text-xs">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 font-medium text-slate-200">
              <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${AREA_DOT_COLOR[areaA?.type || 'room']}`} />
              <span className="truncate" title={areaA?.name || 'Điểm A'}>{areaA?.name || 'Điểm A'}</span>
            </div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5 pl-3.5">
              Tầng {areaA?.floor ?? 1}
            </div>
          </div>

          <div className="flex flex-col items-center px-1 flex-shrink-0 text-slate-500">
            <span className="text-xs font-mono">──── ⇄ ────</span>
            {isCrossFloor && (
              <span className="text-[9px] font-mono text-amber-400 font-semibold mt-0.5">
                Liên tầng
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 text-right">
            <div className="flex items-center justify-end gap-1.5 font-medium text-slate-200">
              <span className="truncate" title={areaB?.name || 'Điểm B'}>{areaB?.name || 'Điểm B'}</span>
              <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${AREA_DOT_COLOR[areaB?.type || 'room']}`} />
            </div>
            <div className="text-[10px] text-slate-500 font-mono mt-0.5 pr-3.5">
              Tầng {areaB?.floor ?? 1}
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Thông số vật lý ── */}
      <div className="space-y-3 pt-3 border-t border-slate-800">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Thông số vật lý
        </div>

        {/* Tên hành lang */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Tên hành lang
          </label>
          <input
            type="text"
            value={name}
            onChange={handleNameChange}
            placeholder={`${areaA?.name || 'Khu vực A'} – ${areaB?.name || 'Khu vực B'}`}
            className="w-full h-8 bg-slate-800 text-slate-100 placeholder-slate-500 rounded px-2.5 text-xs border border-slate-700 focus:border-blue-500 focus:outline-none transition-colors"
          />
        </div>

        {/* Chiều dài thực địa */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-300">
              Chiều dài thực địa
            </label>
            <span className={`text-[10px] font-mono ${corridor.lengthEstimated ? 'text-amber-400' : 'text-emerald-400'}`}>
              {corridor.lengthEstimated ? '⚠ Đang dùng mặc định' : '✓ Đã cấu hình'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="1"
              max="150"
              value={length}
              onChange={handleLengthChange}
              className="flex-1 accent-blue-600 h-1.5 bg-slate-700 rounded cursor-pointer"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="1"
                max="500"
                value={length}
                onChange={handleLengthChange}
                className="w-16 h-8 bg-slate-800 text-white rounded px-2 text-xs font-mono border border-slate-700 focus:border-blue-500 focus:outline-none text-right"
              />
              <span className="text-slate-400 text-xs font-mono w-4">m</span>
            </div>
          </div>
        </div>

        {/* Chiều rộng hữu dụng W(e) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-300">
              Chiều rộng hữu dụng
            </label>
            <span className={`text-[10px] font-mono ${corridor.widthEstimated ? 'text-amber-400' : 'text-emerald-400'}`}>
              {corridor.widthEstimated ? '⚠ Đang dùng mặc định' : '✓ Đã cấu hình'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0.2"
              max="20"
              step="0.1"
              value={widthMeters}
              onChange={handleWidthChange}
              className="flex-1 h-8 bg-slate-800 text-white rounded px-2.5 text-xs font-mono border border-slate-700 focus:border-blue-500 focus:outline-none"
            />
            <span className="text-slate-400 text-xs font-mono w-4">m</span>
          </div>
        </div>
      </div>

      {/* ── 4. Thông số vận hành ── */}
      <div className="space-y-3 pt-3 border-t border-slate-800">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Thông số vận hành
        </div>

        {/* Khả năng thông hành */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-300">
              Khả năng thông hành
            </label>
            {flowCapacity !== '' && flowCapacity !== undefined ? (
              <button
                type="button"
                onClick={() => { setFlowCapacity(''); onChange({ ...corridor, flowCapacity: undefined }); }}
                className="text-[10px] text-blue-400 hover:text-blue-300 underline"
              >
                Đặt lại tự tính
              </button>
            ) : (
              <span className="text-[10px] text-slate-400 font-mono">
                Ước tính: {autoFlow} /s
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
              placeholder={`Tự động tính: ${autoFlow}`}
              className="flex-1 h-8 bg-slate-800 text-white placeholder-slate-500 rounded px-2.5 text-xs font-mono border border-slate-700 focus:border-blue-500 focus:outline-none"
            />
            <span className="text-slate-400 text-xs font-mono whitespace-nowrap">người/giây</span>
          </div>
          <details className="mt-1 group">
            <summary className="text-[10px] text-slate-400 hover:text-slate-300 cursor-pointer flex items-center gap-1 select-none">
              <span>ⓘ</span>
              <span>Cách tính khả năng thông hành</span>
            </summary>
            <div className="mt-1 p-2 bg-slate-950/70 border border-slate-800 rounded text-[10px] text-slate-400 leading-normal space-y-1">
              <p>• Khi để trống, hệ thống tự ước tính = <strong>Độ rộng ({widthMeters}m) × 1.3 người/m/s</strong> {isStair && '× 0.75 (hệ số cầu thang)'} ≈ <strong>{autoFlow} người/giây</strong>.</p>
              <p>• CSI cung cấp độ thông thoáng chuẩn hóa liên tục để điều phối luồng, không nhầm lẫn với số người đếm tuyệt đối.</p>
            </div>
          </details>
        </div>

        {/* Sức chứa tối đa Cmax */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Sức chứa tối đa (Cmax)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={capacityPeople}
              onChange={handleCapacityChange}
              className="flex-1 h-8 bg-slate-800 text-white rounded px-2.5 text-xs font-mono border border-slate-700 focus:border-blue-500 focus:outline-none"
            />
            <span className="text-slate-400 text-xs font-mono whitespace-nowrap">người</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Số người tối đa trước khi hành lang chạm ngưỡng nghẽn, mất độ thông thoáng.
          </p>
        </div>

        {/* Độ lấp đầy ban đầu k(e) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-300">
              Độ lấp đầy ban đầu k(e)
            </label>
            <span className="text-xs font-mono font-semibold text-slate-300">
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
              className="flex-1 accent-blue-600 h-1.5 bg-slate-700 rounded cursor-pointer"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0"
                max="100"
                value={Math.round(initialOccupancy * 100)}
                onChange={handleInitialOccupancyChange}
                className="w-16 h-8 bg-slate-800 text-white rounded px-2 text-xs font-mono border border-slate-700 focus:border-blue-500 focus:outline-none text-right"
              />
              <span className="text-slate-400 text-xs font-mono w-4">%</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 5. Cảnh báo (chỉ xuất hiện khi có vấn đề) ── */}
      {hasWarnings && (
        <div className="pt-3 border-t border-slate-800">
          <div className="rounded border border-amber-800/60 bg-amber-950/20 p-2.5 text-xs space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-amber-300 text-[11px]">
              <span>⚠</span>
              <span>CẢNH BÁO CẤU HÌNH</span>
            </div>
            <ul className="text-[11px] text-amber-200/80 space-y-1 pl-1">
              {corridor.lengthEstimated && (
                <li>• Chiều dài đang dùng giá trị mặc định 10 m. Hãy nhập số đo thực tế.</li>
              )}
              {corridor.widthEstimated && (
                <li>• Chiều rộng đang dùng giá trị mặc định 1.2 m. Hãy xác nhận thực địa.</li>
              )}
              {capacityPeople <= 0 && (
                <li className="text-red-300">• Sức chứa Cmax ≤ 0: hành lang sẽ bị loại khỏi tuyến D* Lite.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ── 6. Thông tin kỹ thuật (Thu gọn) ── */}
      <details className="pt-3 border-t border-slate-800 group">
        <summary className="text-xs font-medium text-slate-400 hover:text-slate-200 cursor-pointer flex items-center justify-between select-none py-0.5">
          <span>Thông tin kỹ thuật</span>
          <span className="text-[10px] text-slate-500 group-open:rotate-90 transition-transform">▶</span>
        </summary>
        <div className="mt-2 p-2.5 rounded bg-slate-950/60 border border-slate-800 text-[11px] font-mono text-slate-400 space-y-1.5">
          <div className="flex justify-between items-center gap-2">
            <span className="text-slate-500 flex-shrink-0">Mã Edge:</span>
            <span className="text-slate-300 truncate" title={corridor.id}>#{corridor.id}</span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-slate-500 flex-shrink-0">Node A:</span>
            <span className="text-slate-300 truncate">{areaA?.name || 'A'} ({corridor.areaA_id})</span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="text-slate-500 flex-shrink-0">Node B:</span>
            <span className="text-slate-300 truncate">{areaB?.name || 'B'} ({corridor.areaB_id})</span>
          </div>
          <div className="pt-1.5 border-t border-slate-800/80 text-[10px] space-y-0.5">
            <div className="text-slate-300 font-semibold">Mô hình trọng số D* Lite:</div>
            <div>t₀ = {(length / 1.2).toFixed(2)}s (v = 1.2 m/s)</div>
            <div>R(e) = {widthMeters.toFixed(2)} × [1 − k(e)]</div>
            <div className="text-cyan-400/90">w(e) = t₀ × [1 + 1.5 × k(e)⁴] + H(e)</div>
          </div>
        </div>
      </details>
    </div>
  );
}


