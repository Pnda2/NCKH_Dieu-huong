"""Bridge service: Pulls live CSI link scores from Raspberry Pi and pushes to local MQTT."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import time
import urllib.request

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("[Bridge] Lỗi: Cần cài đặt paho-mqtt. Chạy: pip install paho-mqtt", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
PI_URL = os.getenv("WIEVAC_PI_URL", "http://10.42.0.1:8080/api/v5/overview")
MQTT_HOST = os.getenv("WIEVAC_MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.getenv("WIEVAC_MQTT_PORT", "1883"))
PI_MQTT_HOST = os.getenv("WIEVAC_PI_MQTT_HOST", "10.42.0.1")
PI_MQTT_PORT = int(os.getenv("WIEVAC_PI_MQTT_PORT", "1883"))
TOPIC = "building/occupancy/input"

# Ánh xạ ID cạnh hành lang sang danh sách các link CSI (hỗ trợ nhiều cặp node trên 1 hành lang)
def load_edge_map() -> dict[str, list[str]]:
    custom_map = os.getenv("WIEVAC_LINK_MAP")
    if custom_map:
        try:
            parsed = json.loads(custom_map)
            # Chuẩn hóa về dạng {edge_id: [link_id, ...]}
            result = {}
            for k, v in parsed.items():
                links = [l.strip() for l in (v if isinstance(v, list) else str(v).split(",")) if l.strip()]
                result[k] = links
            return result
        except Exception as e:
            print(f"[Bridge] Lỗi đọc WIEVAC_LINK_MAP: {e}")

    # Đọc từ map_data.json
    map_file = ROOT / "csi_evacuation" / "backend" / "map_data.json"
    if map_file.exists():
        try:
            data = json.loads(map_file.read_text(encoding="utf-8"))
            dynamic_map: dict[str, list[str]] = {}
            for edge in data.get("edges", []):
                link_field = edge.get("csiLinkId")
                edge_id = edge.get("id")
                if link_field and edge_id:
                    # Tách các link nếu có dấu phẩy: "link-1, link-2, link-3"
                    links = [l.strip() for l in str(link_field).split(",") if l.strip()]
                    if links:
                        dynamic_map[edge_id] = links
            if dynamic_map:
                return dynamic_map
            # Fallback nếu chưa gán trên giao diện: lấy các hành lang đầu
            edges = [e["id"] for e in data.get("edges", []) if "id" in e]
            if len(edges) >= 3:
                return {edges[0]: ["link-1"], edges[1]: ["link-2"], edges[2]: ["link-3"]}
            elif len(edges) >= 2:
                return {edges[0]: ["link-1"], edges[1]: ["link-2"]}
        except Exception:
            pass

    return {"e_1788183031317": ["link-1"], "e_1788183040256": ["link-2"], "e_1788183041772": ["link-3"]}


def main():
    edge_map = load_edge_map()
    print(f"[Bridge] Bắt đầu cầu nối Pi ({PI_URL}) -> Local MQTT ({MQTT_HOST}:{MQTT_PORT})")
    print(f"[Bridge] Cấu hình ánh xạ: {edge_map}")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    connected = False
    for attempt in range(1, 15):
        try:
            client.connect(MQTT_HOST, MQTT_PORT, 60)
            client.loop_start()
            connected = True
            print(f"[Bridge] Đã kết nối MQTT Broker tại {MQTT_HOST}:{MQTT_PORT}")
            break
        except Exception as exc:
            print(f"[Bridge] Chờ MQTT Broker sẵn sàng... (lần {attempt})")
            time.sleep(1)

    if not connected:
        print("[Bridge] Không thể kết nối tới MQTT Broker. Dừng cầu nối.", file=sys.stderr)
        return 1

    # Kết nối phụ trợ tới Mosquitto trên Pi để tự động đồng bộ bản đồ khi có thay đổi
    pi_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    try:
        pi_client.connect(PI_MQTT_HOST, PI_MQTT_PORT, 60)
        pi_client.loop_start()
        print(f"[Bridge] Đã kết nối MQTT Pi tại {PI_MQTT_HOST}:{PI_MQTT_PORT} (Hỗ trợ tự động đồng bộ bản đồ)")
    except Exception as exc:
        print(f"[Bridge] Lưu ý: Chưa kết nối MQTT Pi ({exc}). Bản đồ sẽ không tự forward qua MQTT.")
        pi_client = None

    def on_local_message(c, userdata, msg):
        if pi_client:
            try:
                pi_client.publish(msg.topic, msg.payload, qos=msg.qos, retain=msg.retain)
                if msg.topic == "building/config":
                    print("[Bridge] Đã tự động chuyển tiếp bản đồ mới sang Raspberry Pi 5!")
            except Exception as e:
                print(f"[Bridge] Lỗi chuyển tiếp sang Pi ({msg.topic}): {e}")

    client.on_message = on_local_message
    client.subscribe("building/config")
    client.subscribe("building/incident/#")
    client.subscribe("building/simulation/#")

    def on_pi_message(c, userdata, msg):
        try:
            client.publish(msg.topic, msg.payload, qos=msg.qos, retain=msg.retain)
        except Exception as e:
            print(f"[Bridge] Lỗi chuyển tiếp từ Pi ({msg.topic}): {e}")

    if pi_client:
        pi_client.on_message = on_pi_message
        pi_client.subscribe("building/guidance/ack/#")
        pi_client.subscribe("building/guidance/capabilities/#")

    last_report_time = 0.0
    last_map_reload = 0.0

    try:
        while True:
            now = time.time()
            if now - last_map_reload >= 5.0:
                edge_map = load_edge_map()
                last_map_reload = now
            try:
                req = urllib.request.Request(PI_URL, headers={"User-Agent": "WiEvac-Local-Bridge/1.0"})
                with urllib.request.urlopen(req, timeout=2.0) as resp:
                    if resp.status == 200:
                        raw = resp.read().decode("utf-8")
                        payload = json.loads(raw)
                        links_data = payload.get("links", {})
                        values = {}

                        # Xử lý đa node trên một hành lang (Nguyên lý nút thắt cổ chai - Bottleneck)
                        for edge_id, link_ids in edge_map.items():
                            k_list = []
                            is_blocked = False

                            for link_id in link_ids:
                                link_info = links_data.get(link_id, {})
                                score = link_info.get("score")
                                state = link_info.get("state")

                                if state == "BLOCKED":
                                    is_blocked = True
                                    break
                                elif score is not None and state not in ("UNKNOWN", "NOT_READY"):
                                    # Quy đổi điểm 0..100 sang độ tắc nghẽn k: 0.0..1.0
                                    k_val = round(max(0.0, min(1.0, (100.0 - float(score)) / 100.0)), 3)
                                    k_list.append(k_val)

                            if is_blocked:
                                values[edge_id] = 1.0
                            elif k_list:
                                # Lấy điểm tắc nghẽn cao nhất trong các đoạn (đoạn nào tắc thì cả hành lang nghẽn)
                                values[edge_id] = max(k_list)

                        if values:
                            msg = json.dumps({"values": values})
                            client.publish(TOPIC, msg, qos=1)

                            if now - last_report_time >= 3.0:
                                print(f"[Bridge] Nhận từ Pi: {values} -> Đã đẩy vào 3D Scene")
                                last_report_time = now

            except urllib.error.URLError:
                # Pi chưa bật hoặc chưa bắt wifi
                pass
            except Exception as exc:
                print(f"[Bridge] Lỗi đọc dữ liệu: {exc}")

            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\n[Bridge] Dừng cầu nối.")
    finally:
        client.loop_stop()
        client.disconnect()
        if pi_client:
            pi_client.loop_stop()
            pi_client.disconnect()

    return 0


if __name__ == "__main__":
    sys.exit(main())
