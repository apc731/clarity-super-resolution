#!/usr/bin/env python3
"""
Real-ESRGAN Web API 启动脚本
"""

import uvicorn
import os
import sys

# 添加项目根目录到Python路径
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("🚀 启动 Real-ESRGAN Web API 服务...")
    print("📖 API文档地址: http://localhost:8000/docs")
    print("🔍 健康检查: http://localhost:8000/health")
    print("⚡ 服务地址: http://localhost:8000")
    print("-" * 50)
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # 开发模式下启用热重载
        log_level="info"
    )
