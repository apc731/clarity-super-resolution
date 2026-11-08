import { useEffect, useState } from "react";

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}

/** 00:12 这种表格式计时，处理中每帧都在动，用户能看出"没死"。 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatDimensions(width?: number | null, height?: number | null): string {
  if (!width || !height) return "—";
  return `${width} × ${height}`;
}

export function megabytesOfPixels(width: number, height: number): number {
  return (width * height) / 1_000_000;
}

/**
 * 估算耗时：按本机实测吞吐线性外推。
 * 数字来自 README 里记录的一次真实测量（RTX 3060 / tile 512 / fp16），
 * 只用来在点击前给个"心里有数"，跑起来后会换成真实进度。
 */
export const MEASURED_SECONDS_PER_MEGAPIXEL = 5.5;

export function estimateSeconds(width: number, height: number, outscale: number): number {
  const megapixels = megabytesOfPixels(width, height);
  return Math.max(1, Math.round(megapixels * MEASURED_SECONDS_PER_MEGAPIXEL * (outscale >= 4 ? 1 : 0.6)));
}

/** 极简 hash 路由：#/ 与 #/cases，够用且静态托管零配置。 */
export function useHashRoute(): [string, (path: string) => void] {
  const read = () => window.location.hash.replace(/^#/, "") || "/";
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (path: string) => {
    if (read() !== path) window.location.hash = path;
    else setRoute(path);
  };

  return [route, navigate];
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
