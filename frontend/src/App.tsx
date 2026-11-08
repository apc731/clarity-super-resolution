import { useCallback, useEffect, useState } from "react";
import CasesPage from "./components/CasesPage";
import ProcessView from "./components/ProcessView";
import ResultView from "./components/ResultView";
import UploadView from "./components/UploadView";
import { api, STATIC_ONLY, type HealthInfo, type ModelsResponse, type TaskState, type UploadResult } from "./lib/api";
import { useHashRoute } from "./lib/utils";

type Phase = "idle" | "processing" | "result";

export default function App() {
  const [route, navigate] = useHashRoute();
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [backendDown, setBackendDown] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskState | null>(null);

  useEffect(() => {
    api
      .health()
      .then((info) => {
        setHealth(info);
        setBackendDown(false);
      })
      .catch(() => setBackendDown(true));
    api.models().then(setModels).catch(() => undefined);
  }, []);

  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const handleStarted = useCallback((nextTaskId: string, nextUpload: UploadResult) => {
    setUpload(nextUpload);
    setTaskId(nextTaskId);
    setTask(null);
    setPhase("processing");
    window.scrollTo({ top: 0 });
  }, []);

  const handleComplete = useCallback((finished: TaskState) => {
    setTask(finished);
    setPhase("result");
    window.scrollTo({ top: 0 });
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setUpload(null);
    setTaskId(null);
    setTask(null);
  }, []);

  const showCases = STATIC_ONLY ? true : route === "/cases";

  return (
    <div className="shell">
      <header className="site-header">
        <div className="container site-header__inner">
          <a className="brand" href="#/" onClick={(event) => {
            event.preventDefault();
            navigate("/");
          }}>
            <span className="brand__name">Clarity</span>
            <span className="brand__sep" />
            <span className="brand__sub">图像超分工作台</span>
          </a>

          <nav className="nav">
            {!STATIC_ONLY && (
              <a
                className={`nav__link ${!showCases ? "nav__link--active" : ""}`}
                href="#/"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("/");
                }}
              >
                工作台
              </a>
            )}
            <a
              className={`nav__link ${showCases ? "nav__link--active" : ""}`}
              href="#/cases"
              onClick={(event) => {
                event.preventDefault();
                navigate("/cases");
              }}
            >
              案例
            </a>
            {!STATIC_ONLY && health?.device.ready && (
              <span className="nav__hint">
                <span className="dot dot--live" />
                {backendDown ? "已断开" : "本地服务在线"}
              </span>
            )}
          </nav>
        </div>
      </header>

      <main>
        {showCases ? (
          <CasesPage onOpenStudio={STATIC_ONLY ? undefined : () => { navigate("/"); scrollTop(); }} />
        ) : (
          <>
            {phase === "idle" && <UploadView health={health} models={models} onStarted={handleStarted} />}
            {phase === "processing" && upload && taskId && (
              <ProcessView
                taskId={taskId}
                upload={upload}
                health={health}
                onComplete={handleComplete}
                onCancel={reset}
              />
            )}
            {phase === "result" && task && upload && <ResultView task={task} upload={upload} onRestart={reset} />}
          </>
        )}
      </main>

      <footer className="site-footer">
        <div className="container site-footer__inner">
          <span>
            Real-ESRGAN (BSD-3) · FastAPI · React + Vite · 全部推理在本地完成
          </span>
          <span style={{ display: "flex", gap: 16 }}>
            <span className="mono">v{health?.version ?? "2.0.0"}</span>
            {!STATIC_ONLY && (
              <a href="/docs" target="_blank" rel="noreferrer">
                API 文档
              </a>
            )}
          </span>
        </div>
      </footer>
    </div>
  );
}
