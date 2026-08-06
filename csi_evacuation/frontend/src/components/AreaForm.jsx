import React, { useState, useEffect } from 'react';
import { visualForArea } from './scene3d';

const TYPE_OPTIONS = [
  { value: 'room',   label: 'Phòng / Khu vực',      icon: '🏠', ring: 'ring-blue-500',   active: 'bg-blue-600 text-white', inactive: 'bg-slate-600 text-slate-300 hover:bg-slate-500' },
  { value: 'stairs', label: 'Cầu thang',             icon: '🪜', ring: 'ring-orange-500', active: 'bg-orange-600 text-white', inactive: 'bg-slate-600 text-slate-300 hover:bg-slate-500' },
  { value: 'exit',   label: 'Lối thoát khẩn cấp',   icon: '🚪', ring: 'ring-green-500',  active: 'bg-green-600 text-white', inactive: 'bg-slate-600 text-slate-300 hover:bg-slate-500' },
];

export default function AreaForm({ area, allAreas, stairwells, corridors, onToggleCorridor, onChange, onUpdateLanding, onDelete }) {
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
    onChange({ ...area, type, visualKind: type === 'room' ? (area.visualKind === 'junction' ? 'junction' : 'room') : type });
  };

  const handleVisualKindChange = (visualKind) => onChange({ ...area, visualKind });

  const opt = TYPE_OPTIONS.find(o => o.value === area.type) || TYPE_OPTIONS[0];
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

  const isConnected = (targetId) => {
    return (corridors || []).some(
      c => (c.areaA_id === area.id && c.areaB_id === targetId) ||
           (c.areaB_id === area.id && c.areaA_id === targetId)
    );
  };

  return (
    <div className="bg-slate-700 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${opt.active}`}>
            {opt.icon}
          </div>
          <span className="text-white text-sm font-semibold">Khu vực</span>
        </div>
        <button
          onClick={onDelete}
          className="text-red-400 hover:text-red-300 text-xs font-medium px-2 py-1 bg-red-900/30 hover:bg-red-900/50 rounded-lg transition-colors"
        >🗑️ Xóa</button>
      </div>

      {area.type === 'room' && (
        <div className="pt-3 border-t border-slate-600">
          <label className="block text-slate-400 text-xs mb-2 font-medium">Vai trò hiển thị</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => handleVisualKindChange('room')} className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${area.visualKind !== 'junction' ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-300 hover:bg-slate-500'}`}>▣ Phòng / khu vực</button>
            <button type="button" onClick={() => handleVisualKindChange('junction')} className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${area.visualKind === 'junction' ? 'bg-teal-600 text-white' : 'bg-slate-600 text-slate-300 hover:bg-slate-500'}`}>● Nút giao hành lang</button>
          </div>
          <p className="mt-2 text-[10px] text-slate-400">Nút giao chỉ đổi hình hiển thị; các hành lang và dữ liệu định tuyến vẫn giữ nguyên.</p>
        </div>
      )}

      {/* Name */}
      <div>
        <label className="block text-slate-400 text-xs mb-1.5 font-medium">Tên khu vực</label>
        <input
          type="text"
          value={name}
          onChange={handleNameChange}
          className="w-full bg-slate-600 text-white rounded-lg px-3 py-2 text-sm border border-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
          placeholder="Nhập tên khu vực..."
        />
      </div>

      {/* Type Selector */}
      <div>
        <label className="block text-slate-400 text-xs mb-2 font-medium">Loại khu vực</label>
        <div className="space-y-1.5">
          {TYPE_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => handleTypeChange(o.value)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                area.type === o.value ? o.active : o.inactive
              }`}
            >
              <span className="text-base">{o.icon}</span>
              <span className="flex-1 text-left">{o.label}</span>
              {area.type === o.value && <span className="text-white">✓</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-3 border-t border-slate-600 space-y-2">
        <label className="block text-slate-400 text-xs font-medium">Khối 3D</label>
        {visual3d.sizeMode === 'auto' && <p className="text-[10px] text-cyan-300">Đang dùng kích thước tự cân chỉnh. Sửa một trường để khóa kích thước thủ công.</p>}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] text-slate-400">Rộng (m)<input type="number" min="0.5" step="0.5" value={visual3d.widthMeters} onChange={event => updateVisual3d({ widthMeters: Math.max(0.5, Number(event.target.value) || 0.5) })} className="mt-1 w-full bg-slate-600 text-white rounded px-2 py-1 text-xs border border-slate-500" /></label>
          <label className="text-[10px] text-slate-400">Sâu (m)<input type="number" min="0.5" step="0.5" value={visual3d.depthMeters} onChange={event => updateVisual3d({ depthMeters: Math.max(0.5, Number(event.target.value) || 0.5) })} className="mt-1 w-full bg-slate-600 text-white rounded px-2 py-1 text-xs border border-slate-500" /></label>
          <label className="text-[10px] text-slate-400">Cao (m)<input type="number" min="0.5" step="0.1" value={visual3d.heightMeters} onChange={event => updateVisual3d({ heightMeters: Math.max(0.5, Number(event.target.value) || 0.5) })} className="mt-1 w-full bg-slate-600 text-white rounded px-2 py-1 text-xs border border-slate-500" /></label>
          <label className="text-[10px] text-slate-400">Xoay (°)<input type="number" step="15" value={visual3d.rotationDegrees} onChange={event => updateVisual3d({ rotationDegrees: Number(event.target.value) || 0 })} className="mt-1 w-full bg-slate-600 text-white rounded px-2 py-1 text-xs border border-slate-500" /></label>
        </div>
        <label className="flex items-center justify-between text-[10px] text-slate-400">Màu khối<input type="color" value={visual3d.color} onChange={event => updateVisual3d({ color: event.target.value })} className="h-7 w-12 rounded border border-slate-500 bg-slate-600 p-0.5" /></label>
      </div>

      {stairwell && (
        <div className="rounded-lg border border-orange-500/40 bg-orange-950/30 p-3 text-xs">
          <div className="font-semibold text-orange-200">Lõi cầu thang</div>
          <div className="mt-1 text-orange-100/80">{stairwell.id} · tầng {stairwell.areaIds.map(id => allAreas.find(item => item.id === id)?.floor).filter(Boolean).sort((a, b) => a - b).join(', ')}</div>
          <p className="mt-2 text-orange-200/70">Vị trí, rộng, sâu và góc xoay được dùng chung cho mọi tầng trong lõi này.</p>
          <label className="mt-3 block text-orange-100/90">Cổng vào cầu thang
            <select value={landingSide} onChange={(event) => onUpdateLanding?.(stairwell.id, area.id, event.target.value)} className="mt-1 w-full rounded border border-orange-400/40 bg-slate-800 px-2 py-1 text-xs text-white">
              <option value="auto">Tự nhận diện từ hành lang</option><option value="front">Trước</option><option value="right">Phải</option><option value="back">Sau</option><option value="left">Trái</option>
            </select>
          </label>
          {sameFloorCorridors.length === 0 && <p className="mt-2 text-amber-200">Chưa có hành lang cùng tầng để tự nhận diện cổng. Chọn cạnh thủ công trước khi dựng cầu thang.</p>}
        </div>
      )}

      {/* Meta */}
      {/* Meta */}
      <div className="pt-1 border-t border-slate-600 text-xs text-slate-500 space-y-0.5">
        <div>Tầng: {area.floor}</div>
        <div>Tọa độ: ({Math.round(area.x)}, {Math.round(area.y)})</div>
      </div>

      {/* Connections List */}
      {allAreas && (
        <div className="pt-3 border-t border-slate-600">
          <label className="block text-slate-400 text-xs mb-2 font-medium">🔗 KẾT NỐI (HÀNH LANG)</label>
          <div className="space-y-1.5 max-h-48 overflow-y-auto bg-slate-800/50 p-2 rounded-lg border border-slate-600">
            {availableConnections.map(c => {
              const connected = isConnected(c.id);
              const isCrossFloor = c.floor !== area.floor;
              return (
                <label key={c.id} className="flex items-center space-x-2 text-sm cursor-pointer hover:bg-slate-700 p-1.5 rounded transition-colors">
                  <input 
                    type="checkbox" 
                    checked={connected}
                    onChange={() => onToggleCorridor && onToggleCorridor(area.id, c.id)}
                    className="rounded text-blue-500 focus:ring-blue-500 bg-slate-700 border-slate-500 w-4 h-4"
                  />
                  <span className={`truncate flex-1 ${isCrossFloor ? "text-orange-400 font-semibold" : "text-slate-200"}`}>
                    {c.name} {isCrossFloor && `(▲▼ Tầng ${c.floor})`}
                  </span>
                </label>
              );
            })}
            {availableConnections.length === 0 && (
              <div className="text-xs text-slate-500 text-center py-2">Không có khu vực nào hợp lệ để kết nối.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
