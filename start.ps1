# 一条命令起服务（Windows）：构建前端 → 用同一个进程托管界面 + 接口。
#
#   ./start.ps1              首次会自动构建前端
#   ./start.ps1 -Rebuild     强制重新构建前端
#   ./start.ps1 -Port 9000   换端口
#
# 需要：Python 环境里已装 torch（CUDA 版）与 Real-ESRGAN 依赖，见 README。

param(
    [switch]$Rebuild,
    [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Resolve-Python {
    if ($env:REALESRGAN_PYTHON -and (Test-Path $env:REALESRGAN_PYTHON)) { return $env:REALESRGAN_PYTHON }
    $candidates = @()
    if ($env:CONDA_PREFIX) { $candidates += (Join-Path $env:CONDA_PREFIX "python.exe") }
    $candidates += @(
        "D:\anaconda\envs\real-esrgan\python.exe",
        (Join-Path $env:USERPROFILE "anaconda3\envs\real-esrgan\python.exe"),
        (Join-Path $env:USERPROFILE "miniconda3\envs\real-esrgan\python.exe")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    return "python"
}

$python = Resolve-Python
Write-Host "python: $python"

& $python -c "import torch, fastapi, cv2; print('torch', torch.__version__, '| cuda', torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "依赖没装好。先看 README 的「安装」一节，或手动执行：" -ForegroundColor Yellow
    Write-Host "  $python -m pip install -r backend/requirements.txt"
    Write-Host "  并确保 REALESRGAN_ROOT 指向 Real-ESRGAN 源码目录（或 pip install realesrgan basicsr）"
    exit 1
}

$dist = Join-Path $root "frontend\dist\index.html"
if ($Rebuild -or -not (Test-Path $dist)) {
    Write-Host "构建前端…"
    Push-Location (Join-Path $root "frontend")
    if (-not (Test-Path "node_modules")) { npm ci }
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
    Pop-Location
}

$portArg = @()
if ($Port -gt 0) { $portArg = @("--port", "$Port") }

Write-Host ""
Write-Host "启动中… 打开 http://127.0.0.1:$(if ($Port -gt 0) { $Port } else { 8000 })" -ForegroundColor Green
& $python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 @portArg
