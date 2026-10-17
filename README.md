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

| Thành phần                           | Entry point                                  | Cổng mặc định |
| ------------------------------------ | -------------------------------------------- | ------------: |
| Dashboard React/Vite (3D & 2D)       | `csi_evacuation/frontend`                    |          5173 |
| API + Socket.IO + MQTT Broker Aedes  | `csi_evacuation/backend/server.js`           |    3001, 1884 |
| Pi edge, D\* Lite, Guidance Planner  | `csi_evacuation/pi_edge/edge_core.py`        |   MQTT client |
| Downlink Bridge (MQTT → UDP ESP32)   | `csi_evacuation/pi_edge/pi_downlink_bridge.py`|   UDP 8889    |
| Thiết bị giả lập (Simulator)         | `csi_evacuation/pi_edge/device_simulator.py` |   MQTT client |
| Cầu nối Pi 5 thực địa (Pi-Bridge)    | `scripts/bridge_pi_to_local.py`              |   MQTT client |

Không có database ngoài: cấu hình bản đồ được lưu trong
`backend/map_data.json` và đồng bộ tự động qua topic `building/config`.

## D\* Lite và trọng số

Mỗi cạnh dùng đúng công thức:

`w(e) = t0(e) × [1 + gamma × (c(e) / Cmax(e))^delta] + H(e)`

- `t0`: `length / WIEVAC_FREE_WALKING_SPEED`.
- `c`: số người suy ra từ CSI `k(e) × Cmax`; simulator cũng gửi `k(e)`.
- `Cmax`: `capacityPeople` nếu được khai báo, hoặc `length × widthMeters × WIEVAC_PEOPLE_PER_SQM`.
- `H`: nguy cơ không âm. Từ `WIEVAC_HAZARD_BLOCK_THRESHOLD`, cạnh bị chặn.
- `gamma >= 0`, `delta >= 1` là cấu hình trong `.env`.

`dynamic_routing.py` chứa D\* Lite thật với `g`, `rhs`, hàng đợi khóa
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

## Hướng dẫn kết nối và kiểm thử Loa phần cứng (ESP32 Node 1)

1. **Phát Wi-Fi từ máy tính**:
   - Mở Windows Mobile Hotspot (Điểm phát sóng di động).
   - Tên mạng (SSID): `WiEvac_Pi5`
   - Mật khẩu: `12345678`
   - Băng tần: **2.4 GHz** (Bắt buộc vì ESP32 chỉ hỗ trợ 2.4 GHz).
2. **Cấp nguồn cho mạch ESP32 Node 1 (Receiver)**:
   - Mạch tự động kết nối vào mạng `WiEvac_Pi5` và nhận địa chỉ IP (dải `192.168.137.x`).
   - Mạch mở cổng lắng nghe gói nhị phân Downlink UDP tại cổng **8889**.
3. **Khởi động hệ thống**:
   ```powershell
   .\start.bat
   ```
   Lệnh này tự động kích hoạt cả Backend (3001), MQTT (1884), Edge Core D* Lite, Downlink Bridge UDP và Frontend (5173).
4. **Cấu hình và điều khiển trên Dashboard (`http://127.0.0.1:5173`)**:
   - Vào chế độ **Thiết kế** $\to$ Click vào một hành lang $\to$ Tại mục **Node Loa điều hướng**, bấm **`+ Thêm Node Loa`**.
   - Chọn Node phần cứng: `Node #1 (Loa/RX)`.
   - Chọn vị trí lắp đặt: `📍 Đầu`, `📍 Ở giữa`, hoặc `📍 Cuối`. Bấm **Lưu sơ đồ**.
   - Chuyển sang chế độ **Giám sát** $\to$ Bấm **Chạy mô phỏng**.
