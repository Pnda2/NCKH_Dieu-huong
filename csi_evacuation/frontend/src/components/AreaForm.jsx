import React, { useState, useEffect } from 'react';
import { visualForArea } from './scene3d';

const TYPE_OPTIONS = [
  {
    value: 'room',
    label: 'Phòng / Khu vực',
    desc: 'Phòng làm việc, phòng học hoặc sảnh sinh hoạt cần thoát nạn',
    badge: 'ROOM',
    active: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/40 shadow-sm shadow-cyan-950',
    inactive: 'bg-slate-900/60 text-slate-300 hover:bg-slate-800/60 border-slate-800/80',
  },
  {
    value: 'stairs',
    label: 'Cầu thang bộ',
    desc: 'Lối thang bộ di chuyển lên/xuống giữa các tầng nhà',
    badge: 'STAIR',
    active: 'bg-amber-500/10 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-950',
    inactive: 'bg-slate-900/60 text-slate-300 hover:bg-slate-800/60 border-slate-800/80',
  },
  {
    value: 'exit',
    label: 'Lối thoát hiểm an toàn',
    desc: 'Cửa dẫn trực tiếp ra nơi an toàn bên ngoài tòa nhà',
    badge: 'EXIT',
    active: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-950',
    inactive: 'bg-slate-900/60 text-slate-300 hover:bg-slate-800/60 border-slate-800/80',
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
  const [activeTab, setActiveTab] = useState('basic'); // 'basic' | 'advanced'

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
  const connectedCorridors = (corridors || []).filter(
    (c) => c.areaA_id === area.id || c.areaB_id === area.id
  );
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
    <div className="bg-slate-900/60 rounded-xl border border-slate-800/80 p-3.5 space-y-3.5 text-slate-200 shadow-sm backdrop-blur-sm">
      {/* ─── 1. Header ─── */}
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-white text-sm font-bold truncate">
              {area.name || 'Khu vực chưa đặt tên'}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-slate-800 text-cyan-300 border border-slate-700">
              Tầng {area.floor || 1}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {area.type === 'exit' ? 'Cửa thoát nạn an toàn' : area.type === 'stairs' ? 'Cầu thang chuyển tầng' : 'Không gian / Phòng'}
          </div>
        </div>
        <button
          onClick={onDelete}
          className="text-rose-400 hover:text-rose-300 text-xs font-semibold px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg transition-colors flex-shrink-0"
          title="Xóa khu vực này"
        >
          Xóa
        </button>
      </div>

      {/* ─── 2. Segmented Mode Switcher (Cơ bản vs Nâng cao) ─── */}
      <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('basic')}
          className={`flex-1 py-1 rounded-md font-medium text-xs transition-all flex items-center justify-center ${
            activeTab === 'basic'
              ? 'bg-slate-800 text-cyan-400 font-semibold border border-cyan-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Cơ bản
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('advanced')}
          className={`flex-1 py-1 rounded-md font-medium text-xs transition-all flex items-center justify-center ${
            activeTab === 'advanced'
              ? 'bg-slate-800 text-cyan-400 font-semibold border border-cyan-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Nâng cao
        </button>
      </div>

      {/* ─── 3. Tab CƠ BẢN (Dành cho người mới) ─── */}
      {activeTab === 'basic' && (
        <div className="space-y-3.5">
          {/* Tên khu vực */}
          <div className="space-y-1">
            <label className="block text-slate-300 text-xs font-semibold">
              Tên phòng / Khu vực
            </label>
            <input
              type="text"
              value={name}
              onChange={handleNameChange}
              className="w-full bg-slate-900/90 text-white rounded-lg px-3 py-2 text-xs border border-slate-700/80 focus:border-cyan-500 focus:outline-none transition-colors placeholder:text-slate-500 shadow-inner"
              placeholder="VD: Phòng họp 101, Cửa thoát hiểm số 1..."
            />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Tên này sẽ hiển thị trên sơ đồ và được đọc trong các bản tin phát thanh hướng dẫn thoát nạn.
            </p>
          </div>

          {/* Loại khu vực */}
          <div className="space-y-1.5">
            <label className="block text-slate-300 text-xs font-semibold">
              Mục đích sử dụng của khu vực này:
            </label>
            <div className="space-y-1.5">
              {TYPE_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => handleTypeChange(o.value)}
                  className={`w-full p-2.5 rounded-xl border text-left transition-all ${
                    area.type === o.value ? o.active : o.inactive
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">{o.label}</span>
                    {area.type === o.value && (
                      <span className="text-xs font-bold text-cyan-400">Đang chọn</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    {o.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Danh sách hành lang kết nối trực quan */}
          <div className="pt-2 border-t border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">Đường đi kết nối:</span>
              <span className="font-mono text-cyan-400 text-xs font-bold">
                {connectedCorridors.length} hành lang
              </span>
            </div>
            {connectedCorridors.length === 0 ? (
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center space-y-1.5">
                <p className="text-xs text-amber-300 font-medium">Chưa có hành lang nào nối vào phòng này</p>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Cách tạo đường đi: Chọn công cụ <strong>+ Hành lang</strong> trên thanh công cụ, nhấp vào phòng này rồi nhấp sang phòng cần nối.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
                {connectedCorridors.map(c => {
                  const otherId = c.areaA_id === area.id ? c.areaB_id : c.areaA_id;
                  const otherArea = allAreas.find(item => item.id === otherId);
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between bg-slate-950/60 border border-slate-800/80 px-2.5 py-1.5 rounded-lg text-xs"
                    >
                      <span className="truncate text-slate-300">
                        Nối với <strong>{otherArea?.name || otherId}</strong>
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 ml-2">
                        {c.length || 10}m
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── 4. Tab NÂNG CAO (Dành cho kỹ thuật viên & 3D) ─── */}
      {activeTab === 'advanced' && (
        <div className="space-y-3.5">
          {/* Vai trò hiển thị: Junction vs Room */}
          {area.type === 'room' && (
            <div className="space-y-1.5">
              <label className="block text-slate-400 text-[11px] uppercase font-bold tracking-wider">
                Hình thức hiển thị trên bản đồ 2D/3D
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleVisualKindChange('room')}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-all ${
                    area.visualKind !== 'junction'
                      ? 'bg-slate-800 text-cyan-400 border-cyan-500/40 shadow-sm'
                      : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  Phòng tiêu chuẩn
                </button>
                <button
                  type="button"
                  onClick={() => handleVisualKindChange('junction')}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-all ${
                    area.visualKind === 'junction'
                      ? 'bg-slate-800 text-cyan-400 border-cyan-500/40 shadow-sm'
                      : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  Nút giao hành lang
                </button>
              </div>
              <p className="text-[10px] text-slate-400 leading-normal">
                Nút giao chỉ đổi hình thức hiển thị bo mượt trên bản đồ; thuật toán định tuyến D* Lite vẫn xử lý như một node mạng lưới.
              </p>
            </div>
          )}

          {junctionSuggestion && (
            <button
              type="button"
              onClick={() => handleVisualKindChange('junction')}
              className="w-full rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-2.5 text-left text-xs text-cyan-200 hover:bg-cyan-900/30 transition-colors"
            >
              Gợi ý: Nút này có {sameFloorCorridors.length} hành lang kết nối. Nhấp vào đây để đổi sang kiểu nút giao giúp các nhánh nối thẩm mỹ hơn.
            </button>
          )}

          {/* Kích thước khối 3D */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-slate-400 text-[11px] uppercase font-bold tracking-wider font-mono">
                Kích thước 3D thực tế
              </label>
              {visual3d.sizeMode === 'auto' && (
                <span className="text-[10px] text-cyan-400 font-mono">Tự động cân chỉnh</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono">
              <label className="text-xs text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                <span className="block text-[10px] text-slate-500 mb-0.5">Chiều rộng, m</span>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={visual3d.widthMeters}
                  onChange={event => updateVisual3d({ widthMeters: Math.max(0.5, Number(event.target.value) || 0.5) })}
                  className="w-full bg-slate-900 text-white rounded px-2 py-1 text-xs border border-slate-700 focus:border-cyan-500 focus:outline-none"
                />
              </label>
              <label className="text-xs text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                <span className="block text-[10px] text-slate-500 mb-0.5">Chiều sâu, m</span>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={visual3d.depthMeters}
                  onChange={event => updateVisual3d({ depthMeters: Math.max(0.5, Number(event.target.value) || 0.5) })}
                  className="w-full bg-slate-900 text-white rounded px-2 py-1 text-xs border border-slate-700 focus:border-cyan-500 focus:outline-none"
                />
              </label>
              <label className="text-xs text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                <span className="block text-[10px] text-slate-500 mb-0.5">Chiều cao, m</span>
                <input
                  type="number"
                  min="0.5"
                  step="0.1"
                  value={visual3d.heightMeters}
                  onChange={event => updateVisual3d({ heightMeters: Math.max(0.5, Number(event.target.value) || 0.5) })}
                  className="w-full bg-slate-900 text-white rounded px-2 py-1 text-xs border border-slate-700 focus:border-cyan-500 focus:outline-none"
                />
              </label>
              <label className="text-xs text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                <span className="block text-[10px] text-slate-500 mb-0.5">Góc xoay, độ</span>
                <input
                  type="number"
                  step="15"
                  value={visual3d.rotationDegrees}
                  onChange={event => updateVisual3d({ rotationDegrees: Number(event.target.value) || 0 })}
                  className="w-full bg-slate-900 text-white rounded px-2 py-1 text-xs border border-slate-700 focus:border-cyan-500 focus:outline-none"
                />
              </label>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
              <span>Màu sắc hiển thị khối 3D</span>
              <input
                type="color"
                value={visual3d.color}
                onChange={event => updateVisual3d({ color: event.target.value })}
                className="h-7 w-12 rounded border border-slate-700 bg-slate-800 p-0.5 cursor-pointer"
              />
            </div>
          </div>

          {/* Lõi thang bộ liên tầng */}
          {stairwell && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3 text-xs space-y-2">
              <div className="font-semibold text-amber-200 flex items-center justify-between">
                <span>Lõi cầu thang bộ liên tầng</span>
                <span className="font-mono text-[10px] text-amber-300">ID: {stairwell.id}</span>
              </div>
              <div className="text-[11px] text-amber-100/80">
                Đang thông suốt các tầng: {stairwell.areaIds.map(id => allAreas.find(item => item.id === id)?.floor).filter(Boolean).sort((a, b) => a - b).join(', ')}
              </div>
              <label className="block text-amber-100/90 text-[10px] uppercase font-bold tracking-wider pt-1">
                Cổng tiếp cận cầu thang
                <select
                  value={landingSide}
                  onChange={(event) => onUpdateLanding?.(stairwell.id, area.id, event.target.value)}
                  className="mt-1 w-full rounded-lg border border-amber-400/40 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                >
                  <option value="auto">Tự động theo hướng hành lang nối</option>
                  <option value="front">Mặt trước</option>
                  <option value="right">Mặt phải</option>
                  <option value="back">Mặt sau</option>
                  <option value="left">Mặt trái</option>
                </select>
              </label>
            </div>
          )}

          {/* Kết nối thủ công qua checkbox */}
          {allAreas && (
            <div className="pt-2 border-t border-slate-800 space-y-1.5">
              <label className="block text-slate-400 text-[11px] uppercase font-bold tracking-wider font-mono">
                Liên kết hành lang thủ công
              </label>
              <div className="space-y-1 max-h-36 overflow-y-auto bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                {availableConnections.map(c => {
                  const connected = isConnected(c.id);
                  const isCrossFloor = c.floor !== area.floor;
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center space-x-2 text-xs p-1.5 rounded-lg cursor-pointer transition-colors ${
                        connected ? 'bg-slate-800/80 text-white font-medium' : 'hover:bg-slate-900 text-slate-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={connected}
                        onChange={() => onToggleCorridor && onToggleCorridor(area.id, c.id)}
                        className="rounded text-cyan-500 focus:ring-0 bg-slate-900 border-slate-700 w-3.5 h-3.5"
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
              </div>
            </div>
          )}

          {/* Thông tin kỹ thuật & Tọa độ */}
          <div className="pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-500 flex justify-between">
            <span>NODE ID: {area.id}</span>
            <span>TỌA ĐỘ: {Math.round(area.x)}, {Math.round(area.y)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
