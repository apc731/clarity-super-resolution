import { useCallback, useMemo, useRef, useState } from "react";
import { api, type HealthInfo, type ModelsResponse, type UploadResult } from "../lib/api";
import { formatBytes, formatDimensions, estimateSeconds, formatDuration } from "../lib/utils";
import { ArrowRight, CloseIcon, UploadIcon } from "./icons";

interface UploadViewProps {
  health: HealthInfo | null;
  models: ModelsResponse | null;
  onStarted: (taskId: string, upload: UploadResult) => void;
}

const SCALES = [2, 3, 4];

export default function UploadView({ health, models, onStarted }: UploadViewProps) {
  const [picked, setPicked] = useState<{ file: File; localUrl: string } | null>(null);
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string>(models?.default ?? "RealESRGAN_x4plus");
  const [scale, setScale] = useState(4);
  const [faceEnhance, setFaceEnhance] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const maxMb = health?.config.max_upload_mb ?? 20;
  const face = models?.face_enhance;
  const selectedModel = useMemo(() => models?.models.find((item) => item.name === model), [models, model]);

  const reset = useCallback(() => {
    if (picked) URL.revokeObjectURL(picked.localUrl);
    setPicked(null);
    setUploaded(null);
    setProgress(0);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [picked]);

  const acceptFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.type.startsWith("image/")) {
        setError("这是一个图片应用，请选择 JPG / PNG / WebP 之类的图片文件。");
        return;
      }
      if (file.size > maxMb * 1024 * 1024) {
        setError(`这张图有 ${formatBytes(file.size)}，超过 ${maxMb} MB 上限。可以先压一下再传。`);
        return;
      }

      if (picked) URL.revokeObjectURL(picked.localUrl);
      const localUrl = URL.createObjectURL(file);
      setPicked({ file, localUrl });
      setUploaded(null);
      setUploading(true);
      setProgress(0);

      try {
        const result = await api.upload(file, setProgress);
        setUploaded(result);
        if (models) {
          const recommended = models.models.find((item) => item.name === (models.default ?? model));
          if (recommended && !recommended.downloaded) {
            const fallback = models.models.find((item) => item.downloaded);
            if (fallback) setModel(fallback.name);
          }
        }
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "上传失败");
        reset();
      } finally {
        setUploading(false);
      }
    },
    [maxMb, model, models, picked, reset],
  );

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void acceptFile(file);
  };

  const start = async () => {
    if (!uploaded) return;
    setSubmitting(true);
    setError(null);
    try {
      const task = await api.createTask({
        file_id: uploaded.file_id,
        original_name: uploaded.original_name,
        model,
        outscale: scale,
        face_enhance: faceEnhance,
      });
      onStarted(task.task_id, uploaded);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "无法启动任务");
    } finally {
      setSubmitting(false);
    }
  };

  const estimate = uploaded ? estimateSeconds(uploaded.width, uploaded.height, scale) : null;
  const device = health?.device;

  return (
    <>
      <section className="hero">
        <span className="hero__eyebrow">
          <span className={`dot ${device?.ready ? "dot--live" : ""}`} />
          <span className="tiny" style={{ color: "var(--ink-2)" }}>
            {device?.ready
              ? `${device.name.replace("NVIDIA ", "")} · 本机推理`
              : "后端未连接 · 先启动服务"}
          </span>
        </span>
        <h1 className="display hero__title">把模糊的图，放大四倍。</h1>
        <p className="lede hero__lede">
          在你自己机器的显卡上跑真实的 Real-ESRGAN 推理。图片不出这台电脑，
          输出最高 4 倍分辨率的无损 PNG。
        </p>
      </section>

      <section className="container container--narrow" style={{ paddingBottom: 0 }}>
        <div className="card fade-in">
          <div className="card__body">
            {!picked ? (
              <div
                className={`dropzone ${dragActive ? "dropzone--active" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
                }}
              >
                <span className="dropzone__icon">
                  <UploadIcon size={20} />
                </span>
                <div>
                  <p className="dropzone__title">拖一张图进来，或者点击选择</p>
                  <p className="dropzone__hint" style={{ marginTop: 4 }}>
                    JPG / PNG / WebP · 单张最大 {maxMb} MB
                  </p>
                </div>
              </div>
            ) : (
              <div className="picked">
                <img className="picked__thumb" src={picked.localUrl} alt="" />
                <div className="picked__meta">
                  <p className="picked__name">{picked.file.name}</p>
                  <p className="picked__sub">
                    {uploaded
                      ? `${formatDimensions(uploaded.width, uploaded.height)} · ${formatBytes(picked.file.size)}`
                      : uploading
                        ? `上传中 ${Math.round(progress * 100)}%`
                        : "—"}
                  </p>
                </div>
                <button type="button" className="btn btn--quiet" onClick={reset} aria-label="重新选择">
                  <CloseIcon size={16} />
                </button>
              </div>
            )}

            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void acceptFile(file);
              }}
            />

            {error && (
              <div className="notice notice--error" style={{ marginTop: 16 }}>
                <span>{error}</span>
              </div>
            )}

            <div className="params">
              <div className="field field--wide">
                <label className="field__label" htmlFor="model-select">
                  模型
                </label>
                <select
                  id="model-select"
                  className="select"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  disabled={uploading}
                >
                  {(models?.models ?? []).map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.label}
                      {item.downloaded ? "" : `（需下载 ${item.download_size_mb} MB）`}
                    </option>
                  ))}
                </select>
                {selectedModel && (
                  <p className="tiny" style={{ marginTop: 6 }}>
                    {selectedModel.description}
                  </p>
                )}
              </div>

              <div className="field">
                <span className="field__label">放大倍数</span>
                <div className="segmented" role="group" aria-label="放大倍数">
                  {SCALES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`segmented__item ${scale === value ? "segmented__item--active" : ""}`}
                      onClick={() => setScale(value)}
                      aria-pressed={scale === value}
                    >
                      {value}×
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="field__label">
                  人脸修复
                  {face && !face.available && <span className="tiny">· 不可用</span>}
                </span>
                <button
                  type="button"
                  className={`switch ${faceEnhance ? "switch--on" : ""}`}
                  onClick={() => setFaceEnhance((value) => !value)}
                  disabled={!face?.available}
                  title={face?.available ? "先超分背景，再用 GFPGAN 修脸" : face?.reason}
                  aria-pressed={faceEnhance}
                >
                  <span className="switch__text">{faceEnhance ? "开启" : "关闭"}</span>
                  <span className="switch__track">
                    <span className="switch__thumb" />
                  </span>
                </button>
              </div>
            </div>

            <div className="submit-row">
              <p className="submit-row__hint">
                {selectedModel && !selectedModel.downloaded
                  ? `首次使用会先下载模型（${selectedModel.download_size_mb} MB）`
                  : estimate && uploaded
                    ? `按本机速度估算约 ${formatDuration(estimate)} · 输出 ${formatDimensions(uploaded.width * scale, uploaded.height * scale)}`
                    : "选中图片后会显示预计耗时"}
              </p>
              <button
                type="button"
                className="btn btn--primary btn--lg"
                onClick={start}
                disabled={!uploaded || uploading || submitting}
              >
                {submitting ? "正在提交…" : "开始处理"}
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </div>

        <div className="facts">
          <span className="facts__item">
            <span className="dot" />
            {device?.ready ? `${device.precision === "fp16" ? "fp16" : "fp32"} · 分块 ${health?.config.tile ?? 512}px` : "等待后端"}
          </span>
          <span className="facts__item">
            <span className="dot" />
            单进程 · 队列串行执行
          </span>
          <span className="facts__item">
            <span className="dot" />
            结果保留 {health?.config.task_keep_hours ?? 24} 小时
          </span>
        </div>
      </section>
    </>
  );
}
