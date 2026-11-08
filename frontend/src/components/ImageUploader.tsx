import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, File, X, CheckCircle } from 'lucide-react';

interface UploadedFile {
  file_id: string;
  filename: string;
  original_name: string;
  size: number;
  content_type: string;
}

interface ImageUploaderProps {
  onFileUploaded: (file: UploadedFile) => void;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ onFileUploaded }) => {
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      setError('请上传图像文件');
      return;
    }

    // 验证文件大小 (10MB限制)
    if (file.size > 10 * 1024 * 1024) {
      setError('文件大小不能超过10MB');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('上传失败');
      }

      const result = await response.json();
      setUploadedFile(result);
      onFileUploaded(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }, [onFileUploaded]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp', '.bmp', '.tiff']
    },
    multiple: false,
    disabled: uploading || !!uploadedFile,
  });

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const resetUpload = () => {
    setUploadedFile(null);
    setError(null);
  };

  if (uploadedFile) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-center space-x-3">
            <CheckCircle className="h-6 w-6 text-green-600" />
            <div className="flex-1">
              <h3 className="text-lg font-medium text-green-900">上传成功</h3>
              <p className="text-sm text-green-700">{uploadedFile.original_name}</p>
              <p className="text-xs text-green-600">
                {formatFileSize(uploadedFile.size)} • {uploadedFile.content_type}
              </p>
            </div>
            <button
              onClick={resetUpload}
              className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div
        {...getRootProps()}
        className={`upload-area bg-white rounded-lg p-8 text-center cursor-pointer transition-all ${
          isDragActive ? 'dragover' : ''
        } ${uploading ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-400'}`}
      >
        <input {...getInputProps()} />
        
        {uploading ? (
          <div className="space-y-4">
            <div className="loading-spinner mx-auto"></div>
            <p className="text-lg text-gray-600">正在上传...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
              <Upload className="h-8 w-8 text-blue-600" />
            </div>
            
            {isDragActive ? (
              <div>
                <p className="text-lg font-medium text-blue-600">释放文件到这里</p>
                <p className="text-sm text-gray-500">开始上传图像</p>
              </div>
            ) : (
              <div>
                <p className="text-lg font-medium text-gray-900">
                  拖拽图像文件到这里，或点击选择文件
                </p>
                <p className="text-sm text-gray-500">
                  支持 JPG、PNG、WebP 等格式，最大 10MB
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center space-x-2">
            <X className="h-5 w-5 text-red-600" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <File className="h-8 w-8 text-blue-600 mb-2" />
          <h3 className="font-medium text-gray-900">多格式支持</h3>
          <p className="text-sm text-gray-600">支持常见的图像格式</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="h-8 w-8 text-blue-600 mb-2 flex items-center justify-center">
            ⚡
          </div>
          <h3 className="font-medium text-gray-900">快速上传</h3>
          <p className="text-sm text-gray-600">优化的上传体验</p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="h-8 w-8 text-blue-600 mb-2 flex items-center justify-center">
            🔒
          </div>
          <h3 className="font-medium text-gray-900">安全可靠</h3>
          <p className="text-sm text-gray-600">文件安全处理</p>
        </div>
      </div>
    </div>
  );
};

export default ImageUploader;
