// Attaches, reloads the app fresh, waits, and prints any captured error with FULL stacks.
const http = require("http");

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

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      console.log("\n=== EXCEPTION ===");
      console.log(d.exception?.description || d.text);
      if (d.stackTrace) {
        d.stackTrace.callFrames.slice(0, 8).forEach((f) =>
          console.log(`  at ${f.functionName || "?"} ${f.url}:${f.lineNumber}`),
        );
      }
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      console.log("\n=== CONSOLE ERROR ===");
      msg.params.args.forEach((a) => {
        console.log(a.value ?? a.description ?? JSON.stringify(a.preview?.properties?.map((p) => `${p.name}:${p.value}`) ?? a));
      });
      if (msg.params.stackTrace) {
        msg.params.stackTrace.callFrames.slice(0, 6).forEach((f) =>
          console.log(`  at ${f.functionName || "?"} ${f.url}:${f.lineNumber}`),
        );
      }
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

  await send("Runtime.enable");
  await send("Page.enable");

  console.log("reloading page fresh...");
  await send("Page.reload", { ignoreCache: true });
  await sleep(4000);

  const probe = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      h1: document.querySelector('h1')?.textContent,
      navLinks: document.querySelectorAll('nav a').length,
      cards: document.querySelectorAll('.nm-raised').length,
      rootChildren: document.getElementById('root')?.children.length ?? 0,
    })`,
    returnByValue: true,
  });
  console.log("\nrender probe:", probe.result.value);
  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(2);
});
