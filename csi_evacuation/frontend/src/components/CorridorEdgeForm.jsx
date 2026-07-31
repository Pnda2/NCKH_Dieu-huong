import React, { useState, useEffect } from 'react';

const AREA_DOT_COLOR = { room: 'bg-blue-500', stairs: 'bg-orange-500', exit: 'bg-green-500' };

export default function CorridorEdgeForm({ corridor, areas, onChange, onDelete }) {
  const [name, setName] = useState(corridor.name || '');
  const [length, setLength] = useState(corridor.length || 10);
  const [widthMeters, setWidthMeters] = useState(corridor.widthMeters || 1.2);
  const [capacityPeople, setCapacityPeople] = useState(corridor.capacityPeople ?? Math.round((corridor.length || 10) * (corridor.widthMeters || 1.2) * 2));
  const [flowCapacity, setFlowCapacity] = useState(corridor.flowCapacity ?? '');
  const [initialOccupancy, setInitialOccupancy] = useState(corridor.initialOccupancy ?? 0.5);

  useEffect(() => {
    setName(corridor.name || '');
    setLength(corridor.length || 10);
    setWidthMeters(corridor.widthMeters || 1.2);
    setCapacityPeople(corridor.capacityPeople ?? Math.round((corridor.length || 10) * (corridor.widthMeters || 1.2) * 2));
    setFlowCapacity(corridor.flowCapacity ?? '');
    setInitialOccupancy(corridor.initialOccupancy ?? 0.5);
  }, [corridor.id, corridor.name, corridor.length, corridor.widthMeters, corridor.capacityPeople, corridor.flowCapacity, corridor.initialOccupancy]);

  const areaA = areas.find(a => a.id === corridor.areaA_id);
  const areaB = areas.find(a => a.id === corridor.areaB_id);

  const handleNameChange = (e) => {
    setName(e.target.value);
    onChange({ ...corridor, name: e.target.value });
  };

  const handleLengthChange = (e) => {
    const val = Math.max(1, Number(e.target.value));
    setLength(val);
    onChange({ ...corridor, length: val });
  };

  const handleInitialOccupancyChange = (e) => {
    const value = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100;
    setInitialOccupancy(value);
    onChange({ ...corridor, initialOccupancy: value });
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

  return (
    <div className="bg-slate-700 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-1.5 bg-slate-400 rounded-full"></div>
          <span className="text-white text-sm font-semibold">Hành lang</span>
        </div>
        <button
          onClick={onDelete}
          className="text-red-400 hover:text-red-300 text-xs font-medium px-2 py-1 bg-red-900/30 hover:bg-red-900/50 rounded-lg transition-colors"
        >🗑️ Xóa</button>
      </div>

      {/* Connection display */}
      <div className="bg-slate-600/70 rounded-xl p-3">
        <div className="text-xs text-slate-400 mb-2 font-semibold uppercase tracking-wide">Kết nối</div>
        <div className="flex items-center gap-2 text-sm">
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${AREA_DOT_COLOR[areaA?.type || 'room']}`}></div>
          <span className="text-white font-medium truncate flex-1">{areaA?.name || '?'}</span>
          <span className="text-slate-400 text-xs font-bold">↔</span>
          <span className="text-white font-medium truncate flex-1 text-right">{areaB?.name || '?'}</span>
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${AREA_DOT_COLOR[areaB?.type || 'room']}`}></div>
        </div>
        {areaA?.floor !== areaB?.floor && (
          <div className="mt-2 text-xs text-orange-400 font-semibold text-center">
            ▲▼ Kết nối liên tầng (Tầng {areaA?.floor} ↔ Tầng {areaB?.floor})
          </div>
        )}
      </div>

      {/* Name */}
      <div>
        <label className="block text-slate-400 text-xs mb-1.5 font-medium">Tên hành lang</label>
        <input
          type="text"
          value={name}
          onChange={handleNameChange}
          className="w-full bg-slate-600 text-white rounded-lg px-3 py-2 text-sm border border-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
          placeholder="Nhập tên hành lang..."
        />
      </div>

      <div>
        <label className="block text-slate-400 text-xs mb-1.5 font-medium">Khả năng thông hành (tải ước lượng/giây)</label>
        <input type="number" min="0.01" step="0.1" value={flowCapacity} onChange={handleFlowCapacityChange}
          placeholder="Tự ước lượng từ chiều rộng" className="w-full bg-slate-600 text-white rounded-lg px-3 py-2 text-sm border border-slate-500 focus:border-blue-500 focus:outline-none" />
        <p className="text-xs text-slate-500 mt-1">Để trống để mô phỏng ước lượng từ chiều rộng; đây không phải số người đếm chính xác.</p>
      </div>

      {/* Length */}
      <div>
        <label className="block text-slate-400 text-xs mb-1.5 font-medium">Chiều dài (m)</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="1"
            max="200"
            value={length}
            onChange={handleLengthChange}
            className="flex-1 accent-blue-500"
          />
          <input
            type="number"
            value={length}
            onChange={handleLengthChange}
            min="1"
            className="w-16 bg-slate-600 text-white rounded-lg px-2 py-1.5 text-sm border border-slate-500 focus:border-blue-500 focus:outline-none text-center"
          />
          <span className="text-slate-400 text-xs">m</span>
        </div>
      </div>

      {/* Usable width */}
      <div>
        <label className="block text-slate-400 text-xs mb-1.5 font-medium">
          Độ rộng hữu dụng (m)
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={widthMeters}
            onChange={handleWidthChange}
            min="0.1"
            step="0.1"
            className="flex-1 bg-slate-600 text-white rounded-lg px-3 py-2 text-sm border border-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <span className="text-slate-400 text-xs">m</span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Nhập độ rộng tại đoạn hẹp nhất của hành lang.
        </p>
        {corridor.widthEstimated && (
          <p className="text-xs text-amber-400 mt-1">
            ⚠ Đang dùng mặc định 1,2 m. Hãy nhập và xác nhận độ rộng thực tế.
          </p>
        )}
      </div>

      {/* t0 derived info */}
      {/* t0 derived info */}
      <div>
        <label className="block text-slate-400 text-xs mb-1.5 font-medium">Sức chứa tối đa Cmax (người)</label>
        <input
          type="number"
          min="1"
          value={capacityPeople}
          onChange={handleCapacityChange}
          className="w-full bg-slate-600 text-white rounded-lg px-3 py-2 text-sm border border-slate-500 focus:border-blue-500 focus:outline-none"
        />
        <p className="text-xs text-slate-500 mt-1">Cmax ≤ 0 khiến hành lang không hợp lệ và bị loại khỏi D* Lite.</p>
      </div>

      <div>
        <label className="block text-slate-400 text-xs mb-1.5 font-medium">Độ lấp đầy hành lang ban đầu k(e) (%)</label>
        <input
          type="number"
          min="0"
          max="100"
          value={Math.round(initialOccupancy * 100)}
          onChange={handleInitialOccupancyChange}
          className="w-full bg-slate-600 text-white rounded-lg px-3 py-2 text-sm border border-slate-500 focus:border-blue-500 focus:outline-none"
        />
        <p className="text-xs text-slate-500 mt-1">k(e) = 0: hành lang trống; k(e) = 1: lấp đầy hoàn toàn.</p>
      </div>

      {/* t0 derived info */}
      <div className="bg-slate-600/50 rounded-lg p-2.5 text-xs text-slate-400 space-y-1">
        <div className="font-medium text-slate-300">Thông số trọng số động</div>
        <div>t₀ = {(length / 1.2).toFixed(2)}s <span className="text-slate-500">(v = 1.2 m/s)</span></div>
        <div>R(e) = {widthMeters.toFixed(2)} × [1 − k(e)]</div>
        <div>w(e) = t₀[1 + 1.5k(e)⁴] + H(e)</div>
        <div className="text-slate-500">k(e): độ lấp đầy do cặp node CSI trên hành lang đo được.</div>
        <div className="text-xs text-slate-500">ID: {corridor.id}</div>
      </div>
    </div>
  );
}
