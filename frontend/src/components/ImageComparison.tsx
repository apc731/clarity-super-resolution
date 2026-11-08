import React, { useState, useRef, useEffect } from 'react';
import { Download, Eye, EyeOff, RefreshCw, Plus, ArrowLeft, ZoomIn, ZoomOut, Maximize2, Grid, Layers } from 'lucide-react';

interface UploadedFile {
  file_id: string;
  filename: string;
  original_name: string;
  size: number;
  content_type: string;
}

interface ImageComparisonProps {
  originalFile: UploadedFile;
  resultUrl: string;
  onReset: () => void;
  onNewImage: () => void;
}

type ComparisonMode = 'side-by-side' | 'slider' | 'stacked';

const ImageComparison: React.FC<ImageComparisonProps> = ({
  originalFile,
  resultUrl,
  onReset,
  onNewImage,
}) => {
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('side-by-side');
  const [showComparison, setShowComparison] = useState<boolean>(true);
  const [sliderPosition, setSliderPosition] = useState<number>(50);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [imageScale, setImageScale] = useState<number>(1);
  const [showFullscreen, setShowFullscreen] = useState<boolean>(false);
  const [activeImage, setActiveImage] = useState<'original' | 'enhanced'>('enhanced');
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = (x / rect.width) * 100;
    setSliderPosition(Math.max(0, Math.min(100, percentage)));
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(resultUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `enhanced_${originalFile.original_name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const handleZoomIn = () => {
    setImageScale(prev => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setImageScale(prev => Math.max(prev - 0.25, 0.25));
  };

  const handleResetZoom = () => {
    setImageScale(1);
  };

  const toggleFullscreen = () => {
    setShowFullscreen(!showFullscreen);
  };

  return (
    <div className={`min-h-screen bg-gray-50 ${showFullscreen ? 'fixed inset-0 z-50 bg-black' : ''}`}>
      {/* 顶部控制栏 */}
      <div className={`${showFullscreen ? 'absolute top-0 left-0 right-0 z-10 bg-black' : 'bg-white border-b'} p-4`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* 对比模式切换 */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setComparisonMode('side-by-side')}
              className={`px-3 py-2 rounded-lg flex items-center space-x-2 transition-colors ${
                comparisonMode === 'side-by-side' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              <Grid className="h-4 w-4" />
              <span className="text-sm font-medium">并排对比</span>
            </button>
            <button
              onClick={() => setComparisonMode('slider')}
              className={`px-3 py-2 rounded-lg flex items-center space-x-2 transition-colors ${
                comparisonMode === 'slider' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              <Layers className="h-4 w-4" />
              <span className="text-sm font-medium">滑块对比</span>
            </button>
          </div>

          {/* 缩放控制 */}
          <div className="flex items-center space-x-2">
            <button
              onClick={handleZoomOut}
              disabled={imageScale <= 0.25}
              className="p-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="px-3 py-1 bg-gray-100 rounded-lg text-sm font-medium min-w-[60px] text-center">
              {Math.round(imageScale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              disabled={imageScale >= 3}
              className="p-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={handleResetZoom}
              className="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
            >
              重置
            </button>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center space-x-2">
            <button
              onClick={toggleFullscreen}
              className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
            >
              <Maximize2 className="h-4 w-4 inline mr-1" />
              {showFullscreen ? '退出全屏' : '全屏'}
            </button>
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
            >
              <Download className="h-4 w-4 inline mr-1" />
              下载结果
            </button>
            <button
              onClick={onReset}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
            >
              <RefreshCw className="h-4 w-4 inline mr-1" />
              重新处理
            </button>
            <button
              onClick={onNewImage}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
            >
              <Plus className="h-4 w-4 inline mr-1" />
              新图像
            </button>
          </div>
        </div>
      </div>

      {/* 主显示区域 */}
      <div className={`flex-1 ${showFullscreen ? 'pt-16' : 'pt-4'} pb-4 px-4`}>
        <div className="max-w-7xl mx-auto h-full">
          {/* 并排对比模式 */}
          {comparisonMode === 'side-by-side' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
              {/* 原图区域 */}
              <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                <div className="bg-gray-100 px-4 py-2 border-b">
                  <h3 className="text-sm font-medium text-gray-700">原图</h3>
                  <p className="text-xs text-gray-500">{originalFile.original_name}</p>
                </div>
                <div className="relative h-full min-h-[400px] flex items-center justify-center bg-gray-50">
                  <img
                    src={`/uploads/${originalFile.filename}`}
                    alt="原图"
                    className="max-w-full max-h-full object-contain"
                    style={{ 
                      transform: `scale(${activeImage === 'original' ? imageScale : 1})`,
                      transformOrigin: 'center',
                      transition: 'transform 0.2s ease-in-out'
                    }}
                    onMouseEnter={() => setActiveImage('original')}
                    onMouseLeave={() => setActiveImage('enhanced')}
                  />
                </div>
                <div className="bg-gray-100 px-4 py-2 border-t text-xs text-gray-500 text-center">
                  {(originalFile.size / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>

              {/* 增强图区域 */}
              <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                <div className="bg-blue-50 px-4 py-2 border-b">
                  <h3 className="text-sm font-medium text-blue-700">增强后</h3>
                  <p className="text-xs text-blue-500">AI超分辨率增强</p>
                </div>
                <div className="relative h-full min-h-[400px] flex items-center justify-center bg-gray-50">
                  <img
                    src={resultUrl}
                    alt="增强后"
                    className="max-w-full max-h-full object-contain"
                    style={{ 
                      transform: `scale(${activeImage === 'enhanced' ? imageScale : 1})`,
                      transformOrigin: 'center',
                      transition: 'transform 0.2s ease-in-out'
                    }}
                    onMouseEnter={() => setActiveImage('enhanced')}
                    onMouseLeave={() => setActiveImage('original')}
                  />
                </div>
                <div className="bg-blue-50 px-4 py-2 border-t text-xs text-blue-500 text-center">
                  Real-ESRGAN 处理完成
                </div>
              </div>
            </div>
          )}

          {/* 滑块对比模式 */}
          {comparisonMode === 'slider' && (
            <div className="h-full">
              <div 
                ref={containerRef}
                className="relative w-full h-full bg-white rounded-lg shadow-lg overflow-hidden cursor-ew-resize"
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onMouseMove={handleMouseMove}
                style={{ minHeight: '500px' }}
              >
                <div className="relative w-full h-full">
                  {/* 原图 */}
                  <img
                    src={`/uploads/${originalFile.filename}`}
                    alt="原图"
                    className="w-full h-full object-contain"
                    style={{ 
                      transform: `scale(${imageScale})`,
                      transformOrigin: 'center',
                      transition: 'transform 0.2s ease-in-out'
                    }}
                  />
                  
                  {/* 增强图 (显示右半部分) */}
                  <div 
                    className="absolute top-0 left-0 right-0 bottom-0 overflow-hidden"
                    style={{ 
                      clipPath: `inset(0 ${100 - sliderPosition}% 0 0)`
                    }}
                  >
                    <img
                      src={resultUrl}
                      alt="增强后"
                      className="w-full h-full object-contain"
                      style={{ 
                        transform: `scale(${imageScale})`,
                        transformOrigin: 'center',
                        transition: 'transform 0.2s ease-in-out'
                      }}
                    />
                  </div>
                  
                  {/* 滑块线 */}
                  <div 
                    className="absolute top-0 bottom-0 w-1 bg-white shadow-lg"
                    style={{ left: `${sliderPosition}%` }}
                  >
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-full p-3 shadow-lg">
                      <div className="flex space-x-1">
                        <div className="w-1 h-6 bg-gray-400"></div>
                        <div className="w-1 h-6 bg-gray-400"></div>
                      </div>
                    </div>
                  </div>
                  
                  {/* 标签 */}
                  <div className="absolute top-4 left-4 bg-black bg-opacity-50 text-white px-3 py-1 rounded">
                    原图
                  </div>
                  <div className="absolute top-4 right-4 bg-black bg-opacity-50 text-white px-3 py-1 rounded">
                    增强后
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部信息栏 - 仅在非全屏显示 */}
      {!showFullscreen && (
        <div className="bg-white border-t px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between text-sm text-gray-600">
            <div>
              <span className="font-medium">处理完成</span> • Real-ESRGAN AI超分辨率增强
            </div>
            <div>
              缩放: {Math.round(imageScale * 100)}% • 对比模式: {comparisonMode === 'side-by-side' ? '并排' : '滑块'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageComparison;
