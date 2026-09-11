@echo off
setlocal
echo ===================================================
echo   WiEvac: Dang tat va giai phong toan bo tien trinh...
echo ===================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = @(1883, 3001, 5173); Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*edge_core.py*' -or $_.CommandLine -like '*device_simulator.py*' -or $_.CommandLine -like '*start_all.py*') -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo.
echo [OK] Tat ca tien trinh va cac cong 1883, 3001, 5173 da duoc giai phong hoan toan!
echo Ban co the an tam chay lai .\start.bat bat cu luc nao.
echo ===================================================
endlocal
