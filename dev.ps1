# 开发模式：后端带热重载（:8000）+ 前端 Vite HMR（:3000）。
# 日常改界面用这个；想把界面和接口放同一个端口（演示/截图）用 ./start.ps1。

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Resolve-Python {
    if ($env:REALESRGAN_PYTHON -and (Test-Path $env:REALESRGAN_PYTHON)) { return $env:REALESRGAN_PYTHON }
    $candidates = @()
    if ($env:CONDA_PREFIX) { $candidates += (Join-Path $env:CONDA_PREFIX "python.exe") }
    $candidates += @(
        "D:\anaconda\envs\real-esrgan\python.exe",
        (Join-Path $env:USERPROFILE "anaconda3\envs\real-esrgan\python.exe")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    return "python"
}

$python = Resolve-Python

Start-Process -FilePath $python -ArgumentList "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", "8000", "--reload"
Start-Sleep -Seconds 3
Push-Location (Join-Path $root "frontend")
npm run dev
Pop-Location
