# Giai đoạn 1 — Điều hướng loa và bảng hiệu

## Luồng xử lý

```text
CSI k(e)
  → Pi 5 tính trọng số và next_edge
  → Guidance Controller đổi next_edge thành LEFT/RIGHT/STRAIGHT/UP/DOWN
  → MQTT gửi lệnh tới loa/bảng hiệu
  → Thiết bị gửi ACK
  → Dashboard hiển thị mũi tên, lệnh và online/offline
```

## Độ rộng và khả năng tiếp nhận

CSI tiếp tục chỉ cung cấp độ lấp đầy chuẩn hóa `k(e)`. Mỗi hành lang có thêm
`widthMeters`, là độ rộng hữu dụng tại đoạn hẹp nhất. Pi 5 tính khả năng tiếp
nhận tương đối:

```text
R(e) = widthMeters(e) × [1 - k(e)]
```

Vì vậy, hai hành lang cùng `k = 50%` nhưng rộng 1 m và 2 m sẽ có `R` lần lượt
là 0,5 và 1,0. Thuật toán kết hợp `R` với thời gian còn lại tới lối thoát, chọn
tối đa hai hướng và chuẩn hóa tỷ lệ về 100%. Hướng phụ dưới 10% sẽ không được
hiển thị. Kết nối cầu thang dùng thêm hệ số giảm `0,65`.

Các bản đồ cũ được gán tạm độ rộng 1,2 m và cần được xác nhận lại trong chế độ
Thiết kế.

## Cấu hình thiết bị

1. Mở chế độ **Thiết kế**.
2. Chọn node/khu vực đặt thiết bị.
3. Thêm **Bảng hiệu** hoặc **Loa**.
4. Với bảng hiệu, ánh xạ từng hành lang nối vào node thành hướng vật lý.
5. Bấm **Lưu** để gửi registry xuống Pi 5.

`orientation` dùng quy ước `0° = Bắc`, tăng theo chiều kim đồng hồ. Ánh xạ
`edgeDirections` trên giao diện có ưu tiên cao hơn hướng suy ra từ tọa độ.

## MQTT

Lệnh bảng hiệu:

```text
building/guidance/sign/{device_id}
```

Lệnh loa:

```text
building/guidance/speaker/{device_id}
```

ACK:

```text
building/guidance/ack/{device_id}
```

Trạng thái tổng hợp:

```text
building/guidance/state
```

Lệnh và trạng thái dùng QoS 1. Lệnh được retain để thiết bị kết nối lại nhận
được trạng thái gần nhất.

## Chạy simulator

Sau khi backend/MQTT broker và `edge_core.py` đã chạy:

```powershell
python device_simulator.py
```

Simulator in lệnh loa/bảng hiệu ra terminal và tự trả ACK. Để giả lập một thiết
bị không phản hồi:

```powershell
$env:SIMULATOR_DROP_ACK_FOR="sign_01,speaker_02"
python device_simulator.py
```

Thiết bị không ACK trong 3 giây được đánh dấu `offline`. Guidance Controller
gửi heartbeat lệnh mỗi 5 giây và đưa toàn bộ thiết bị về `STANDBY` khi dừng hoặc
hoàn tất mô phỏng.

## Lưu ý

- Phải khởi động lại `edge_core.py` và backend sau khi cập nhật mã.
- Sau khi thêm/sửa thiết bị trên giao diện, phải bấm **Lưu**.
- Giai đoạn 1 sử dụng simulator. Giai đoạn 2 sẽ thay simulator bằng driver GPIO,
  LED matrix, bộ phát âm thanh hoặc ESP32 mà không thay đổi giao thức lệnh.
