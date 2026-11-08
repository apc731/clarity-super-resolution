import React, { useState } from 'react';
import ImageUploader from './components/ImageUploader';
import ImageProcessor from './components/ImageProcessor';
import ImageComparison from './components/ImageComparison';
import { Upload, Image, Settings } from 'lucide-react';

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

function App() {
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [processingTask, setProcessingTask] = useState<ProcessingTask | null>(null);
  const [currentView, setCurrentView] = useState<'upload' | 'processing' | 'result'>('upload');

  const handleFileUploaded = (file: UploadedFile) => {
    setUploadedFile(file);
    setCurrentView('processing');
  };

  const handleProcessingComplete = (task: ProcessingTask) => {
    setProcessingTask(task);
    setCurrentView('result');
  };

  const handleReset = () => {
    setUploadedFile(null);
    setProcessingTask(null);
    setCurrentView('upload');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-600 p-2 rounded-lg">
                <Image className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Real-ESRGAN Web</h1>
                <p className="text-sm text-gray-500">AI图像超分辨率增强</p>
              </div>
            </div>
            <nav className="flex space-x-1">
              <button
                onClick={() => setCurrentView('upload')}
                className={`px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors ${
                  currentView === 'upload'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Upload className="h-4 w-4" />
                <span>上传</span>
              </button>
              <button
                onClick={() => setCurrentView('processing')}
                disabled={!uploadedFile}
                className={`px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors ${
                  currentView === 'processing'
                    ? 'bg-blue-100 text-blue-700'
                    : uploadedFile
                    ? 'text-gray-600 hover:bg-gray-100'
                    : 'text-gray-400 cursor-not-allowed'
                }`}
              >
                <Settings className="h-4 w-4" />
                <span>处理</span>
              </button>
              {processingTask && (
                <button
                  onClick={() => setCurrentView('result')}
                  className={`px-4 py-2 rounded-lg flex items-center space-x-2 transition-colors ${
                    currentView === 'result'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Image className="h-4 w-4" />
                  <span>结果</span>
                </button>
              )}
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentView === 'upload' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                上传图像进行AI增强
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                使用Real-ESRGAN技术，将低分辨率图像转换为高质量高分辨率图像。
                支持 JPG、PNG 等常见格式。
              </p>
            </div>
            <ImageUploader onFileUploaded={handleFileUploaded} />
          </div>
        )}

        {currentView === 'processing' && uploadedFile && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                图像处理设置
              </h2>
              <p className="text-lg text-gray-600">
                选择合适的模型和参数来增强您的图像
              </p>
            </div>
            <ImageProcessor
              uploadedFile={uploadedFile}
              onProcessingComplete={handleProcessingComplete}
              onBack={() => setCurrentView('upload')}
            />
          </div>
        )}

        {currentView === 'result' && processingTask && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                处理完成
              </h2>
              <p className="text-lg text-gray-600">
                您的图像已成功增强，可以查看和下载结果
              </p>
            </div>
            <ImageComparison
              originalFile={uploadedFile!}
              resultUrl={processingTask.result_url!}
              onReset={handleReset}
              onNewImage={() => setCurrentView('upload')}
            />
          </div>
        )}
      </main>

      <footer className="bg-white border-t mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-gray-500">
            <p>基于 Real-ESRGAN 技术构建 | AI图像超分辨率增强服务</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
