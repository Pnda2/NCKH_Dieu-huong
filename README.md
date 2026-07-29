# WiEvac – Điều phối sơ tán khẩn cấp dùng WiFi CSI

WiEvac là nguyên mẫu điều phối sơ tán nhiều tầng. Dashboard React hiển thị
mật độ hành lang, nguy cơ và chỉ dẫn; dịch vụ Python ở edge nhận CSI/mô phỏng,
tính trọng số động và gửi lệnh bảng chỉ dẫn/loa qua MQTT.

```text
WiFi CSI hoặc Simulator
        ↓ k(e)
Pi edge: chuẩn hóa mật độ → cập nhật trọng số cạnh → D* Lite
        ↓ MQTT
Express + Socket.IO → Dashboard / bảng hiệu / loa
```

## Kiến trúc và cổng

| Thành phần | Entry point | Cổng mặc định |
|---|---|---:|
| Dashboard React/Vite | `csi_evacuation/frontend` | 5173 |
| API + Socket.IO + MQTT broker | `csi_evacuation/backend/server.js` | 3001, 1883 |
| Pi edge, D* Lite, CSI bridge | `csi_evacuation/pi_edge/edge_core.py` | MQTT client |
| Thiết bị giả lập | `csi_evacuation/pi_edge/device_simulator.py` | MQTT client |

Không có database ngoài: cấu hình bản đồ được lưu trong
`backend/map_data.json` và đồng bộ qua topic `building/config`.

## D* Lite và trọng số

Mỗi cạnh dùng đúng công thức:

`w(e) = t0(e) × [1 + gamma × (c(e) / Cmax(e))^delta] + H(e)`

- `t0`: `length / WIEVAC_FREE_WALKING_SPEED`.
- `c`: số người suy ra từ CSI `k(e) × Cmax`; simulator cũng gửi `k(e)`.
- `Cmax`: `capacityPeople` nếu được khai báo, hoặc `length × widthMeters × WIEVAC_PEOPLE_PER_SQM`.
- `H`: nguy cơ không âm. Từ `WIEVAC_HAZARD_BLOCK_THRESHOLD`, cạnh bị chặn.
- `gamma >= 0`, `delta >= 1` là cấu hình trong `.env`.

`dynamic_routing.py` chứa D* Lite thật với `g`, `rhs`, hàng đợi khóa
hai thành phần, `calculate_key`, `update_vertex`, `compute_shortest_path`
và cập nhật các cạnh đổi chi phí. Mỗi điểm bắt đầu giữ lại planner riêng;
khi CSI/nguy cơ đổi, chỉ các đỉnh chịu ảnh hưởng được repair. Heuristic bằng 0
nên luôn admissible/consistent và không cộng lại nguy cơ.

## Cài đặt Windows 11

Yêu cầu: Python 3.10–3.12, Node.js 20+ và npm.

```powershell
git clone https://github.com/Pnda2/NCKH_Dieu-huong.git
cd NCKH_Dieu-huong
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
cd csi_evacuation\backend; npm install
cd ..\frontend; npm install
cd ..\..
.\start.bat
```

Nếu PowerShell chặn script, chạy `python scripts\start_all.py`. Cần đóng
dịch vụ cũ nếu cổng 3001, 1883 hoặc 5173 đang bận.

## Linux/macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
(cd csi_evacuation/backend && npm install)
(cd csi_evacuation/frontend && npm install)
chmod +x start.sh
./start.sh
```

`start_all.py` kiểm tra Python, paho-mqtt, Node/npm, dependency Node, cổng,
nạp `.env`, ghi log riêng vào `logs/`, hiển thị PID/URL và dừng toàn bộ tiến
trình con khi nhấn `Ctrl+C`. Đặt `WIEVAC_SIMULATOR=0` nếu thay simulator bằng
thiết bị thật.

## Dữ liệu CSI thật

Thiết bị CSI gửi MQTT QoS 1 vào `building/occupancy/input`:

```json
{"values": {"edge_01": 0.42}}
```

`0` là trống và `1` là đầy. Giá trị âm được chuẩn hóa về 0; giá trị từ 1 trở
lên làm cạnh quá tải, không thể đi qua. Điều chỉnh nguy cơ demo gửi:

```json
{"edge_id": "edge_01", "hazard": 25}
```

vào `building/hazard/adjust`, hoặc dùng thanh **Nguy cơ H(e)** khi chọn hành
lang trên dashboard. Dữ liệu simulator luôn được đánh dấu ở script/thiết bị
giả lập, không phải dữ liệu CSI production.

## Kiểm thử

```powershell
.\.venv\Scripts\python.exe -m unittest -v csi_evacuation\pi_edge\test_dynamic_routing.py
cd csi_evacuation\frontend
npm.cmd run lint
npm.cmd run build
cd ..\backend
node --check server.js
```

Các test bao phủ cạnh trống, ví dụ kết quả `15.5`, tính đơn điệu, sức chứa
không hợp lệ/quá tải, reroute do mật độ/nguy cơ, cập nhật tăng dần D* Lite,
không còn đường thoát và đối chiếu đường đi tĩnh.

## Khắc phục lỗi

- **Thiếu `paho-mqtt`:** kích hoạt virtual environment và chạy
  `python -m pip install -r requirements.txt`.
- **Cổng bị chiếm:** tắt tiến trình cũ hoặc đổi các biến port trong `.env`.
- **Dashboard không nối API/WebSocket:** chạy backend trước, kiểm tra
  `logs/backend.log` và URL API cổng 3001.
- **Không có CSI:** giữ `WIEVAC_SIMULATOR=1`; khi dùng thật, kiểm tra topic,
  edge id và broker MQTT.
- **Không tìm thấy đường thoát:** dashboard hiển thị trạng thái bị kẹt; mở lại
  lối thoát/hành lang, giảm mật độ hoặc nguy cơ.

## Giới hạn

Cần hiệu chuẩn CSI tại hiện trường để ánh xạ tín hiệu sang `k(e)`. Simulator
không thay thế phần cứng CSI, LED matrix hay loa/DFPlayer thực; chúng vẫn phải
gửi ACK MQTT theo giao thức hiện có.
