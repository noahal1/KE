// Verifies dark neumorphism styling across routes and captures screenshots.
const http = require("http");
const fs = require("fs");

const CDP_PORT = 9333;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(JSON.parse(data)));
      })
      .on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const page = targets.find((t) => t.type === "page" && t.url.includes("1420"));
  if (!page) throw new Error("no page target");
  console.log("attached:", page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let msgId = 0;
  const pending = new Map();
  const issues = [];

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      issues.push(msg.params.exceptionDetails.exception?.description || "exception");
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (!text.includes("favicon")) issues.push(text);
    }
  };

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, (msg) => {
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expr) {
    const res = await send("Runtime.evaluate", {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "eval failed");
    return res.result.value;
  }

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setCPUThrottlingRate", { rate: 1 });

  fs.mkdirSync("shots", { recursive: true });

  const routes = ["/", "/plans", "/workout", "/history", "/stats", "/settings"];
  let styleOK = true;

  for (const r of routes) {
    await evaluate(`location.hash = "#${r}"`);
    await sleep(1000);

    // style audit on this route
    const audit = await evaluate(
      `(() => {
        const bodyBg = getComputedStyle(document.body).backgroundColor;
        const offenders = [...document.querySelectorAll('*')].filter((el) => {
          const cs = getComputedStyle(el);
          const bg = cs.backgroundColor;
          return bg === 'rgb(255, 255, 255)' || bg === 'rgb(0, 0, 0)';
        }).length;
        const raised = document.querySelectorAll('.nm-raised, .nm-card, .nm-raised-lg, .nm-inset, .nm-btn, .nm-btn-primary, .nm-btn-success, .nm-chip, .nm-nav-active').length;
        return JSON.stringify({ bodyBg, whiteOrBlackEls: offenders, nmElements: raised });
      })()`,
    );
    const a = JSON.parse(audit);
    const ok = a.bodyBg === "rgb(43, 48, 55)" && a.whiteOrBlackEls === 0;
    if (!ok) styleOK = false;
    console.log(`${r} -> bg=${a.bodyBg} offenders=${a.whiteOrBlackEls} nm-elements=${a.nmElements} ${ok ? "OK" : "STYLE FAIL"}`);

    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(`shots/route${r.replace(/\//g, "_") || "_root"}.png`, Buffer.from(shot.data, "base64"));
  }

  console.log(issues.length === 0 ? "\nNO RUNTIME ERRORS" : `\nISSUES: ${issues.length}`);
  issues.slice(0, 5).forEach((i) => console.log(" -", i.split("\n")[0].slice(0, 150)));
  console.log(styleOK ? "DARK STYLE VERIFIED ✅" : "STYLE VIOLATIONS FOUND ❌");
  ws.close();
  process.exit(styleOK && issues.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(2);
});
