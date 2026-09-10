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
  online: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
  waiting_ack: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
  offline: 'bg-rose-950/60 text-rose-300 border-rose-800/60',
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
    <div className="pt-3 border-t border-slate-800 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="text-slate-300 text-[10px] font-bold uppercase tracking-wider">
          Thiết bị điều phối tại chỗ
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => onAdd('sign', area.id)}
            className="px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 transition-colors flex items-center gap-1 font-mono"
          >
            + BẢNG HIỆU
          </button>
          <button
            onClick={() => onAdd('speaker', area.id)}
            className="px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-violet-300 transition-colors flex items-center gap-1 font-mono"
          >
            + LOA
          </button>
        </div>
      </div>

      {areaDevices.length === 0 && (
        <p className="text-[10px] text-slate-500 font-mono py-1">Chưa gán thiết bị IoT điều hướng tại nút này.</p>
      )}

      {areaDevices.map(device => {
        const live = guidanceDevices.find(item => item.id === device.id);
        const status = live?.status || 'idle';
        return (
          <div key={device.id} className="bg-slate-950/60 rounded p-2.5 space-y-2 border border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {device.type === 'sign' ? (
                  <svg className="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M8 12h8M12 8l4 4-4 4" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
                <span className="font-mono text-[9px] uppercase font-bold text-slate-400">
                  {device.type === 'sign' ? 'SIGN' : 'SPKR'}
                </span>
              </div>
              <input
                value={device.name || ''}
                onChange={event => onUpdate({ ...device, name: event.target.value })}
                className="flex-1 min-w-0 bg-slate-800 text-white rounded px-2 py-1 text-xs font-mono border border-slate-700 focus:border-blue-500 focus:outline-none"
              />
              <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wider ${STATUS_STYLE[status] || STATUS_STYLE.idle}`}>
                {status}
              </span>
              <button
                onClick={() => onDelete(device.id)}
                className="text-slate-500 hover:text-red-400 text-xs px-1"
                title="Xóa thiết bị"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                Góc chuẩn (0° = Bắc)
                <input
                  type="number"
                  min="0"
                  max="359"
                  value={device.orientation ?? 0}
                  onChange={event => onUpdate({ ...device, orientation: Number(event.target.value) || 0 })}
                  className="mt-0.5 w-full bg-slate-800 text-white rounded px-2 py-1 text-xs font-mono border border-slate-700 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                MQTT topic
                <input
                  value={device.topic || ''}
                  onChange={event => onUpdate({ ...device, topic: event.target.value })}
                  placeholder="Tự động"
                  className="mt-0.5 w-full bg-slate-800 text-white rounded px-2 py-1 text-xs font-mono border border-slate-700 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>

            {device.type === 'sign' && connectedCorridors.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-slate-800/80">
                <div className="text-[9px] uppercase text-slate-400 font-bold tracking-wider">Ánh xạ hướng vật lý</div>
                {connectedCorridors.map(corridor => (
                  <div key={corridor.id} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-xs text-slate-300" title={corridor.name}>
                      → {otherAreaName(corridor)}
                    </span>
                    <select
                      value={device.edgeDirections?.[corridor.id] || 'STRAIGHT'}
                      onChange={event => onUpdate({
                        ...device,
                        edgeDirections: {
                          ...(device.edgeDirections || {}),
                          [corridor.id]: event.target.value,
                        },
                      })}
                      className="bg-slate-800 text-white rounded px-1.5 py-1 text-xs font-mono border border-slate-700 focus:border-blue-500 focus:outline-none"
                    >
                      {DIRECTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {live?.last_command && (
              <div className="text-[10px] font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-800/50 rounded p-1.5">
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

