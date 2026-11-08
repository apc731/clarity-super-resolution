/**
 * 录一段 6 秒的真实演示（不是动画）：处理中的分块进度 → 结果页拖滑块 → 推到 200% 看细节。
 *
 * 用 Chrome DevTools Protocol 的 Page.startScreencast 抓真实画面，零第三方依赖。
 * 输出的是逐帧 JPEG + 时间戳，交给 scripts/encode_demo.py 编成 H.264 MP4。
 *
 *   先把应用跑起来：./start.ps1
 *   node scripts/record_demo.mjs --image samples/sunset-1728x1080.jpg
 *   python scripts/encode_demo.py
 */
import { spawn } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BASE = getArg("base", "http://127.0.0.1:8000");
const IMAGE = path.resolve(getArg("image", "samples/sunset-1728x1080.jpg"));
// 界面上会显示文件名，别让临时文件名进作品集视频
const AS = getArg("as", "sunset.jpg");
const WIDTH = Number(getArg("width", 1440));
const HEIGHT = Number(getArg("height", 900));
const SEG_A_MS = Number(getArg("processing", 2000));
const SEG_B_MS = Number(getArg("result", 4000));
const FRAMES_DIR = path.join(os.tmpdir(), "clarity-demo-frames");
const PORT = 9334;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      } else if (message.method) {
        for (const handler of this.handlers.get(message.method) ?? []) handler(message.params);
      }
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return result.result?.value;
  }

  async waitFor(expression, timeout = 240000, interval = 300) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await this.evaluate(expression)) return true;
      await sleep(interval);
    }
    throw new Error(`waitFor timeout: ${expression}`);
  }
}

async function connect(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (!page) throw new Error("还没有 page target");
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", reject, { once: true });
      });
      return ws;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome 的调试端口没起来");
}

async function mouse(cdp, type, x, y, buttons) {
  await cdp.send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: "left",
    buttons,
    clickCount: 1,
  });
}

async function dragSlider(cdp) {
  const rect = await cdp.evaluate(`(() => {
    const r = document.querySelector('.compare__canvas').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()`);
  if (!rect) throw new Error("找不到对比区");
  const y = rect.y + rect.h / 2;
  const at = (p) => rect.x + rect.w * p;

  await mouse(cdp, "mousePressed", at(0.5), y, 1);
  const pathPoints = [0.46, 0.38, 0.3, 0.22, 0.28, 0.42, 0.58, 0.72, 0.82, 0.76, 0.64, 0.52];
  for (const p of pathPoints) {
    await mouse(cdp, "mouseMoved", at(p), y, 1);
    await sleep(105);
  }
  await mouse(cdp, "mouseReleased", at(0.52), y, 0);
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!chrome) throw new Error("找不到 Chrome / Edge");
  if (!existsSync(IMAGE)) throw new Error(`找不到示例图片: ${IMAGE}`);

  await mkdir(FRAMES_DIR, { recursive: true });
  const profile = path.join(os.tmpdir(), `clarity-record-${Date.now()}`);
  const child = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let ws;
  try {
    ws = await connect(PORT);
    const cdp = new CDP(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });

    let frames = [];
    let startedAt = 0;
    let recording = false;
    cdp.on("Page.screencastFrame", (params) => {
      // 不 ack 的话 Chrome 只发一帧就停
      cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => undefined);
      if (recording) frames.push({ t: (Date.now() - startedAt) / 1000, data: params.data });
    });

    async function record(name, durationMs, action) {
      frames = [];
      startedAt = Date.now();
      recording = true;
      console.log(`[录] ${name} ${durationMs}ms`);
      if (action) await action();
      const remaining = durationMs - (Date.now() - startedAt);
      if (remaining > 0) await sleep(remaining);
      recording = false;
      const dir = path.join(FRAMES_DIR, name);
      await mkdir(dir, { recursive: true });
      for (let index = 0; index < frames.length; index += 1) {
        await writeFile(path.join(dir, `${String(index + 1).padStart(4, "0")}.jpg`), Buffer.from(frames[index].data, "base64"));
      }
      await writeFile(
        path.join(dir, "meta.json"),
        JSON.stringify({ duration: durationMs / 1000, times: frames.map((frame) => frame.t), count: frames.length }),
      );
      console.log(`     ${frames.length} 帧 -> ${dir}`);
    }

    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 88,
      maxWidth: WIDTH,
      maxHeight: HEIGHT,
      everyNthFrame: 1,
    });

    // 1) 上传并启动真实推理
    console.log("[1] 上传 + 开始处理");
    await cdp.send("Page.navigate", { url: `${BASE}/` });
    await cdp.waitFor("!!document.querySelector('.dropzone')");
    await sleep(600);
    const tempImage = path.join(os.tmpdir(), AS);
    await copyFile(IMAGE, tempImage);
    const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"]' });
    await cdp.send("DOM.setFileInputFiles", { nodeId, files: [tempImage] });
    await cdp.waitFor("!!document.querySelector('.picked')");
    await sleep(400);
    await cdp.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('开始处理')).click()");
    await cdp.waitFor("!!document.querySelector('.bar__fill')");
    // 等进度真的走起来（读百分比元素，不依赖文案格式）
    await cdp.waitFor("(() => { const e = document.querySelector('.progress-meta__pct'); return e && parseInt(e.textContent, 10) >= 20; })()", 120000, 120);

    // 2) 处理中：真实分块数字在涨
    await record("segA", SEG_A_MS);

    // 3) 结果页：拖滑块 + 推到 200%
    await cdp.waitFor("!!document.querySelector('.compare')", 240000);
    await sleep(900);
    await record("segB", SEG_B_MS, async () => {
      await sleep(600);
      await dragSlider(cdp);
      await sleep(350);
      for (let index = 0; index < 2; index += 1) {
        await cdp.evaluate("document.querySelector('.compare__tools button[title=\"放大\"]')?.click()");
        await sleep(420);
      }
    });

    await cdp.send("Page.stopScreencast");
    console.log(`[完成] 帧目录 ${FRAMES_DIR}，接着运行 python scripts/encode_demo.py`);
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    child.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
