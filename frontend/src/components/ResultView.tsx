import { downloadUrl, fileUrl, type TaskMeta, type TaskState, type UploadResult } from "../lib/api";
import { formatBytes, formatDimensions, formatDuration } from "../lib/utils";
import CompareSlider from "./CompareSlider";
import DetailPeek from "./DetailPeek";
import { ArrowUpRight, DownloadIcon, PlusIcon } from "./icons";

interface ResultViewProps {
  task: TaskState;
  upload: UploadResult;
  onRestart: () => void;
}

export default function ResultView({ task, upload, onRestart }: ResultViewProps) {
  const meta = task.meta as TaskMeta;
  const before = fileUrl(task.files.input) || upload.url;
  const after = fileUrl(task.files.preview) || fileUrl(task.files.result);
  const ratio = meta.output_width && meta.output_height ? meta.output_width / meta.output_height : 16 / 9;

  return (
    <section className="section container">
      <div className="result-bar">
        <div className="result-bar__title">
          <p className="eyebrow">处理完成</p>
          <span className="small" style={{ color: "var(--ink-3)" }}>
            {task.original_name}
          </span>
        </div>
        <div className="result-bar__actions">
          <a className="btn btn--primary" href={downloadUrl(task.files.result)} download>
            <DownloadIcon size={16} />
            下载原图 PNG · {formatBytes(task.bytes?.result)}
          </a>
          <a className="btn btn--ghost" href={downloadUrl(task.files.preview)} download>
            预览 JPG
          </a>
          <button type="button" className="btn btn--ghost" onClick={onRestart}>
            <PlusIcon size={15} />
            再处理一张
          </button>
        </div>
      </div>

      <CompareSlider
        beforeSrc={before}
        afterSrc={after}
        ratio={ratio}
        beforeMeta={formatDimensions(meta.source_width, meta.source_height)}
        afterMeta={formatDimensions(meta.output_width, meta.output_height)}
        caption="拖动圆点对比 · ⌘/Ctrl + 滚轮放大"
        initial={45}
      />

      <DetailPeek beforeSrc={before} afterSrc={after} />

      <dl className="specs">
        <div className="specs__item">
          <dt className="specs__key">输出尺寸</dt>
          <dd className="specs__value">{formatDimensions(meta.output_width, meta.output_height)}</dd>
        </div>
        <div className="specs__item">
          <dt className="specs__key">推理用时</dt>
          <dd className="specs__value">{formatDuration(meta.inference_seconds)}</dd>
        </div>
        <div className="specs__item">
          <dt className="specs__key">模型</dt>
          <dd className="specs__value">{String(meta.model).replace("RealESRGAN_", "")}</dd>
        </div>
        <div className="specs__item">
          <dt className="specs__key">放大倍数</dt>
          <dd className="specs__value">{meta.outscale}×</dd>
        </div>
        <div className="specs__item">
          <dt className="specs__key">分块</dt>
          <dd className="specs__value">{meta.tile > 0 ? `${meta.tile}px · ${task.tiles_total} 块` : "整图"}</dd>
        </div>
        <div className="specs__item">
          <dt className="specs__key">设备</dt>
          <dd className="specs__value">{String(meta.device).replace("NVIDIA ", "")}</dd>
        </div>
      </dl>

      <div className="chips" style={{ marginTop: 18 }}>
        <span className="chip">输入 {formatBytes(upload.size)}</span>
        <span className="chip">输出 {formatBytes(task.bytes?.result)}</span>
        <span className="chip">{task.params.face_enhance ? "含人脸修复" : "不含人脸修复"}</span>
        <a className="chip" href={downloadUrl(task.files.result)} download>
          原始 PNG <ArrowUpRight size={12} />
        </a>
      </div>
    </section>
  );
}
