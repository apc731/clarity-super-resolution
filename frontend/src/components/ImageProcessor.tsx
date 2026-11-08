import React, { useState, useEffect } from 'react';
import { Play, Settings, Clock, CheckCircle, XCircle, ArrowLeft } from 'lucide-react';

interface UploadedFile {
  file_id: string;
  filename: string;
  original_name: string;
  size: number;
  content_type: string;
}

interface ProcessingTask {
  task_id: string;
  file_id: string;
  status: string;
  progress: number;
  message: string;
  result_url?: string;
}

interface Model {
  name: string;
  description: string;
  scale: number;
  recommended: boolean;
}

interface ImageProcessorProps {
  uploadedFile: UploadedFile;
  onProcessingComplete: (task: ProcessingTask) => void;
  onBack: () => void;
}

const ImageProcessor: React.FC<ImageProcessorProps> = ({
  uploadedFile,
  onProcessingComplete,
  onBack,
}) => {
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('RealESRGAN_x4plus');
  const [outscale, setOutscale] = useState<number>(4.0);
  const [faceEnhance, setFaceEnhance] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);
  const [currentTask, setCurrentTask] = useState<ProcessingTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      const response = await fetch('/api/models');
      if (response.ok) {
        const data = await response.json();
        setModels(data.models);
      }
    } catch (err) {
      console.error('Failed to fetch models:', err);
    }
  };

  const startProcessing = async () => {
    setProcessing(true);
    setError(null);

    try {
      const response = await fetch(`/api/enhance/${uploadedFile.file_id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_name: selectedModel,
          outscale: outscale,
          face_enhance: faceEnhance,
        }),
      });

      if (!response.ok) {
        throw new Error('处理启动失败');
      }

      const result = await response.json();
      setCurrentTask({
        task_id: result.task_id,
        file_id: uploadedFile.file_id,
        status: 'processing',
        progress: 0,
        message: result.message,
      });

      // 开始轮询任务状态
      pollTaskStatus(result.task_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理失败');
      setProcessing(false);
    }
  };

  const pollTaskStatus = async (taskId: string) => {
    let pollInterval: number;
    let pollCount = 0;
    const maxPolls = 300; // 最大轮询次数（10分钟）
    
    const poll = async () => {
      pollCount++;
      
      // 防止无限轮询
      if (pollCount > maxPolls) {
        clearInterval(pollInterval);
        setProcessing(false);
        setError('处理超时，请重试');
        return;
      }

      try {
        const response = await fetch(`/api/status/${taskId}`);
        if (!response.ok) {
          throw new Error('获取状态失败');
        }

        const status = await response.json();
        setCurrentTask(prev => prev ? { ...prev, ...status } : null);

        // 任务完成或失败时停止轮询
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(pollInterval);
          setProcessing(false);
          
          if (status.status === 'completed') {
            // 获取结果URL
            try {
              const resultResponse = await fetch(`/api/result/${taskId}?format=preview`);
              if (resultResponse.ok) {
                const resultUrl = URL.createObjectURL(await resultResponse.blob());
                onProcessingComplete({
                  ...status,
                  result_url: resultUrl,
                });
              } else {
                setError('获取结果失败');
              }
            } catch (err) {
              setError('获取结果时出错');
            }
          } else {
            setError(status.error_message || '处理失败');
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
        // 网络错误时不停止轮询，继续尝试
      }
    };

    // 智能轮询间隔：处理初期1秒，后期2秒
    const initialInterval = currentTask?.progress === 0 ? 1000 : 2000;
    pollInterval = setInterval(poll, initialInterval);
    
    // 立即执行第一次轮询
    poll();
  };

  const getStatusIcon = () => {
    if (!currentTask) return null;
    
    switch (currentTask.status) {
      case 'processing':
        return <div className="loading-spinner"></div>;
      case 'completed':
        return <CheckCircle className="h-6 w-6 text-green-600" />;
      case 'failed':
        return <XCircle className="h-6 w-6 text-red-600" />;
      default:
        return <Clock className="h-6 w-6 text-gray-600" />;
    }
  };

  const getStatusColor = () => {
    if (!currentTask) return 'bg-gray-100';
    
    switch (currentTask.status) {
      case 'processing':
        return 'bg-blue-100';
      case 'completed':
        return 'bg-green-100';
      case 'failed':
        return 'bg-red-100';
      default:
        return 'bg-gray-100';
    }
  };

  if (processing && currentTask) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className={`${getStatusColor()} rounded-lg p-8`}>
          <div className="text-center space-y-6">
            <div className="flex justify-center">
              {getStatusIcon()}
            </div>
            
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                {currentTask.status === 'processing' ? '正在处理图像' : 
                 currentTask.status === 'completed' ? '处理完成' : '处理失败'}
              </h3>
              <p className="text-gray-600">{currentTask.message}</p>
            </div>

            {currentTask.status === 'processing' && (
              <div className="space-y-4">
                <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                  <div
                    className="progress-bar bg-blue-600 h-full rounded-full"
                    style={{ width: `${currentTask.progress}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-500">
                  进度: {currentTask.progress}%
                </p>
              </div>
            )}

            {currentTask.status === 'failed' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-700">{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* 文件信息 */}
      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <h3 className="text-lg font-medium text-gray-900 mb-4">文件信息</h3>
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center">
            <Settings className="h-8 w-8 text-gray-600" />
          </div>
          <div>
            <p className="font-medium text-gray-900">{uploadedFile.original_name}</p>
            <p className="text-sm text-gray-500">
              {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB • {uploadedFile.content_type}
            </p>
          </div>
        </div>
      </div>

      {/* 模型选择 */}
      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <h3 className="text-lg font-medium text-gray-900 mb-4">选择模型</h3>
        <div className="space-y-3">
          {models.map((model) => (
            <label
              key={model.name}
              className="flex items-center p-4 border rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
            >
              <input
                type="radio"
                name="model"
                value={model.name}
                checked={selectedModel === model.name}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="mr-3"
              />
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-gray-900">{model.name}</span>
                  {model.recommended && (
                    <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                      推荐
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600">{model.description}</p>
                <p className="text-xs text-gray-500">放大倍数: {model.scale}x</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* 参数设置 */}
      <div className="bg-white rounded-lg p-6 border border-gray-200">
        <h3 className="text-lg font-medium text-gray-900 mb-4">参数设置</h3>
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              输出缩放比例: {outscale}x
            </label>
            <input
              type="range"
              min="1"
              max="8"
              step="0.5"
              value={outscale}
              onChange={(e) => setOutscale(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1x</span>
              <span>4x</span>
              <span>8x</span>
            </div>
          </div>

          <div>
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={faceEnhance}
                onChange={(e) => setFaceEnhance(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm font-medium text-gray-700">启用人脸增强</span>
            </label>
            <p className="text-xs text-gray-500 mt-1">
              启用后将自动检测并增强图像中的人脸区域
            </p>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center space-x-2">
            <XCircle className="h-5 w-5 text-red-600" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex space-x-4">
        <button
          onClick={onBack}
          className="flex items-center space-x-2 px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>返回</span>
        </button>
        
        <button
          onClick={startProcessing}
          disabled={processing}
          className="flex-1 flex items-center justify-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Play className="h-4 w-4" />
          <span>{processing ? '处理中...' : '开始处理'}</span>
        </button>
      </div>
    </div>
  );
};

export default ImageProcessor;
