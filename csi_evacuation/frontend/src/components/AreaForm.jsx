import React, { useState, useEffect } from 'react';
import { visualForArea } from './scene3d';

const TYPE_OPTIONS = [
  {
    value: 'room',
    label: 'Phòng / Khu vực',
    badge: 'ROOM',
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="1" />
        <path d="M9 3v18M3 15h6" />
      </svg>
    ),
    active: 'bg-blue-800/90 text-white border-blue-500',
    inactive: 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700',
  },
  {
    value: 'stairs',
    label: 'Cầu thang bộ',
    badge: 'STAIR',
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M19 5v4h-4v4h-4v4H7v4H3" />
      </svg>
    ),
    active: 'bg-amber-800/90 text-white border-amber-500',
    inactive: 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700',
  },
  {
    value: 'exit',
    label: 'Lối thoát hiểm khẩn cấp',
    badge: 'EXIT',
    icon: (
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
      </svg>
    ),
    active: 'bg-emerald-800/90 text-white border-emerald-500',
    inactive: 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700',
  },
];

export default function AreaForm({
  area,
  allAreas,
  stairwells,
  corridors,
  onToggleCorridor,
  onChange,
  onUpdateLanding,
  onDelete,
}) {
  const [name, setName] = useState(area.name || '');

  useEffect(() => {
    setName(area.name || '');
  }, [area.id, area.name]);

  const handleNameChange = (e) => {
    const val = e.target.value;
    setName(val);
    onChange({ ...area, name: val });
  };

  const handleTypeChange = (type) => {
    onChange({
      ...area,
      type,
      visualKind: type === 'room' ? (area.visualKind === 'junction' ? 'junction' : 'room') : type,
    });
  };

  const handleVisualKindChange = (visualKind) => onChange({ ...area, visualKind });

  const visual3d = visualForArea(area);
  const updateVisual3d = (patch) => onChange({
    ...area,
    visual3d: { ...visual3d, ...patch, sizeMode: 'manual' },
  });

  const availableConnections = (allAreas || []).filter(c => {
    if (c.id === area.id) return false;
    const isSameFloor = (c.floor || 1) === (area.floor || 1);
    const isAdjacentFloor = Math.abs((c.floor || 1) - (area.floor || 1)) === 1;

    if (area.type !== 'stairs') {
      return isSameFloor;
    } else {
      if (isSameFloor) return true;
      if (isAdjacentFloor && c.type === 'stairs') return true;
      return false;
    }
  });

  const stairwell = (stairwells || []).find((well) => well.id === area.stairwellId);
  const landingSide = stairwell?.landingConfigs?.[area.id]?.entranceSide || 'auto';
  const sameFloorCorridors = (corridors || []).filter((corridor) => {
    const otherId = corridor.areaA_id === area.id ? corridor.areaB_id : corridor.areaB_id === area.id ? corridor.areaA_id : null;
    return otherId && allAreas.find((item) => item.id === otherId)?.floor === area.floor;
  });
  const junctionSuggestion = area.type === 'room' && area.visualKind !== 'junction' && sameFloorCorridors.length >= 3;

  const isConnected = (targetId) => {
    return (corridors || []).some(
      c => (c.areaA_id === area.id && c.areaB_id === targetId) ||
           (c.areaB_id === area.id && c.areaA_id === targetId)
    );
  };

  return (
    <div className="bg-slate-900/90 rounded border border-slate-700/80 p-3 space-y-3 text-slate-200">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-800">
        <div className="min-w-0 flex-1">
          <div className="text-white text-xs font-bold uppercase tracking-wider whitespace-nowrap">
            Cấu hình khu vực
          </div>
          <div className="font-mono text-[10px] text-slate-400 mt-0.5 truncate" title={`ID: ${area.id}`}>
            NODE: <span className="text-slate-300 font-semibold">{area.id}</span>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="text-red-400 hover:text-red-300 text-[11px] font-semibold px-2 py-1 bg-red-950/40 hover:bg-red-900/60 border border-red-800/40 rounded transition-colors flex items-center gap-1.5 flex-shrink-0"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Xóa
        </button>
      </div>

      {/* Name */}
      <div>
        <label className="block text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-1">Tên khu vực</label>
        <input
          type="text"
          value={name}
          onChange={handleNameChange}
          className="w-full bg-slate-800 text-white rounded px-2.5 py-1.5 text-xs border border-slate-700 focus:border-blue-500 focus:outline-none transition-colors"
          placeholder="Nhập tên khu vực..."
        />
      </div>

      {/* Type Selector */}
      <div>
        <label className="block text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-1.5">Loại khu vực</label>
        <div className="space-y-1">
          {TYPE_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => handleTypeChange(o.value)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs font-medium border transition-all ${
                area.type === o.value ? o.active : o.inactive
              }`}
            >
              <span className="text-slate-300">{o.icon}</span>
              <span className="flex-1 text-left">{o.label}</span>
              <span className="font-mono text-[9px] px-1 py-0.5 rounded bg-black/40 text-slate-300 border border-white/10">{o.badge}</span>
              {area.type === o.value && <span className="text-white text-xs">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {area.type === 'room' && (
        <div className="pt-2.5 border-t border-slate-800">
          <label className="block text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-1.5">Vai trò hiển thị</label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => handleVisualKindChange('room')}
              className={`rounded px-2 py-1.5 text-xs font-semibold border transition-colors ${
                area.visualKind !== 'junction'
                  ? 'bg-blue-700 text-white border-blue-500'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
              }`}
            >
              Phòng / Khu vực
            </button>
            <button
              type="button"
              onClick={() => handleVisualKindChange('junction')}
              className={`rounded px-2 py-1.5 text-xs font-semibold border transition-colors ${
                area.visualKind === 'junction'
                  ? 'bg-teal-700 text-white border-teal-500'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-750'
              }`}
            >
              Nút giao hành lang
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-slate-500 leading-normal">
            Nút giao chỉ đổi hình thức hiển thị trên bản đồ; các hành lang và dữ liệu định tuyến D* Lite vẫn giữ nguyên.
          </p>
        </div>
      )}

      {junctionSuggestion && (
        <button
          type="button"
          onClick={() => handleVisualKindChange('junction')}
          className="w-full rounded border border-teal-500/40 bg-teal-950/30 px-2.5 py-1.5 text-left text-[10px] text-teal-200 hover:bg-teal-900/40 transition-colors"
        >
          Gợi ý: Nút này có {sameFloorCorridors.length} hành lang kết nối. Nhấp để chuyển sang kiểu nút giao giúp các nhánh vẽ liên tục hơn.
        </button>
      )}

      {/* 3D Geometry */}
      <div className="pt-2.5 border-t border-slate-800 space-y-2">
        <label className="block text-slate-400 text-[10px] uppercase font-bold tracking-wider">Thông số khối 3D</label>
        {visual3d.sizeMode === 'auto' && (
          <p className="text-[10px] text-cyan-400">Đang tự cân chỉnh theo hành lang. Sửa một trường để khóa kích thước thủ công.</p>
        )}
        <div className="grid grid-cols-2 gap-1.5 font-mono">
          <label className="text-[10px] text-slate-400">
            Rộng (m)
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={visual3d.widthMeters}
              onChange={event => updateVisual3d({ widthMeters: Math.max(0.5, Number(event.target.value) || 0.5) })}
              className="mt-0.5 w-full bg-slate-800 text-white rounded px-2 py-1 text-xs border border-slate-700 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="text-[10px] text-slate-400">
            Sâu (m)
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={visual3d.depthMeters}
              onChange={event => updateVisual3d({ depthMeters: Math.max(0.5, Number(event.target.value) || 0.5) })}
              className="mt-0.5 w-full bg-slate-800 text-white rounded px-2 py-1 text-xs border border-slate-700 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="text-[10px] text-slate-400">
            Cao (m)
            <input
              type="number"
              min="0.5"
              step="0.1"
              value={visual3d.heightMeters}
              onChange={event => updateVisual3d({ heightMeters: Math.max(0.5, Number(event.target.value) || 0.5) })}
              className="mt-0.5 w-full bg-slate-800 text-white rounded px-2 py-1 text-xs border border-slate-700 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="text-[10px] text-slate-400">
            Xoay (°)
            <input
              type="number"
              step="15"
              value={visual3d.rotationDegrees}
              onChange={event => updateVisual3d({ rotationDegrees: Number(event.target.value) || 0 })}
              className="mt-0.5 w-full bg-slate-800 text-white rounded px-2 py-1 text-xs border border-slate-700 focus:border-blue-500 focus:outline-none"
            />
          </label>
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
          <span>Màu khối 3D</span>
          <input
            type="color"
            value={visual3d.color}
            onChange={event => updateVisual3d({ color: event.target.value })}
            className="h-6 w-10 rounded border border-slate-700 bg-slate-800 p-0.5 cursor-pointer"
          />
        </div>
      </div>

      {/* Stairwell */}
      {stairwell && (
        <div className="rounded border border-amber-500/40 bg-amber-950/20 p-2.5 text-xs space-y-1.5">
          <div className="font-semibold text-amber-200 flex items-center justify-between">
            <span>Lõi cầu thang bộ</span>
            <span className="font-mono text-[10px] text-amber-300">ID: {stairwell.id}</span>
          </div>
          <div className="text-[11px] text-amber-100/80">
            Liên kết các tầng: {stairwell.areaIds.map(id => allAreas.find(item => item.id === id)?.floor).filter(Boolean).sort((a, b) => a - b).join(', ')}
          </div>
          <p className="text-[10px] text-amber-200/70 leading-normal">
            Tọa độ mặt bằng, kích thước và góc xoay được đồng bộ xuyên suốt các tầng của lõi thang này.
          </p>
          <label className="block text-amber-100/90 text-[10px] uppercase font-bold tracking-wider pt-1">
            Cổng tiếp cận cầu thang
            <select
              value={landingSide}
              onChange={(event) => onUpdateLanding?.(stairwell.id, area.id, event.target.value)}
              className="mt-1 w-full rounded border border-amber-400/40 bg-slate-900 px-2 py-1 text-xs text-white focus:outline-none"
            >
              <option value="auto">Tự động (tính từ hành lang nối)</option>
              <option value="front">Mặt trước</option>
              <option value="right">Mặt phải</option>
              <option value="back">Mặt sau</option>
              <option value="left">Mặt trái</option>
            </select>
          </label>
          {sameFloorCorridors.length === 0 && (
            <p className="text-[10px] text-amber-300">
              Chưa có hành lang cùng tầng để tự động xác định cổng. Vui lòng chọn hướng tiếp cận thủ công.
            </p>
          )}
        </div>
      )}

      {/* Meta */}
      <div className="pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-500 flex justify-between">
        <span>TẦNG: {area.floor}</span>
        <span>TỌA ĐỘ: ({Math.round(area.x)}, {Math.round(area.y)})</span>
      </div>

      {/* Connections List */}
      {allAreas && (
        <div className="pt-2 border-t border-slate-800">
          <label className="block text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-1.5">
            KẾT NỐI HÀNH LANG ({availableConnections.length})
          </label>
          <div className="space-y-1 max-h-40 overflow-y-auto bg-slate-950/60 p-1.5 rounded border border-slate-800">
            {availableConnections.map(c => {
              const connected = isConnected(c.id);
              const isCrossFloor = c.floor !== area.floor;
              return (
                <label
                  key={c.id}
                  className={`flex items-center space-x-2 text-xs p-1.5 rounded cursor-pointer transition-colors ${
                    connected ? 'bg-slate-800/80 text-white' : 'hover:bg-slate-850 text-slate-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={connected}
                    onChange={() => onToggleCorridor && onToggleCorridor(area.id, c.id)}
                    className="rounded text-blue-500 focus:ring-0 bg-slate-800 border-slate-600 w-3.5 h-3.5"
                  />
                  <span className={`truncate flex-1 ${isCrossFloor ? 'text-amber-400 font-semibold' : 'text-slate-200'}`}>
                    {c.name}
                  </span>
                  {isCrossFloor && (
                    <span className="font-mono text-[9px] px-1 py-0.5 rounded bg-amber-950/50 text-amber-300 border border-amber-700/50">
                      T{c.floor}
                    </span>
                  )}
                </label>
              );
            })}
            {availableConnections.length === 0 && (
              <div className="text-[10px] text-slate-500 text-center py-2">Không có khu vực nào hợp lệ để kết nối.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

