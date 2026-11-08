# 可选部署方式：把应用打进一个带 CUDA 运行时的镜像。
#
#   docker build -t clarity .
#   docker run --gpus all -p 8000:8000 -v clarity-data:/data clarity
#
# 说明：本机 Docker 未配置 GPU 直通，这个镜像**没有在真实 GPU 上验证过**，
# 只作为"换机器/上服务器"的参考起点；权重的首次下载仍发生在容器启动后
# （挂载 /data 可以持久化权重与结果）。日常使用请直接用 start.sh / start.ps1。

FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip git curl ca-certificates \
        libgl1 libglib2.0-0 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python 依赖（torch 单独装，走 CUDA 12.1 的 wheel）
COPY backend/requirements.txt backend/requirements.txt
RUN python3 -m pip install --upgrade pip \
    && python3 -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121 \
    && python3 -m pip install -r backend/requirements.txt facexlib

# Real-ESRGAN 源码（提供 basicsr / realesrgan / gfpgan）
RUN git clone --depth 1 https://github.com/xinntao/Real-ESRGAN.git /opt/Real-ESRGAN
ENV REALESRGAN_ROOT=/opt/Real-ESRGAN

# 前端构建
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci
COPY frontend frontend
RUN cd frontend && npm run build

COPY backend backend

ENV DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=8000
VOLUME ["/data"]
EXPOSE 8000

CMD ["python3", "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
