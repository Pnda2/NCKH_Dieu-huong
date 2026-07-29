import random

class CSILayer:
    """
    Lớp giao tiếp và xử lý dữ liệu CSI (Channel State Information).
    Trong thực tế, lớp này sẽ nhận dữ liệu từ các ESP32 qua Serial/MQTT
    và dùng mô hình học máy (ví dụ: SVM/Neural Network) để suy luận ra 
    mức độ lấp đầy (fill ratio).
    
    Trong môi trường giả lập hiện tại, lớp này sẽ đóng vai trò thêm "nhiễu" (noise)
    vào trạng thái lý thuyết để mô phỏng sự thiếu chính xác của cảm biến thực tế.
    """
    def __init__(self, noise_level=0.05):
        self.noise_level = noise_level

    def process_node_data(self, theoretical_node_fill):
        """
        Chuyển đổi dữ liệu lấp đầy lý thuyết tại các khu vực (node) thành dữ liệu cảm biến.
        """
        sensed = {}
        for node_id, fill in theoretical_node_fill.items():
            noise = random.uniform(-self.noise_level, self.noise_level) if fill > 0.05 else 0
            sensed[node_id] = max(0.0, min(1.0, fill + noise))
        return sensed

    def process_edge_data(self, theoretical_edge_fill):
        """
        Chuyển đổi lưu lượng trên hành lang (edge) thành dữ liệu cảm biến.
        """
        sensed = {}
        for edge_id, fill in theoretical_edge_fill.items():
            noise = random.uniform(-self.noise_level, self.noise_level) if fill > 0.05 else 0
            sensed[edge_id] = max(0.0, min(1.0, fill + noise))
        return sensed
