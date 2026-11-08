/** 后端接口的类型与调用封装。所有 URL 都由后端给出，前端不拼路径。 */

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
export const STATIC_ONLY = import.meta.env.VITE_STATIC_ONLY === "1";

export interface DeviceInfo {
  ready: boolean;
  cuda: boolean;
  name: string;
  torch?: string;
  precision?: string;
  vram_gb?: number;
  realesrgan_root?: string;
  reason?: string;
}

export interface ModelInfo {
  name: string;
  label: string;
  description: string;
  scale: number;
  recommended: boolean;
  downloaded: boolean;
  download_size_mb: number;
}

export interface FaceEnhanceInfo {
  available: boolean;
  reason?: string;
  downloaded?: boolean;
  download_size_mb?: number;
  max_upscale?: number;
}

export interface HealthInfo {
  status: string;
  version: string;
  device: DeviceInfo;
  queue: number;
  config: {
    tile: number;
    half: boolean;
    max_upload_mb: number;
    max_input_pixels: number;
    allowed_exts: string[];
    task_keep_hours: number;
  };
}

export interface ModelsResponse {
  models: ModelInfo[];
  default: string;
  face_enhance: FaceEnhanceInfo;
  device: DeviceInfo;
}

export interface UploadResult {
  file_id: string;
  filename: string;
  original_name: string;
  format: string;
  size: number;
  width: number;
  height: number;
  url: string;
}

export interface TaskMeta {
  model: string;
  outscale: number;
  face_enhance: boolean;
  source_width: number;
  source_height: number;
  output_width: number;
  output_height: number;
  inference_seconds: number;
  device: string;
  tile: number;
}

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TaskState {
  task_id: string;
  original_name: string;
  status: TaskStatus;
  stage: string;
  stage_label: string;
  progress: number;
  tiles_done: number;
  tiles_total: number;
  eta_seconds: number | null;
  params: { model: string; outscale: number; face_enhance: boolean };
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  elapsed_seconds: number;
  meta: TaskMeta | Record<string, never>;
  files: {
    input: string | null;
    result: string | null;
    preview: string | null;
    thumbnail: string | null;
  };
  bytes?: Record<string, number | null>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    let detail = `请求失败（${response.status}）`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      /* 后端返回的不是 JSON，用状态码兜底 */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => request<HealthInfo>("/api/health"),
  models: () => request<ModelsResponse>("/api/models"),

  upload(file: File, onProgress?: (ratio: number) => void): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/api/uploads`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as UploadResult);
          } catch {
            reject(new Error("上传响应无法解析"));
          }
        } else {
          let detail = `上传失败（${xhr.status}）`;
          try {
            const body = JSON.parse(xhr.responseText) as { detail?: string };
            if (body?.detail) detail = body.detail;
          } catch {
            /* ignore */
          }
          reject(new Error(detail));
        }
      };
      xhr.onerror = () => reject(new Error("网络中断，上传失败"));
      xhr.send(form);
    });
  },

  createTask(input: {
    file_id: string;
    original_name: string;
    model: string;
    outscale: number;
    face_enhance: boolean;
  }): Promise<{ task_id: string; status: string; queue_position: number }> {
    return request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },

  task: (taskId: string) => request<TaskState>(`/api/tasks/${taskId}`),

  cancel: (taskId: string) => request<{ status: string }>(`/api/tasks/${taskId}/cancel`, { method: "POST" }),

  remove: (taskId: string) => request<{ deleted: boolean }>(`/api/tasks/${taskId}`, { method: "DELETE" }),
};

/** 结果文件的绝对地址（渲染 <img> 用）。 */
export function fileUrl(path: string | null): string {
  return path ? `${API_BASE}${path}` : "";
}

export function downloadUrl(path: string | null): string {
  return path ? `${API_BASE}${path}?download=1` : "";
}
