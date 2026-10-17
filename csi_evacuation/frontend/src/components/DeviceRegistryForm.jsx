import React from 'react';

const DIRECTIONS = [
  ['LEFT', '← Trái (LEFT)'],
  ['RIGHT', '→ Phải (RIGHT)'],
  ['STRAIGHT', '↑ Thẳng (STRAIGHT)'],
  ['BACK', '↓ Quay lại (BACK)'],
  ['UP', '▲ Lên tầng (UP)'],
  ['DOWN', '▼ Xuống tầng (DOWN)'],
];

const STATUS_STYLE = {
  online: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  waiting_ack: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  offline: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  idle: 'bg-slate-800 text-slate-400 border-slate-700',
};

export default function DeviceRegistryForm({
  area,
  corridors,
  areas,
  devices,
  guidanceDevices,
  onAdd,
  onUpdate,
  onDelete,
}) {
  const areaDevices = devices.filter(device => device.area_id === area.id);
  const connectedCorridors = corridors.filter(
    corridor => corridor.areaA_id === area.id || corridor.areaB_id === area.id
  );

  const otherAreaName = (corridor) => {
    const otherId = corridor.areaA_id === area.id
      ? corridor.areaB_id
      : corridor.areaA_id;
    return areas.find(item => item.id === otherId)?.name || otherId;
  };

  return (
    <div className="bg-slate-900/60 rounded-xl border border-slate-800/80 p-3.5 space-y-3 shadow-sm backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-white text-xs font-bold uppercase tracking-wider">
            Thiết bị gắn tại phòng ({areaDevices.length})
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Bảng LED và Loa chỉ hướng đặt ngay tại vị trí này
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onAdd('sign', area.id)}
            className="px-2 py-1 text-xs rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-300 transition-colors flex items-center gap-1 font-mono font-semibold cursor-pointer shadow-sm"
          >
            + BẢNG LED
          </button>
          <button
            type="button"
            onClick={() => onAdd('speaker', area.id)}
            className="px-2 py-1 text-xs rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-300 transition-colors flex items-center gap-1 font-mono font-semibold cursor-pointer shadow-sm"
          >
            + LOA
          </button>
        </div>
      </div>

      {areaDevices.length === 0 && (
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
          <p className="text-xs text-slate-500 italic">
            Chưa gán thiết bị nào tại đây.
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            (Tùy chọn: chỉ thêm nếu bạn có lắp đặt Bảng hiệu LED hoặc Loa thông minh thực tế tại phòng này)
          </p>
        </div>
      )}

      {areaDevices.map(device => {
        const live = guidanceDevices.find(item => item.id === device.id);
        const status = live?.status || 'idle';
        return (
          <div key={device.id} className="bg-slate-950/70 rounded-xl p-3 space-y-2.5 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {device.type === 'sign' ? (
                  <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M8 12h8M12 8l4 4-4 4" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
                <span className="font-mono text-[10px] uppercase font-bold text-slate-300">
                  {device.type === 'sign' ? 'BẢNG LED' : 'LOA'}
                </span>
              </div>
              <input
                value={device.name || ''}
                onChange={event => onUpdate({ ...device, name: event.target.value })}
                className="flex-1 min-w-0 bg-slate-900 text-white rounded-lg px-2.5 py-1 text-xs border border-slate-700 focus:border-cyan-500 focus:outline-none placeholder:text-slate-600"
                placeholder="Tên thiết bị..."
              />
              <span className={`font-mono text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-wider ${STATUS_STYLE[status] || STATUS_STYLE.idle}`}>
                {status}
              </span>
              <button
                onClick={() => onDelete(device.id)}
                className="text-slate-500 hover:text-rose-400 text-xs p-1"
                title="Xóa thiết bị"
              >
                ✕
              </button>
            </div>

            {device.type === 'sign' && connectedCorridors.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase text-cyan-400 font-bold tracking-wider">
                    Hướng mũi tên chỉ dẫn trên đèn LED:
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">Dễ hiểu</span>
                </div>
                <div className="space-y-1.5">
                  {connectedCorridors.map(corridor => (
                    <div key={corridor.id} className="p-2 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                      <div className="text-xs text-slate-300">
                        Khi hệ thống bảo đi về phía: <strong className="text-cyan-300">{otherAreaName(corridor)}</strong>
                      </div>
                      <select
                        value={device.edgeDirections?.[corridor.id] || 'STRAIGHT'}
                        onChange={event => onUpdate({
                          ...device,
                          edgeDirections: {
                            ...(device.edgeDirections || {}),
                            [corridor.id]: event.target.value,
                          },
                        })}
                        className="w-full bg-slate-950 text-white rounded-lg px-2.5 py-1.5 text-xs font-mono border border-slate-700 focus:border-cyan-500 focus:outline-none cursor-pointer"
                      >
                        {DIRECTIONS.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cài đặt kỹ thuật (Thu gọn để tránh rối mắt người mới) */}
            <details className="pt-1.5 border-t border-slate-800/80 group">
              <summary className="text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer flex items-center justify-between select-none py-0.5 font-mono">
                <span>⚙️ Cài đặt kỹ thuật (Góc & MQTT Topic)</span>
                <span className="text-[9px] group-open:rotate-90 transition-transform">▶</span>
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-2 pt-1 font-mono text-[10px]">
                <label className="text-slate-400">
                  GÓC CHUẨN (0° = BẮC)
                  <input
                    type="number"
                    min="0"
                    max="359"
                    value={device.orientation ?? 0}
                    onChange={event => onUpdate({ ...device, orientation: Number(event.target.value) || 0 })}
                    className="mt-0.5 w-full bg-slate-900 text-white rounded px-2 py-1 text-xs border border-slate-700 focus:border-cyan-500 focus:outline-none"
                  />
                </label>
                <label className="text-slate-400">
                  MQTT TOPIC
                  <input
                    value={device.topic || ''}
                    onChange={event => onUpdate({ ...device, topic: event.target.value })}
                    placeholder="Tự động"
                    className="mt-0.5 w-full bg-slate-900 text-white rounded px-2 py-1 text-xs border border-slate-700 focus:border-cyan-500 focus:outline-none"
                  />
                </label>
              </div>
            </details>

            {live?.last_command && (
              <div className="text-[10px] font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-800/50 rounded-lg p-2">
                Lệnh: {live.last_command.command}
                {live.last_command.target_edge ? ` → ${live.last_command.target_edge}` : ''}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
