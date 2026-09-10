#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".codex-loop"
REPORT = STATE / "evaluation.json"

def exe(name: str) -> str:
    if os.name == "nt":
        candidate = shutil.which(name + ".cmd")
        if candidate:
            return candidate
    return shutil.which(name) or name

def run_gate(name: str, command: list[str], cwd: Path, weight: int) -> dict:
    print(f"\n=== {name} ===")
    try:
        proc = subprocess.run(
            command,
            cwd=str(cwd),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=300,
            encoding="utf-8",
            errors="replace",
        )
        output = proc.stdout or ""
        print(output[-12000:])
        return {
            "name": name,
            "passed": proc.returncode == 0,
            "returncode": proc.returncode,
            "weight": weight,
            "command": command,
            "output_tail": output[-12000:],
        }
    except subprocess.TimeoutExpired as exc:
        output = (exc.stdout or "") if isinstance(exc.stdout, str) else ""
        print("TIMEOUT")
        return {
            "name": name,
            "passed": False,
            "returncode": 124,
            "weight": weight,
            "command": command,
            "output_tail": (output + "\nTIMEOUT after 300 seconds")[-12000:],
        }
    except Exception as exc:
        print(f"ERROR: {exc}")
        return {
            "name": name,
            "passed": False,
            "returncode": 125,
            "weight": weight,
            "command": command,
            "output_tail": f"{type(exc).__name__}: {exc}",
        }

def main() -> int:
    STATE.mkdir(exist_ok=True)

    py = sys.executable
    npm = exe("npm")

    gates = [
        run_gate(
            "Python Phase 1 tests",
            [py, "-m", "unittest", "discover", "-s", "pi_edge", "-p", "test_*.py"],
            ROOT / "csi_evacuation",
            35,
        ),
        run_gate(
            "Backend tests",
            [npm, "test"],
            ROOT / "csi_evacuation" / "backend",
            20,
        ),
        run_gate(
            "Frontend unit tests",
            [npm, "test"],
            ROOT / "csi_evacuation" / "frontend",
            15,
        ),
        run_gate(
            "Frontend lint",
            [npm, "run", "lint"],
            ROOT / "csi_evacuation" / "frontend",
            15,
        ),
        run_gate(
            "Frontend production build",
            [npm, "run", "build"],
            ROOT / "csi_evacuation" / "frontend",
            15,
        ),
    ]

    score = sum(g["weight"] for g in gates if g["passed"])
    passed = all(g["passed"] for g in gates)

    report = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if passed else "FAIL",
        "score": score,
        "max_score": 100,
        "gates": gates,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n==============================")
    print(f"RESULT: {report['status']} | SCORE: {score}/100")
    for g in gates:
        print(f"{'PASS' if g['passed'] else 'FAIL'}  {g['weight']:>2}  {g['name']}")
    print(f"Report: {REPORT}")
    return 0 if passed else 1

if __name__ == "__main__":
    raise SystemExit(main())
