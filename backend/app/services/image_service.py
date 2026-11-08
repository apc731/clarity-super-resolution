import os
import sys
import time
import asyncio
from datetime import datetime
from typing import Dict, Optional
import uuid

# 添加Real-ESRGAN路径到系统路径
sys.path.append("e:/Real-ESRGAN")

from basicsr.archs.rrdbnet_arch import RRDBNet
from basicsr.archs.srvgg_arch import SRVGGNetCompact
from realesrgan import RealESRGANer
import cv2
import numpy as np
from PIL import Image
import io

from app.models.task import TaskStatus, TaskStatusEnum

class ImageService:
    def __init__(self):
        # 任务状态存储（在生产环境中应该使用数据库）
        self.tasks: Dict[str, TaskStatus] = {}
        # 模型缓存
        self.models = {}
        
        # 获取backend目录的绝对路径
        self.backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.results_dir = os.path.join(self.backend_dir, "results")
        
        # 确保结果目录存在
        os.makedirs(self.results_dir, exist_ok=True)
        
    async def process_image(
        self, 
        task_id: str, 
        input_path: str, 
        model_name: str = "RealESRGAN_x4plus",
        outscale: float = 4.0,
        face_enhance: bool = False
    ):
        """
        处理图像增强任务
        """
        start_time = time.time()
        
        # 初始化任务状态
        self.tasks[task_id] = TaskStatus(
            task_id=task_id,
            status=TaskStatusEnum.PROCESSING,
            progress=0,
            message="开始处理图像",
            created_at=datetime.now(),
            updated_at=datetime.now()
        )
        
        try:
            # 更新状态：加载模型
            self._update_task_status(task_id, 10, "正在加载模型...")
            
            # 获取或创建模型
            upsampler = await self._get_model(model_name)
            
            # 更新状态：开始处理
            self._update_task_status(task_id, 30, "正在处理图像...")
            
            # 读取图像
            img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
            if img is None:
                raise ValueError(f"无法读取图像文件: {input_path}")
            
            # 处理灰度图像
            if len(img.shape) == 2:
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
            elif len(img.shape) == 3 and img.shape[2] == 1:
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
            
            # 更新状态：AI推理
            self._update_task_status(task_id, 60, "正在进行AI超分辨率处理...")
            
            # 执行超分辨率处理
            output, _ = upsampler.enhance(img, outscale=outscale)
            
            # 人脸增强（如果启用）
            if face_enhance:
                self._update_task_status(task_id, 80, "正在进行人脸增强...")
                try:
                    from gfpgan import GFPGANer
                    face_enhancer = GFPGANer(
                        model_path='https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.3.pth',
                        upscale=outscale,
                        arch='clean',
                        channel_multiplier=2,
                        bg_upsampler=upsampler
                    )
                    _, _, output = face_enhancer.enhance(
                        img, has_aligned=False, only_center_face=False, paste_back=True
                    )
                except Exception as e:
                    print(f"人脸增强失败，继续使用原始结果: {e}")
            
            # 更新状态：保存结果
            self._update_task_status(task_id, 90, "正在保存结果...")
            
            # 保存多种格式的结果
            result_paths = await self._save_multiple_formats(task_id, output)
            result_path = result_paths["original"]  # 主要结果路径
            
            # 计算处理时间
            processing_time = time.time() - start_time
            
            # 更新任务完成状态
            self.tasks[task_id] = TaskStatus(
                task_id=task_id,
                status=TaskStatusEnum.COMPLETED,
                progress=100,
                message="处理完成",
                created_at=self.tasks[task_id].created_at,
                updated_at=datetime.now(),
                result_path=result_path,
                processing_time=processing_time
            )
            
        except Exception as e:
            # 处理失败
            self.tasks[task_id] = TaskStatus(
                task_id=task_id,
                status=TaskStatusEnum.FAILED,
                progress=0,
                message="处理失败",
                created_at=self.tasks[task_id].created_at,
                updated_at=datetime.now(),
                error_message=str(e),
                processing_time=time.time() - start_time
            )
    
    async def _get_model(self, model_name: str) -> RealESRGANer:
        """
        获取或创建模型实例
        """
        if model_name in self.models:
            return self.models[model_name]
        
        # 根据模型名称创建对应的模型
        if model_name == "RealESRGAN_x4plus":
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
            netscale = 4
            file_url = ['https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth']
        elif model_name == "RealESRGAN_x4plus_anime_6B":
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=6, num_grow_ch=32, scale=4)
            netscale = 4
            file_url = ['https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth']
        elif model_name == "RealESRGAN_x2plus":
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=2)
            netscale = 2
            file_url = ['https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1.0/RealESRGAN_x2plus.pth']
        elif model_name == "realesr-general-x4v3":
            model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type='prelu')
            netscale = 4
            file_url = ['https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth']
        else:
            raise ValueError(f"不支持的模型: {model_name}")
        
        # 确定模型路径
        model_path = os.path.join("e:/Real-ESRGAN/weights", f"{model_name}.pth")
        
        # 如果本地没有模型文件，从网上下载
        if not os.path.isfile(model_path):
            from basicsr.utils.download_util import load_file_from_url
            ROOT_DIR = "e:/Real-ESRGAN"
            for url in file_url:
                model_path = load_file_from_url(
                    url=url, 
                    model_dir=os.path.join(ROOT_DIR, "weights"), 
                    progress=True, 
                    file_name=None
                )
        
        # 创建RealESRGANer实例
        upsampler = RealESRGANer(
            scale=netscale,
            model_path=model_path,
            model=model,
            tile=0,  # 不使用分块处理
            tile_pad=10,
            pre_pad=0,
            half=True,  # 使用半精度推理
        )
        
        # 缓存模型
        self.models[model_name] = upsampler
        
        return upsampler
    
    async def _save_multiple_formats(self, task_id: str, output_image: np.ndarray) -> Dict[str, str]:
        """
        保存多种格式的图像文件
        """
        result_paths = {}
        
        try:
            # 创建子目录
            original_dir = os.path.join(self.results_dir, "original")
            preview_dir = os.path.join(self.results_dir, "preview")
            thumbnail_dir = os.path.join(self.results_dir, "thumbnail")
            
            os.makedirs(original_dir, exist_ok=True)
            os.makedirs(preview_dir, exist_ok=True)
            os.makedirs(thumbnail_dir, exist_ok=True)
            
            # 1. 保存原始高质量PNG
            original_filename = f"{task_id}_enhanced.png"
            original_path = os.path.join(original_dir, original_filename)
            cv2.imwrite(original_path, output_image)
            result_paths["original"] = original_path
            
            # 2. 保存预览JPG (80%质量)
            preview_filename = f"{task_id}_preview.jpg"
            preview_path = os.path.join(preview_dir, preview_filename)
            # 转换为PIL格式并保存JPG
            pil_image = Image.fromarray(cv2.cvtColor(output_image, cv2.COLOR_BGR2RGB))
            pil_image.save(preview_path, 'JPEG', quality=80, optimize=True)
            result_paths["preview"] = preview_path
            
            # 3. 保存缩略图 (256px宽度，WebP格式)
            thumbnail_filename = f"{task_id}_thumbnail.webp"
            thumbnail_path = os.path.join(thumbnail_dir, thumbnail_filename)
            
            # 计算缩略图尺寸
            height, width = output_image.shape[:2]
            if width > 256:
                new_height = int(256 * height / width)
                thumbnail = cv2.resize(output_image, (256, new_height))
            else:
                thumbnail = output_image
            
            # 转换为PIL格式并保存WebP
            pil_thumbnail = Image.fromarray(cv2.cvtColor(thumbnail, cv2.COLOR_BGR2RGB))
            pil_thumbnail.save(thumbnail_path, 'WebP', quality=70, optimize=True)
            result_paths["thumbnail"] = thumbnail_path
            
            print(f"✅ 多格式保存完成: {len(result_paths)} 个文件")
            
        except Exception as e:
            print(f"❌ 多格式保存失败: {e}")
            # 至少保存原始PNG
            original_filename = f"{task_id}_enhanced.png"
            original_path = os.path.join(self.results_dir, original_filename)
            cv2.imwrite(original_path, output_image)
            result_paths["original"] = original_path
        
        return result_paths
    
    def _update_task_status(self, task_id: str, progress: int, message: str):
        """更新任务状态"""
        if task_id in self.tasks:
            self.tasks[task_id].progress = progress
            self.tasks[task_id].message = message
            self.tasks[task_id].updated_at = datetime.now()
    
    def get_task_status(self, task_id: str) -> Optional[Dict]:
        """获取任务状态"""
        if task_id not in self.tasks:
            return None
        
        task = self.tasks[task_id]
        return {
            "task_id": task.task_id,
            "status": task.status,
            "progress": task.progress,
            "message": task.message,
            "created_at": task.created_at.isoformat(),
            "updated_at": task.updated_at.isoformat(),
            "result_path": task.result_path,
            "error_message": task.error_message,
            "processing_time": task.processing_time
        }
    
    def delete_task(self, task_id: str) -> bool:
        """删除任务和相关文件"""
        if task_id not in self.tasks:
            return False
        
        task = self.tasks[task_id]
        
        # 删除结果文件
        if task.result_path and os.path.exists(task.result_path):
            os.remove(task.result_path)
        
        # 删除任务记录
        del self.tasks[task_id]
        
        return True
