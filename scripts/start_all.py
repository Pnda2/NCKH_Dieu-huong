"""Start WiEvac services in one terminal and stop all children on Ctrl+C."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "csi_evacuation" / "backend"
FRONTEND = ROOT / "csi_evacuation" / "frontend"
EDGE = ROOT / "csi_evacuation" / "pi_edge"
LOGS = ROOT / "logs"

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(errors="replace")
    except AttributeError:
        pass


def load_env() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return probe.connect_ex(("127.0.0.1", port)) != 0


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def start(name: str, command: list[str], cwd: Path, env: dict[str, str], processes: list[subprocess.Popen]) -> None:
    log = (LOGS / f"{name}.log").open("w", encoding="utf-8")
    process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
    processes.append(process)
    print(f"[{name}] PID={process.pid} | log={log.name}")


def stop_all(processes: list[subprocess.Popen]) -> None:
    for process in reversed(processes):
        if process.poll() is None:
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], capture_output=True)
            else:
                process.terminate()
    deadline = time.time() + 5
    for process in processes:
        if process.poll() is None:
            try:
                process.wait(timeout=max(0.1, deadline - time.time()))
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], capture_output=True)
                else:
                    process.kill()


def main() -> int:
    if sys.version_info < (3, 10):
        print("Cần Python 3.10+.", file=sys.stderr)
        return 2
    load_env()
    try:
        require(importlib.util.find_spec("paho.mqtt") is not None, "Thiếu paho-mqtt. Chạy: python -m pip install -r requirements.txt")
        require(shutil.which("node") is not None, "Thiếu Node.js 20+.")
        require(shutil.which("npm.cmd" if os.name == "nt" else "npm") is not None, "Thiếu npm.")
        require((BACKEND / "node_modules").exists(), "Thiếu backend/node_modules. Chạy: cd csi_evacuation/backend && npm install")
        require((FRONTEND / "node_modules").exists(), "Thiếu frontend/node_modules. Chạy: cd csi_evacuation/frontend && npm install")
        ports = [int(os.getenv("WIEVAC_HTTP_PORT", "3001")), int(os.getenv("WIEVAC_MQTT_PORT", "1883")), int(os.getenv("WIEVAC_FRONTEND_PORT", "5173"))]
        busy = [str(port) for port in ports if not port_available(port)]
        require(not busy, "Cổng đang được sử dụng: " + ", ".join(busy))
    except RuntimeError as exc:
        print("Không thể khởi động:", exc, file=sys.stderr)
        return 2

    LOGS.mkdir(exist_ok=True)
    environment = os.environ.copy()
    npm = "npm.cmd" if os.name == "nt" else "npm"
    processes: list[subprocess.Popen] = []
    try:
        start("backend", ["node", "server.js"], BACKEND, environment, processes)
        # Chờ broker MQTT sẵn sàng trên cổng 1883 trước khi khởi động client
        deadline = time.time() + 10.0
        while time.time() < deadline:
            if not port_available(int(environment.get("WIEVAC_MQTT_PORT", "1883"))):
                break
            time.sleep(0.2)
        start("edge", [sys.executable, "edge_core.py"], EDGE, environment, processes)
        if environment.get("WIEVAC_SIMULATOR", "1") == "1":
            start("device-simulator", [sys.executable, "device_simulator.py"], EDGE, environment, processes)
        start("frontend", [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", environment.get("WIEVAC_FRONTEND_PORT", "5173")], FRONTEND, environment, processes)
        print("WiEvac đang chạy:")
        print("  Dashboard: http://127.0.0.1:" + environment.get("WIEVAC_FRONTEND_PORT", "5173"))
        print("  API:       http://127.0.0.1:" + environment.get("WIEVAC_HTTP_PORT", "3001"))
        print("  MQTT:      " + environment.get("WIEVAC_MQTT_HOST", "127.0.0.1") + ":" + environment.get("WIEVAC_MQTT_PORT", "1883"))
        print("Nhấn Ctrl+C để dừng sạch toàn bộ dịch vụ.")
        while True:
            if any(process.poll() is not None for process in processes):
                raise RuntimeError("Một dịch vụ đã dừng; xem thư mục logs.")
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nĐang dừng WiEvac...")
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        return 1
    finally:
        stop_all(processes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
