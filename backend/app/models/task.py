from enum import Enum
from typing import Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel

class TaskStatusEnum(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class TaskStatus(BaseModel):
    task_id: str
    status: TaskStatusEnum
    progress: int = 0
    message: str = ""
    created_at: datetime
    updated_at: datetime
    result_path: Optional[str] = None
    error_message: Optional[str] = None
    processing_time: Optional[float] = None
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class TaskCreate(BaseModel):
    input_path: str
    model_name: str = "RealESRGAN_x4plus"
    outscale: float = 4.0
    face_enhance: bool = False

class TaskResponse(BaseModel):
    task_id: str
    status: TaskStatusEnum
    progress: int
    message: str
    created_at: datetime
    estimated_completion: Optional[datetime] = None
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }
