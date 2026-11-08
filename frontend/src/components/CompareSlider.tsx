import { useCallback, useEffect, useRef, useState } from "react";
import { ResetIcon, SliderIcon, SplitIcon, ZoomInIcon, ZoomOutIcon } from "./icons";

interface CompareSliderProps {
  beforeSrc: string;
  afterSrc: string;
  /** 宽 / 高，用来在图片解码前占位，避免布局跳动 */
  ratio: number;
  beforeLabel?: string;
  afterLabel?: string;
  beforeMeta?: string;
  afterMeta?: string;
  caption?: string;
  initial?: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;

export default function CompareSlider({
  beforeSrc,
  afterSrc,
  ratio,
  beforeLabel = "原图",
  afterLabel = "增强后",
  beforeMeta,
  afterMeta,
  caption,
  initial = 50,
}: CompareSliderProps) {
  const [position, setPosition] = useState(initial);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [mode, setMode] = useState<"slider" | "split">("slider");
  const [dragging, setDragging] = useState<"slider" | "pan" | null>(null);
  const [interacted, setInteracted] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ kind: "slider" | "pan"; x: number; y: number; originX: number; originY: number } | null>(
    null,
  );

  const clampOffset = useCallback((next: { x: number; y: number }, currentScale: number) => {
    const canvas = canvasRef.current;
    if (!canvas || currentScale <= 1) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const maxX = (rect.width * (currentScale - 1)) / 2;
    const maxY = (rect.height * (currentScale - 1)) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, []);

  const zoomTo = useCallback(
    (nextScale: number, focal?: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(nextScale.toFixed(2))));
      if (!canvas) {
        setScale(clamped);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const focalPoint = focal ?? { x: rect.width / 2, y: rect.height / 2 };
      const change = clamped / scale;
      const nextOffset = {
        x: focalPoint.x - (focalPoint.x - offset.x) * change,
        y: focalPoint.y - (focalPoint.y - offset.y) * change,
      };
      setScale(clamped);
      setOffset(clamped === 1 ? { x: 0, y: 0 } : clampOffset(nextOffset, clamped));
      setInteracted(true);
    },
    [clampOffset, offset, scale],
  );

  const updateSliderFromClientX = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const percent = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, percent)));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    const handleX = rect.left + (position / 100) * rect.width;
    const nearHandle = Math.abs(event.clientX - handleX) < 26;

    if (scale > 1 && !nearHandle) {
      dragRef.current = { kind: "pan", x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y };
      setDragging("pan");
    } else {
      dragRef.current = { kind: "slider", x: event.clientX, y: event.clientY, originX: 0, originY: 0 };
      setDragging("slider");
      if (!nearHandle) updateSliderFromClientX(event.clientX);
    }
    setInteracted(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "slider") {
      updateSliderFromClientX(event.clientX);
      return;
    }
    setOffset(
      clampOffset(
        { x: drag.originX + (event.clientX - drag.x), y: drag.originY + (event.clientY - drag.y) },
        scale,
      ),
    );
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragging(null);
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    zoomTo(scale * (event.deltaY < 0 ? 1.12 : 0.89), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && scale > 1) {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scale]);

  const layerStyle: React.CSSProperties = {
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transition: dragging ? "none" : "transform 0.18s cubic-bezier(0.22,0.61,0.36,1)",
  };

  const tools = (
    <div className="compare__tools" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={`tool ${mode === "slider" ? "tool--active" : ""}`}
        onClick={() => setMode("slider")}
        title="滑块对比（同一区域左右对照）"
      >
        <SliderIcon size={15} />
      </button>
      <button
        type="button"
        className={`tool ${mode === "split" ? "tool--active" : ""}`}
        onClick={() => setMode("split")}
        title="并排对比"
      >
        <SplitIcon size={15} />
      </button>
      {mode === "slider" && (
        <div className="compare__tools-zoom">
          <span className="compare__tools-sep" />
          <button type="button" className="tool" onClick={() => zoomTo(scale - 0.5)} disabled={scale <= MIN_SCALE} title="缩小">
            <ZoomOutIcon size={15} />
          </button>
          <span className="tool__zoom">{Math.round(scale * 100)}%</span>
          <button type="button" className="tool" onClick={() => zoomTo(scale + 0.5)} disabled={scale >= MAX_SCALE} title="放大">
            <ZoomInIcon size={15} />
          </button>
          <button
            type="button"
            className="tool"
            onClick={() => {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            }}
            disabled={scale === 1}
            title="复原（Esc）"
          >
            <ResetIcon size={15} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="compare"
      style={
        mode === "slider"
          ? // 竖图时整个对比区（含底部信息条）跟着图片比例收缩，而不是缩在宽盒子里
            { maxWidth: `calc(min(74vh, 700px) * ${ratio})`, marginInline: "auto" }
          : undefined
      }
    >
      {mode === "slider" ? (
        <div
          ref={canvasRef}
          className={[
            "compare__canvas",
            scale > 1 ? "compare__canvas--zoomed" : "",
            dragging === "pan" ? "compare__canvas--dragging" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ aspectRatio: ratio, maxHeight: "min(74vh, 700px)" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={endDrag}
          onWheel={onWheel}
          role="img"
          aria-label={`${beforeLabel}与${afterLabel}的对比`}
        >
          <div className="compare__layer" style={layerStyle}>
            <img src={beforeSrc} alt={beforeLabel} draggable={false} />
          </div>
          <div className="compare__clip" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
            <div className="compare__layer" style={layerStyle}>
              <img src={afterSrc} alt={afterLabel} draggable={false} />
            </div>
          </div>

          <div className="compare__handle" style={{ left: `${position}%` }}>
            <span className="compare__grip">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 6-4 6 4 6M15 6l4 6-4 6" />
              </svg>
            </span>
          </div>
          <span className="compare__tag compare__tag--left">{beforeLabel}</span>
          <span className="compare__tag compare__tag--right">{afterLabel}</span>

          {!interacted && (
            <span className="compare__hint">
              <SliderIcon size={13} /> 拖动圆点对比
            </span>
          )}

          {tools}
        </div>
      ) : (
        <div className="compare__pair">
          <figure className="compare__pane">
            <img src={beforeSrc} alt={beforeLabel} draggable={false} />
            <figcaption>{beforeLabel}</figcaption>
          </figure>
          <figure className="compare__pane">
            <img src={afterSrc} alt={afterLabel} draggable={false} />
            <figcaption>{afterLabel}</figcaption>
          </figure>
          {tools}
        </div>
      )}

      <div className="compare__legend">
        <span>{caption}</span>
        <span className="compare__legend-meta">
          {beforeMeta && <>{beforeMeta}</>}
          {beforeMeta && afterMeta && <span className="compare__legend-dot" />}
          {afterMeta && <>{afterMeta}</>}
        </span>
      </div>
    </div>
  );
}
