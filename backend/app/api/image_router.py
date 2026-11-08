from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from typing import Optional
import os
import uuid
import aiofiles
from datetime import datetime

from app.services.image_service import ImageService
from app.models.task import TaskStatus

router = APIRouter()
image_service = ImageService()

# 获取backend目录的绝对路径
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS_DIR = os.path.join(BACKEND_DIR, "uploads")
RESULTS_DIR = os.path.join(BACKEND_DIR, "results")

# 确保目录存在
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)

@router.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    """
    上传图像文件
    
    Args:
        file: 上传的图像文件
        
    Returns:
        上传结果和文件信息
    """
    print("=== UPLOAD FUNCTION CALLED ===")
    try:
        print(f"📁 收到文件上传请求: {file.filename}")
        print(f"📁 文件类型: {file.content_type}")
        print(f"📁 文件大小: {file.size if hasattr(file, 'size') else '未知'}")
        
        # 暂时跳过文件类型验证，优先让功能工作
        # TODO: 后续添加基于文件扩展名的类型检查
        
        # 生成唯一文件名
        file_id = str(uuid.uuid4())
        file_extension = os.path.splitext(file.filename)[1]
        filename = f"{file_id}{file_extension}"
        
        print(f"📁 生成文件名: {filename}")
        print(f"📁 上传目录: {UPLOADS_DIR}")
        
        # 保存上传的文件
        upload_path = os.path.join(UPLOADS_DIR, filename)
        
        async with aiofiles.open(upload_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        print(f"✅ 文件保存成功: {upload_path}")
        print(f"✅ 文件大小: {len(content)} bytes")
        
        return {
            "message": "文件上传成功",
            "file_id": file_id,
            "filename": filename,
            "original_name": file.filename,
            "size": len(content),
            "content_type": file.content_type,
            "upload_time": datetime.now().isoformat()
        }
        
    except HTTPException:
        # 重新抛出HTTP异常
        raise
    except Exception as e:
        # 捕获所有其他异常并记录详细信息
        print(f"❌ 文件上传失败: {str(e)}")
        print(f"❌ 异常类型: {type(e).__name__}")
        import traceback
        print(f"❌ 异常堆栈:\n{traceback.format_exc()}")
        
        raise HTTPException(
            status_code=500, 
            detail=f"文件上传失败: {str(e)}"
        )

@router.post("/enhance/{file_id}")
async def enhance_image(
    file_id: str,
    model_name: str = "RealESRGAN_x4plus",
    outscale: float = 4.0,
    face_enhance: bool = False,
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """
    图像增强处理
    
    Args:
        file_id: 上传文件的ID
        model_name: 使用的模型名称
        outscale: 输出缩放比例
        face_enhance: 是否启用人脸增强
        background_tasks: 后台任务
        
    Returns:
        处理任务ID和状态
    """
    # 检查文件是否存在
    matching_files = [f for f in os.listdir(UPLOADS_DIR) if f.startswith(file_id)]
    
    if not matching_files:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    input_file = os.path.join(UPLOADS_DIR, matching_files[0])
    
    # 创建处理任务
    task_id = str(uuid.uuid4())
    
    # 启动后台处理任务
    background_tasks.add_task(
        image_service.process_image,
        task_id=task_id,
        input_path=input_file,
        model_name=model_name,
        outscale=outscale,
        face_enhance=face_enhance
    )
    
    return {
        "message": "图像处理任务已启动",
        "task_id": task_id,
        "status": "processing",
        "estimated_time": "30-60秒"
    }

@router.get("/status/{task_id}")
async def get_task_status(task_id: str):
    """
    获取处理任务状态
    
    Args:
        task_id: 任务ID
        
    Returns:
        任务状态信息
    """
    status = image_service.get_task_status(task_id)
    
    if not status:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    return status

@router.get("/result/{task_id}")
async def get_result(task_id: str, format: str = "original"):
    """
    获取处理结果
    
    Args:
        task_id: 任务ID
        format: 图片格式 (original/preview/thumbnail)
        
    Returns:
        处理后的图像文件
    """
    status = image_service.get_task_status(task_id)
    
    if not status:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    if status["status"] != "completed":
        raise HTTPException(status_code=400, detail="任务尚未完成")
    
    # 根据格式选择文件路径
    results_dir = os.path.join(BACKEND_DIR, "results")
    
    if format == "preview":
        result_path = os.path.join(results_dir, "preview", f"{task_id}_preview.jpg")
        media_type = "image/jpeg"
        filename = f"enhanced_{task_id}_preview.jpg"
    elif format == "thumbnail":
        result_path = os.path.join(results_dir, "thumbnail", f"{task_id}_thumbnail.webp")
        media_type = "image/webp"
        filename = f"enhanced_{task_id}_thumbnail.webp"
    else:  # original
        result_path = os.path.join(results_dir, "original", f"{task_id}_enhanced.png")
        media_type = "image/png"
        filename = f"enhanced_{task_id}.png"
    
    # 如果指定格式不存在，回退到原始格式
    if not os.path.exists(result_path):
        result_path = os.path.join(results_dir, "original", f"{task_id}_enhanced.png")
        media_type = "image/png"
        filename = f"enhanced_{task_id}.png"
    
    if not os.path.exists(result_path):
        raise HTTPException(status_code=404, detail="结果文件不存在")
    
    return FileResponse(
        path=result_path,
        filename=filename,
        media_type=media_type
    )

@router.get("/models")
async def get_available_models():
    """
    获取可用的模型列表
    
    Returns:
        可用模型信息
    """
    return {
        "models": [
            {
                "name": "RealESRGAN_x4plus",
                "description": "通用图像超分辨率模型",
                "scale": 4,
                "recommended": True
            },
            {
                "name": "RealESRGAN_x4plus_anime_6B",
                "description": "动漫图像专用模型",
                "scale": 4,
                "recommended": False
            },
            {
                "name": "RealESRGAN_x2plus",
                "description": "2倍超分辨率模型",
                "scale": 2,
                "recommended": False
            },
            {
                "name": "realesr-general-x4v3",
                "description": "轻量级通用模型",
                "scale": 4,
                "recommended": False
            }
        ]
    }

@router.delete("/task/{task_id}")
async def delete_task(task_id: str):
    """
    删除任务和相关文件
    
    Args:
        task_id: 任务ID
        
    Returns:
        删除结果
    """
    success = image_service.delete_task(task_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    return {"message": "任务已删除", "task_id": task_id}
