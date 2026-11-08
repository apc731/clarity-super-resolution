@echo off
REM 双击即可启动（绕过 PowerShell 执行策略的限制），等价于 .\start.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
