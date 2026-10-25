// Headless CDP screenshot helper.
// usage: node tools/shot.mjs --url=http://127.0.0.1:5175/ --out=shots/a.png --wait=9000 \
//        [--eval="window.cv.app.setView('profile')"] [--width=1600] [--height=1000] [--port=9333]
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i === -1 ? [a.replace(/^--/, ""), true] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const url = args.url ?? "http://127.0.0.1:5175/";
const out = resolve(args.out ?? "shots/shot.png");
const wait = Number(args.wait ?? 9000);
const width = Number(args.width ?? 1600);
const height = Number(args.height ?? 1000);
const port = Number(args.port ?? 9333);
const chrome = args.chrome ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = resolve(args.profile ?? ".chrome-shot-profile");

mkdirSync(dirname(out), { recursive: true });

const proc = spawn(
  chrome,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-features=Translate,MediaRouter",
    "--hide-scrollbars",
    "--mute-audio",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    `--window-size=${width},${height}`,
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(path, method = "GET") {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
      if (res.ok) return await res.json();
    } catch {
      /* browser not up yet */
    }
    await sleep(250);
  }
  throw new Error(`CDP endpoint unavailable: ${path}`);
}

function rpc(ws, id, method, params = {}) {
  return new Promise((resolvePromise, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else resolvePromise(msg.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  await httpJson("/json/version");
  const target = await httpJson("/json/new?about:blank", "PUT");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });

  let nextId = 1;
  const call = (method, params) => rpc(ws, nextId++, method, params);

  const consoleLogs = [];
  ws.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(" ");
      consoleLogs.push(`[console.${msg.params.type}] ${text}`.slice(0, 1200));
    } else if (msg.method === "Runtime.exceptionThrown") {
      const details = msg.params.exceptionDetails;
      consoleLogs.push(
        `[exception] ${details.text} ${details.exception?.description ?? ""}`.slice(0, 2000),
      );
    }
  });

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.navigate", { url });

  // Wait for the app to report readiness, or fall back to a fixed delay.
  const deadline = Date.now() + wait;
  let ready = false;
  while (Date.now() < deadline) {
    await sleep(400);
    try {
      const probe = await call("Runtime.evaluate", {
        expression:
          "Boolean(window.cv && window.cv.ready && window.cv.ready()) && !document.hidden",
        returnByValue: true,
      });
      if (probe.result?.value) {
        ready = true;
        break;
      }
    } catch {
      /* page still navigating */
    }
  }
  if (ready) await sleep(Number(args.settle ?? 900));

  if (args.eval) {
    const result = await call("Runtime.evaluate", {
      expression: String(args.eval),
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      console.error("EVAL ERROR:", JSON.stringify(result.exceptionDetails).slice(0, 800));
    } else if (result.result?.value !== undefined) {
      console.log("EVAL:", JSON.stringify(result.result.value)?.slice(0, 400));
    }
    await sleep(Number(args.evalWait ?? 700));
  }

  const shot = await call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`shot -> ${out}${ready ? " (app ready)" : " (timeout fallback)"}`);

  const logs = await call("Runtime.evaluate", {
    expression: "JSON.stringify(window.__cvErrors || [])",
    returnByValue: true,
  });
  if (logs.result?.value && logs.result.value !== "[]") console.log("PAGE ERRORS:", logs.result.value);
  if (consoleLogs.length) {
    console.log("CONSOLE:");
    consoleLogs.slice(-25).forEach((line) => console.log("  " + line));
  }
  ws.close();
} finally {
  proc.kill();
  await sleep(300);
  if (existsSync(profile) && args.keepProfile !== "1") {
    // best-effort cleanup of the throwaway profile
    try {
      const { rmSync } = await import("node:fs");
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
