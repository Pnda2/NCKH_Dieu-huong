#!/usr/bin/env python3
"""Đồng bộ bản đồ và danh sách thiết bị từ Web PC sang Raspberry Pi qua MQTT.

Cách dùng:
    python scripts/sync_map_to_pi.py
"""

import json
import os
from pathlib import Path
import sys
import time
import paho.mqtt.client as mqtt

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

ROOT = Path(__file__).resolve().parents[1]
MAP_FILE = ROOT / "csi_evacuation" / "backend" / "map_data.json"
PI_MQTT_HOST = os.getenv("WIEVAC_PI_MQTT_HOST", "10.42.0.1")
PI_MQTT_PORT = int(os.getenv("WIEVAC_PI_MQTT_PORT", "1883"))

def main():
    if not MAP_FILE.exists():
        print(f"Lỗi: Không tìm thấy file {MAP_FILE}")
        return 1

    try:
        data = json.loads(MAP_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"Lỗi đọc {MAP_FILE}: {exc}")
        return 1

    areas_count = len(data.get("areas", []))
    edges_count = len(data.get("edges", []))
    devices = data.get("devices", [])
    print("=" * 60)
    print("      ĐỒNG BỘ CẤU HÌNH BẢN ĐỒ VÀ THIẾT BỊ SANG PI 5")
    print("=" * 60)
    print(f"File nguồn       : {MAP_FILE}")
    print(f"Số khu vực (Area): {areas_count}")
    print(f"Số hành lang     : {edges_count}")
    print(f"Số thiết bị      : {len(devices)}")
    for d in devices:
        print(f"  - [{d.get('type', 'sign').upper()}] {d.get('name')} (ID: {d.get('id')}) -> Area: {d.get('area_id')}")
    print("-" * 60)
    print(f"Kết nối tới Pi Broker ({PI_MQTT_HOST}:{PI_MQTT_PORT})...")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    try:
        client.connect(PI_MQTT_HOST, PI_MQTT_PORT, keepalive=60)
        client.loop_start()
        
        payload_str = json.dumps(data, ensure_ascii=False)
        msg_info = client.publish("building/config", payload_str, qos=1, retain=True)
        msg_info.wait_for_publish(timeout=5.0)
        
        time.sleep(0.5)
        client.loop_stop()
        client.disconnect()
        print(f"[OK] Đã gửi thành công gói tin 'building/config' ({len(payload_str)} bytes) sang Pi 5!")
        print("Tiến trình edge_core.py trên Pi sẽ tự động nạp thiết bị và lưu vào config.json.")
        print("=" * 60)
        return 0
    except Exception as exc:
        print(f"Lỗi khi gửi sang Pi: {exc}")
        print("Kiểm tra lại xem máy tính đã kết nối Wi-Fi của Pi (WiEvac_Pi5) hay chưa.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
