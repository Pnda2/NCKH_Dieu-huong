import React from 'react';

const DIRECTIONS = [
  ['LEFT', '← Trái'],
  ['RIGHT', '→ Phải'],
  ['STRAIGHT', '↑ Thẳng'],
  ['BACK', '↓ Quay lại'],
  ['UP', '▲ Lên tầng'],
  ['DOWN', '▼ Xuống tầng'],
];

const STATUS_STYLE = {
  online: 'bg-green-900/60 text-green-300',
  waiting_ack: 'bg-yellow-900/60 text-yellow-300',
  offline: 'bg-red-900/60 text-red-300',
  idle: 'bg-slate-600 text-slate-300',
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
    <div className="pt-4 border-t border-slate-600 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-slate-300 text-xs font-bold uppercase">Thiết bị điều hướng</div>
        <div className="flex gap-1">
          <button onClick={() => onAdd('sign', area.id)}
            className="px-2 py-1 text-xs rounded bg-cyan-700 hover:bg-cyan-600 text-white">
            + Bảng hiệu
          </button>
          <button onClick={() => onAdd('speaker', area.id)}
            className="px-2 py-1 text-xs rounded bg-violet-700 hover:bg-violet-600 text-white">
            + Loa
          </button>
        </div>
      </div>

      {areaDevices.length === 0 && (
        <p className="text-xs text-slate-500">Chưa gắn thiết bị tại nút này.</p>
      )}

      {areaDevices.map(device => {
        const live = guidanceDevices.find(item => item.id === device.id);
        const status = live?.status || 'idle';
        return (
          <div key={device.id} className="bg-slate-800/60 rounded-lg p-3 space-y-2 border border-slate-600">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">{device.type === 'sign' ? '🚦' : '🔊'}</span>
              <input
                value={device.name || ''}
                onChange={event => onUpdate({ ...device, name: event.target.value })}
                className="flex-1 min-w-0 bg-slate-700 text-white rounded px-2 py-1 text-xs border border-slate-600"
              />
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLE[status] || STATUS_STYLE.idle}`}>
                {status}
              </span>
              <button onClick={() => onDelete(device.id)} className="text-red-400 hover:text-red-300">×</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-400">
                Góc chuẩn (0° = Bắc)
                <input type="number" min="0" max="359"
                  value={device.orientation ?? 0}
                  onChange={event => onUpdate({ ...device, orientation: Number(event.target.value) || 0 })}
                  className="mt-1 w-full bg-slate-700 text-white rounded px-2 py-1 text-xs border border-slate-600"
                />
              </label>
              <label className="text-[10px] text-slate-400">
                MQTT topic (tùy chọn)
                <input value={device.topic || ''}
                  onChange={event => onUpdate({ ...device, topic: event.target.value })}
                  placeholder="Tự động"
                  className="mt-1 w-full bg-slate-700 text-white rounded px-2 py-1 text-xs border border-slate-600"
                />
              </label>
            </div>

            {device.type === 'sign' && connectedCorridors.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] uppercase text-slate-500 font-bold">Ánh xạ hướng vật lý</div>
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
                      className="bg-slate-700 text-white rounded px-1.5 py-1 text-xs border border-slate-600"
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
              <div className="text-[10px] text-cyan-300 bg-cyan-950/30 rounded p-1.5">
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