5. **Bản tin âm thanh phát ra từ Loa (DFPlayer Mini)**:
   - **Đám đông di tản qua hành lang**: Phát Track 3 (`0003.mp3` - `Cmd=11`): *"Đi thẳng theo hướng này"*.
   - **Hành lang bị phong tỏa / Báo cháy ($H=100$)**: Phát Track 4 (`0004.mp3` - `Cmd=14`): *"Chú ý, quay lại"*.
   - **Khu vực bị cô lập không còn đường thoát**: Phát Track 5 (`0005.mp3` - `Cmd=17`): *"Không có lối thoát an toàn, đóng cửa và trú ẩn khẩn cấp"*.
   - **Hành lang tiếp giáp trực tiếp cửa thoát hiểm**: Phát Track 6 (`0006.mp3` - `Cmd=16`): *"Bạn đã đến cửa thoát hiểm an toàn"*.
   - **Dừng mô phỏng / Kết thúc sự cố**: Loa tắt âm thanh (`Cmd=19 / CLEAR`).


## Dữ liệu CSI thật

Thiết bị CSI gửi MQTT QoS 1 vào `building/occupancy/input`:

```json
{ "values": { "edge_01": 0.42 } }
```

`0` là trống và `1` là đầy. Giá trị âm được chuẩn hóa về 0; giá trị từ 1 trở
lên làm cạnh quá tải, không thể đi qua. Điều chỉnh nguy cơ demo gửi:

```json
{ "edge_id": "edge_01", "hazard": 25 }
```

vào `building/hazard/adjust`, hoặc dùng thanh **Nguy cơ H(e)** khi chọn hành
lang trên dashboard. Dữ liệu simulator luôn được đánh dấu ở script/thiết bị
giả lập, không phải dữ liệu CSI production.

## Kiểm thử

```powershell
cd csi_evacuation\pi_edge
..\..\.venv\Scripts\python.exe -m unittest -v test_dynamic_routing.py
cd csi_evacuation\frontend
npm.cmd run lint
npm.cmd run build
cd ..\backend
node --check server.js
```

Các test bao phủ cạnh trống, ví dụ kết quả `15.5`, tính đơn điệu, sức chứa
không hợp lệ/quá tải, reroute do mật độ/nguy cơ, cập nhật tăng dần D\* Lite,
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

## Phase 1: tải người ước lượng và phân luồng

`k(e)` là tỷ lệ lấp đầy tương đối do simulator/CSI đã chuẩn hóa cung cấp, **không phải bộ đếm người**. Pi edge giữ `measured_k`, EMA `filtered_k`, `estimated_load = filtered_k × capacity`, confidence và thời điểm cập nhật. Dữ liệu UNKNOWN/STALE không được coi là hành lang trống.

Sức chứa lưu trữ dùng `capacityPeople` (hoặc `length × widthMeters × WIEVAC_PEOPLE_PER_SQM`); thông hành dùng `flowCapacity` (hoặc `widthMeters × WIEVAC_SPECIFIC_FLOW_PER_METER`, có hệ số cầu thang). Mô phỏng chỉ chuyển tải liên tục, giới hạn bởi tải nguồn, flow và chỗ trống đích; sai số bảo toàn được công bố qua `conservationError`. Hiệu chỉnh CSI được ghi riêng là `measurementCorrection`.

D* Lite vẫn là thành phần duy nhất tìm tuyến an toàn, cập nhật tăng dần `g/rhs` khi chi phí cạnh đổi và trả tối đa hai ứng viên. `evacuation_optimizer.py` dùng `scipy.optimize.linprog(method="highs")` để phân bổ tải ngắn hạn toàn cục; khi solver lỗi, hệ thống ghi log và fallback 100% theo tuyến D* Lite tốt nhất. Đây chỉ là dự báo mô phỏng Phase 1 theo horizon, không phải thời gian sơ tán vật lý chính xác.

Các tham số `WIEVAC_*` mới trong `.env.example` là giá trị simulator cần hiệu chuẩn tại hiện trường. Phase 2 mới xử lý CSI thô/AI, firmware, TLS/ACL, phần cứng và kiểm định an toàn thực tế.

Cần hiệu chuẩn CSI tại hiện trường để ánh xạ tín hiệu sang `k(e)`. Simulator
không thay thế phần cứng CSI, LED matrix hay loa/DFPlayer thực; chúng vẫn phải
gửi ACK MQTT theo giao thức hiện có.
