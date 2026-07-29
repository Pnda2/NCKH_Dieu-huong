import React, { useState, useEffect } from 'react';

export default function CorridorForm({ selectedCorridor, onChange, onDelete, allCorridors }) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'corridor',
    length: 10,
    connections: []
  });

  useEffect(() => {
    if (selectedCorridor) {
      setFormData({
        name: selectedCorridor.name || '',
        type: selectedCorridor.type || 'corridor',
        length: selectedCorridor.length || 10,
        connections: selectedCorridor.connections || []
      });
    }
  }, [selectedCorridor]);

  if (!selectedCorridor) {
    return (
      <div className="p-4 bg-white shadow rounded border text-gray-500">
        Click vào một khu vực trên bản đồ để chỉnh sửa.
      </div>
    );
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    const newData = { ...formData, [name]: name === 'name' || name === 'type' ? value : Number(value) };
    
    // Nếu đổi type từ stairs về corridor, phải xóa các kết nối tới các tầng khác
    if (name === 'type' && value === 'corridor') {
      const validConnections = newData.connections.filter(id => {
        const target = allCorridors.find(c => c.id === id);
        return target && target.floor === selectedCorridor.floor;
      });
      newData.connections = validConnections;
    }
    
    setFormData(newData);
    onChange({ ...selectedCorridor, ...newData });
  };

  const handleConnectionToggle = (targetId) => {
    let newConnections = [...formData.connections];
    if (newConnections.includes(targetId)) {
      newConnections = newConnections.filter(id => id !== targetId);
    } else {
      newConnections.push(targetId);
    }
    const newData = { ...formData, connections: newConnections };
    setFormData(newData);
    onChange({ ...selectedCorridor, ...newData });
  };

  // Logic lọc kết nối thông minh
  const availableConnections = allCorridors.filter(c => {
    if (c.id === selectedCorridor.id) return false;
    
    const isSameFloor = (c.floor || 1) === (selectedCorridor.floor || 1);
    const isAdjacentFloor = Math.abs((c.floor || 1) - (selectedCorridor.floor || 1)) === 1;
    
    if (formData.type === 'corridor') {
      // Hành lang chỉ nối với các Node (Hành lang/Cầu thang) ở CÙNG TẦNG
      return isSameFloor;
    } else {
      // Cầu thang nối với Node CÙNG TẦNG, HOẶC Cầu thang ở TẦNG KẾ CẬN
      if (isSameFloor) return true;
      if (isAdjacentFloor && c.type === 'stairs') return true;
      return false;
    }
  });

  return (
    <div className="p-4 bg-white shadow rounded border space-y-4">
      <div className="flex justify-between items-center border-b pb-2">
        <h3 className="font-bold text-lg">Chỉnh sửa Khu vực</h3>
        <button 
          onClick={() => onDelete(selectedCorridor.id)}
          className="text-red-500 hover:text-red-700 text-sm font-semibold"
        >
          🗑️ Xóa
        </button>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Loại khu vực</label>
        <div className="flex space-x-4">
          <label className="flex items-center space-x-1 cursor-pointer">
            <input type="radio" name="type" value="corridor" checked={formData.type === 'corridor'} onChange={handleChange} />
            <span className="text-sm">Hành lang</span>
          </label>
          <label className="flex items-center space-x-1 cursor-pointer">
            <input type="radio" name="type" value="stairs" checked={formData.type === 'stairs'} onChange={handleChange} />
            <span className="text-sm">Cầu thang</span>
          </label>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Tên khu vực</label>
        <input
          type="text"
          name="name"
          value={formData.name}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border focus:border-blue-500 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Chiều dài (m)</label>
        <input
          type="number"
          name="length"
          value={formData.length}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border focus:border-blue-500 focus:ring-blue-500"
        />
      </div>
      
      {/* Connections List */}
      <div className="pt-2 border-t">
        <label className="block text-sm font-medium text-gray-700 mb-2">🔗 Kết nối với:</label>
        <div className="space-y-2 max-h-40 overflow-y-auto bg-gray-50 p-2 rounded border">
          {availableConnections.map(c => (
            <label key={c.id} className="flex items-center space-x-2 text-sm cursor-pointer">
              <input 
                type="checkbox" 
                checked={formData.connections.includes(c.id)}
                onChange={() => handleConnectionToggle(c.id)}
                className="rounded text-blue-600"
              />
              <span className={c.floor !== selectedCorridor.floor ? "text-orange-600 font-semibold" : ""}>
                {c.name} {c.floor !== selectedCorridor.floor && `(▲▼ Tầng ${c.floor})`}
              </span>
            </label>
          ))}
          {availableConnections.length === 0 && (
            <div className="text-xs text-gray-400">Không có khu vực nào hợp lệ để kết nối.</div>
          )}
        </div>
      </div>
    </div>
  );
}
