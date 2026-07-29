import React, { useState, useEffect } from 'react';

const TYPE_OPTIONS = [
  { value: 'room',   label: 'Phòng / Khu vực',      icon: '🏠', ring: 'ring-blue-500',   active: 'bg-blue-600 text-white', inactive: 'bg-slate-600 text-slate-300 hover:bg-slate-500' },
  { value: 'stairs', label: 'Cầu thang',             icon: '🪜', ring: 'ring-orange-500', active: 'bg-orange-600 text-white', inactive: 'bg-slate-600 text-slate-300 hover:bg-slate-500' },
  { value: 'exit',   label: 'Lối thoát khẩn cấp',   icon: '🚪', ring: 'ring-green-500',  active: 'bg-green-600 text-white', inactive: 'bg-slate-600 text-slate-300 hover:bg-slate-500' },
];

export default function AreaForm({ area, allAreas, corridors, onToggleCorridor, onChange, onDelete }) {
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
    onChange({ ...area, type });
  };

  const opt = TYPE_OPTIONS.find(o => o.value === area.type) || TYPE_OPTIONS[0];

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
