from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

# 创建FastAPI应用实例
app = FastAPI(
    title="Real-ESRGAN Web API",
    description="AI图像超分辨率增强服务",
    version="1.0.0"
)

# 配置CORS中间件，允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 在生产环境中应该设置为具体的前端域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 创建必要的目录
os.makedirs("uploads", exist_ok=True)
os.makedirs("results", exist_ok=True)

# 静态文件服务 - 用于提供处理后的图像
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/results", StaticFiles(directory="results"), name="results")

# 导入API路由 - 直接导入避免__init__.py问题
from app.api.image_router import router

# 注册路由
app.include_router(router, prefix="/api", tags=["图像处理"])

@app.get("/")
async def root():
    """API根路径"""
    return {
        "message": "Real-ESRGAN Web API",
        "version": "1.0.0",
        "docs": "/docs",
        "status": "running"
    }

@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {"status": "healthy", "service": "realesrgan-api"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
