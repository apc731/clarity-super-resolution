import { useMemo } from "react";
import casesData from "../data/cases.json";
import { formatBytes, formatDimensions, formatDuration } from "../lib/utils";
import CompareSlider from "./CompareSlider";
import DetailPeek from "./DetailPeek";
import { ArrowRight } from "./icons";

interface CaseEntry {
  slug: string;
  title: string;
  note: string;
  before: string;
  after: string;
  model: string;
  outscale: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  inferenceSeconds: number;
  tiles: number;
  tileSize: number;
  device: string;
  resultBytes: number | null;
  focus?: { x: number; y: number };
}

const cases = casesData as CaseEntry[];

// 案例素材放在 public/cases，路径要跟着 Vite 的 base 走（子目录部署时才不会 404）
const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

const STEPS = [
  {
    title: "上传就先校验",
    text: "用 Pillow 真正解码一次拿尺寸，按格式白名单、体积上限、像素上限三道拦。伪造扩展名的文件在这一步就进不来。",
  },
  {
    title: "分块推理",
    text: "512px 一块、10px 重叠、fp16。分块不是为了省事：同一张 1080p，整图推理 152.8 秒（显存放不下），分块后 10 秒。",
  },
  {
    title: "一次任务三种规格",
    text: "无损 PNG 原图、2048px 预览 JPEG、480px 缩略 WebP。前端要的那一个由服务端给地址，不靠前端拼路径。",
  },
  {
    title: "进度是真的",
    text: "推理跑在服务端独立工作线程，事件循环不被阻塞。前端每 0.7 秒读一次真实分块序号和剩余时间，不是假动画。",
  },
];

export default function CasesPage({ onOpenStudio }: { onOpenStudio?: () => void }) {
  const totals = useMemo(() => {
    const seconds = cases.reduce((sum, item) => sum + item.inferenceSeconds, 0);
    const megapixels = cases.reduce((sum, item) => sum + item.outputWidth * item.outputHeight, 0) / 1_000_000;
    return { seconds, megapixels };
  }, []);

  return (
    <>
      <section className="section container">
        <p className="eyebrow">真实产物 · 页面不做推理</p>
        <h1 className="display" style={{ maxWidth: 760, marginTop: 14 }}>
          这些图，是这台机器算出来的。
        </h1>
        <p className="lede" style={{ maxWidth: 620, marginTop: 18 }}>
          下面每一组都由本仓库的代码真实跑出：源图进，四倍图出。推理留在本地，
          这个页面只负责把结果摊开给你看。
        </p>
        <div className="facts" style={{ justifyContent: "flex-start", marginTop: 26 }}>
          <span className="facts__item">
            <span className="dot" />
            {cases.length} 组真机结果
          </span>
          <span className="facts__item">
            <span className="dot" />
            RTX 3060 Laptop · fp16
          </span>
          <span className="facts__item">
            <span className="dot" />
            合计 {formatDuration(totals.seconds)} · {Math.round(totals.megapixels)} MP 输出
          </span>
        </div>
      </section>

      <section className="container">
        {cases.map((item, index) => (
          <article className="case" key={item.slug}>
            <div className="case__head">
              <div className="case__title">
                <span className="case__index">{String(index + 1).padStart(2, "0")}</span>
                <h2 className="heading">{item.title}</h2>
              </div>
              <div className="case__specs">
                <span>
                  {formatDimensions(item.sourceWidth, item.sourceHeight)} →{" "}
                  {formatDimensions(item.outputWidth, item.outputHeight)}
                </span>
                <span>{formatDuration(item.inferenceSeconds)}</span>
                <span>{item.tiles} 块</span>
                <span>{formatBytes(item.resultBytes)} PNG</span>
              </div>
            </div>
            <CompareSlider
              beforeSrc={asset(item.before)}
              afterSrc={asset(item.after)}
              ratio={item.sourceWidth / item.sourceHeight}
              beforeMeta={formatDimensions(item.sourceWidth, item.sourceHeight)}
              afterMeta={formatDimensions(item.outputWidth, item.outputHeight)}
              caption="拖动圆点对比 · ⌘/Ctrl + 滚轮放大"
            />
            <DetailPeek beforeSrc={asset(item.before)} afterSrc={asset(item.after)} focus={item.focus} />
            <p className="small" style={{ marginTop: 12, maxWidth: 680 }}>
              {item.note}
            </p>
          </article>
        ))}
      </section>

      <section className="section container">
        <p className="eyebrow">管线</p>
        <h2 className="title" style={{ marginTop: 12, marginBottom: 22 }}>
          从一张图到一张四倍图
        </h2>
        <div className="steps">
          {STEPS.map((step, index) => (
            <div className="step" key={step.title}>
              <p className="step__index">{String(index + 1).padStart(2, "0")}</p>
              <p className="step__title">{step.title}</p>
              <p className="step__text">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section container">
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 28 }}>
          <div>
            <p className="eyebrow">取舍</p>
            <h2 className="title" style={{ marginTop: 12 }}>
              为什么不做成在线服务
            </h2>
            <div className="prose" style={{ marginTop: 16 }}>
              <p>
                算过账：Vercel 的 Serverless 给 Python 依赖的空间是 500 MB，而 <strong>torch 一家就超过这个数</strong>，
                而且没有 GPU。换浏览器内推理（WebGPU / WASM 跑量化模型）能纯静态部署，代价是画质和速度同时掉一档——
                访客点开看到一个又慢又糊的结果，比看不到链接更伤。
              </p>
              <p>
                所以定位很清楚：<strong>推理在本地，线上只放真实产物</strong>。你现在看到的每张对比图，都是本地跑完之后
                把结果搬过来的。这个页面的价值不是"能算"，而是"能证明它真的算过"。
              </p>
            </div>

            <div className="qty">
              <div>
                <p className="qty__value">152.8 → 10.0 秒</p>
                <p className="qty__key">同一张 1080p，整图推理 vs 512px 分块</p>
              </div>
              <div>
                <p className="qty__value">54.9 dB</p>
                <p className="qty__key">分块结果与整图结果的 PSNR（肉眼无差）</p>
              </div>
              <div>
                <p className="qty__value">6912 × 4320</p>
                <p className="qty__key">单张最大输出，无损 PNG 27 MB</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section container">
        <div className="card">
          <div className="card__body" style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 className="heading">自己跑一遍</h2>
              <p className="small" style={{ marginTop: 6, maxWidth: 460 }}>
                需要一张能跑 CUDA 的显卡。装好依赖后，仓库根目录一条命令起服务，前后端一起。
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
              <code className="code-block">
                <span className="code-block__comment"># Windows</span>
                <span>./start.ps1</span>
                <span className="code-block__comment"># macOS / Linux</span>
                <span>./start.sh</span>
              </code>
              <a
                className="link-arrow"
                href="https://github.com/apc731/clarity-super-resolution"
                target="_blank"
                rel="noreferrer"
              >
                在 GitHub 看源码 <ArrowRight size={15} />
              </a>
              {onOpenStudio && (
                <button type="button" className="link-arrow" onClick={onOpenStudio}>
                  回到工作台 <ArrowRight size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
