import { useEffect, useRef, useState } from "react";
import { api, API_BASE, type HealthInfo, type TaskState, type UploadResult } from "../lib/api";
import { formatClock, formatDimensions, formatDuration } from "../lib/utils";
import { CheckIcon, CloseIcon, SpinnerIcon } from "./icons";

interface ProcessViewProps {
  taskId: string;
  upload: UploadResult;
  health: HealthInfo | null;
  onComplete: (task: TaskState) => void;
  onCancel: () => void;
}

const STAGES: { key: string; label: string }[] = [
  { key: "model", label: "载入模型" },
  { key: "read", label: "读取图像" },
  { key: "upscale", label: "超分推理" },
  { key: "save", label: "写入结果" },
];

export default function ProcessView({ taskId, upload, health, onComplete, onCancel }: ProcessViewProps) {
  const [task, setTask] = useState<TaskState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const startedRef = useRef<number>(Date.now());
  const finishedRef = useRef(false);

  // 轮询：任务在服务端的工作线程里跑，这里只读状态，永远不会被推理卡住
  useEffect(() => {
    let timer: number | undefined;
    let disposed = false;

    const tick = async () => {
      try {
        const next = await api.task(taskId);
        if (disposed) return;
        setTask(next);
        if (next.status === "completed" && !finishedRef.current) {
          finishedRef.current = true;
          onComplete(next);
          return;
        }
        if (next.status === "failed" || next.status === "cancelled") {
          window.clearInterval(timer);
          return;
        }
      } catch {
        /* 偶尔一次网络抖动不打断轮询 */
      }
      timer = window.setTimeout(tick, 700);
    };

    void tick();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [onComplete, taskId]);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((Date.now() - startedRef.current) / 1000), 200);
    return () => window.clearInterval(timer);
  }, []);

  const cancel = async () => {
    setCancelling(true);
    try {
      await api.cancel(taskId);
    } catch {
      /* 任务刚好结束了也不算错 */
    } finally {
      onCancel();
    }
  };

  const stageIndex = task ? STAGES.findIndex((stage) => stage.key === task.stage) : -1;
  const running = !task || task.status === "queued" || task.status === "running";
  const queued = task?.status === "queued";
  const failed = task?.status === "failed";
  const progress = task?.progress ?? 0;
  const source = `${formatDimensions(upload.width, upload.height)}`;
  const scale = task?.params.outscale ?? 4;
  const target = `${formatDimensions(Math.round(upload.width * scale), Math.round(upload.height * scale))}`;

  return (
    <section className="section container container--narrow">
      <div className="card fade-in">
        <div className="process">
          <div>
            <div className="process__preview">
              <img src={`${API_BASE}${upload.url}`} alt="正在处理的图" />
              <div className="process__preview-label">
                <span>{upload.original_name}</span>
                <span>{source}</span>
              </div>
            </div>
          </div>

          <div>
            <div className="progress-head">
              <div>
                <p className="eyebrow">{queued ? "排队中" : failed ? "处理失败" : "正在处理"}</p>
                <h2 className="title" style={{ marginTop: 8 }}>
                  {queued ? "前面的任务还在跑" : failed ? "这一步没跑通" : "AI 正在补细节"}
                </h2>
              </div>
              <div className="progress-head__elapsed">
                <strong>{formatClock(elapsed)}</strong>
                <span className="tiny">已用时间</span>
              </div>
            </div>

            {failed ? (
              <div className="notice notice--error">
                <span>{task?.error ?? "未知错误"}</span>
              </div>
            ) : (
              <>
                <div className="bar">
                  <div className="bar__fill" style={{ width: `${Math.max(progress, 2)}%` }} />
                </div>
                <div className="progress-meta">
                  <span>{task?.stage_label ?? "准备中"}</span>
                  <span>
                    <span className="progress-meta__pct num">{progress}%</span>
                    {task && task.tiles_total > 0 && (
                      <span className="num" style={{ color: "var(--ink-3)" }}>
                        {"  ·  "}第 {task.tiles_done} / {task.tiles_total} 块
                      </span>
                    )}
                    {task?.eta_seconds != null && task.eta_seconds > 0 && (
                      <span style={{ color: "var(--ink-3)" }}> · 还需约 {formatDuration(task.eta_seconds)}</span>
                    )}
                  </span>
                </div>
              </>
            )}

            <ul className="stages">
              {STAGES.map((stage, index) => {
                const state =
                  failed && index === stageIndex
                    ? "active"
                    : stageIndex > index || task?.status === "completed"
                      ? "done"
                      : stageIndex === index
                        ? "active"
                        : "pending";
                return (
                  <li key={stage.key} className={`stage stage--${state}`}>
                    <span className="stage__mark">{state === "done" ? <CheckIcon size={10} /> : null}</span>
                    <span>{stage.label}</span>
                    <span className="stage__time">
                      {state === "active" && running ? <SpinnerIcon size={13} /> : state === "done" ? "完成" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="chips">
              <span className="chip">{task?.params.model ?? "RealESRGAN_x4plus"}</span>
              <span className="chip">{task?.params.outscale ?? 4}× 输出</span>
              <span className="chip">目标 {target}</span>
              {health?.device.cuda && <span className="chip">{health.device.precision} · tile {health.config.tile}</span>}
              {task?.params.face_enhance && <span className="chip">人脸修复</span>}
            </div>

            <div className="submit-row" style={{ marginTop: 24 }}>
              <p className="submit-row__hint">推理在服务端工作线程里跑，刷新页面也不会中断任务。</p>
              <button type="button" className="btn btn--ghost" onClick={cancel} disabled={cancelling}>
                <CloseIcon size={15} />
                {failed ? "换一张" : "取消"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="tiny" style={{ textAlign: "center", marginTop: 18 }}>
        分块推理（{health?.config.tile ?? 512}px）把显存占用压在几百 MB，1080p 一张约 10 秒。
      </p>
    </section>
  );
}
