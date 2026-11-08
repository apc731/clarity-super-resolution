/**
 * 用系统自带的 Chrome（CDP + 内置 WebSocket，零依赖）给应用拍一组作品集截图。
 *
 * 用法：
 *   1) 先把应用跑起来（./start.ps1，默认 http://127.0.0.1:8000）
 *   2) node scripts/shoot.mjs --image path/to/photo.jpg
 *
 * 产出：docs/screenshots/{01-home,02-processing,03-result,04-cases}.png（2× 像素密度）
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
const IMAGE = getArg("image", "");
const AS = getArg("as", "");
const OUT_DIR = path.resolve(getArg("out", "docs/screenshots"));
const WIDTH = Number(getArg("width", 1440));
const HEIGHT = Number(getArg("height", 900));
const SCALE = Number(getArg("scale", 2));
const SCROLL = Number(getArg("scroll", 0));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      }
    });
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
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.result?.value;
  }

  async waitFor(expression, timeout = 120000, interval = 400) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await this.evaluate(expression)) return true;
      await sleep(interval);
    }
    throw new Error(`waitFor timeout: ${expression}`);
  }

  async shot(filename) {
    await this.send("Page.enable");
    const { data } = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const target = path.join(OUT_DIR, filename);
    await writeFile(target, Buffer.from(data, "base64"));
    console.log(`  saved ${path.relative(process.cwd(), target)}`);
  }
}

async function connect(port) {
  const endpoint = `http://127.0.0.1:${port}/json/list`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (!page) throw new Error("还没有 page target");
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", reject, { once: true });
      });
      return { ws, target: page };
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Chrome 的调试端口没起来");
}

async function main() {
  const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!chrome) throw new Error("找不到 Chrome / Edge，无法截图");

  const EVAL_URL = getArg("url", "");
  const EVAL_EXPR = getArg("eval", "");

  await mkdir(OUT_DIR, { recursive: true });

  const port = 9333;
  const profile = path.join(process.env.TEMP || "/tmp", `shoot-${Date.now()}`);
  const child = spawn(
    chrome,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let cdp;
  try {
    const { ws } = await connect(port);
    cdp = new CDP(ws);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: false,
    });

    if (EVAL_URL) {
      await cdp.send("Page.navigate", { url: EVAL_URL });
      await sleep(1500);
      if (EVAL_EXPR) {
        const value = await cdp.evaluate(EVAL_EXPR);
        console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
      }
      await sleep(600);
      if (getArg("shot", "")) await cdp.shot(getArg("shot", ""));
      return;
    }

    console.log(`[1/4] 首页  ${BASE}`);
    await cdp.send("Page.navigate", { url: `${BASE}/` });
    await cdp.waitFor("!!document.querySelector('.dropzone')");
    await sleep(700);
    await cdp.shot("01-home.png");

    if (IMAGE) {
      console.log("[2/4] 上传并开始处理");
      let uploadPath = path.resolve(IMAGE);
      if (AS) {
        uploadPath = path.join(os.tmpdir(), AS);
        await copyFile(path.resolve(IMAGE), uploadPath);
      }
      const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: 'input[type="file"]',
      });
      if (!nodeId) throw new Error("页面上找不到 file input");
      await cdp.send("DOM.setFileInputFiles", { nodeId, files: [uploadPath] });
      await cdp.waitFor("!!document.querySelector('.picked') && !document.querySelector('.picked__sub')?.textContent.includes('上传中')");
      await sleep(500);
      await cdp.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.includes('开始处理')).click()");
      await cdp.waitFor("!!document.querySelector('.bar__fill')");
      await sleep(3200);
      await cdp.shot("02-processing.png");

      console.log("[3/4] 等结果");
      await cdp.waitFor("!!document.querySelector('.compare')", 240000);
      await sleep(1200);
      if (SCROLL) {
        await cdp.evaluate(`window.scrollTo(0, ${SCROLL})`);
        await sleep(450);
      }
      await cdp.shot("03-result.png");

      // 再补一张"1:1 细节 + 规格"的图，作品集里很好用
      await cdp.evaluate("document.querySelector('.peek')?.scrollIntoView({ block: 'center' })");
      await sleep(500);
      await cdp.shot("05-detail.png");
    }

    console.log("[4/4] 案例页");
    await cdp.send("Page.navigate", { url: `${BASE}/#/cases` });
    await cdp.waitFor("!!document.querySelector('.case')");
    await cdp.evaluate("window.scrollTo(0, 0)");
    await sleep(900);
    await cdp.shot("04-cases.png");

    console.log("完成");
  } finally {
    try {
      cdp?.ws.close();
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
