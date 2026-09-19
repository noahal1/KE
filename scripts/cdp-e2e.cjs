// Attaches to the running FitPlan app via WebView2 remote debugging (CDP),
// walks every route, exercises the real SQL plugin through window.__TAURI__,
// and reports console errors / unhandled exceptions.
const http = require("http");

const CDP_PORT = 9333;
const DB = "sqlite:fitplan.db";

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
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target: " + JSON.stringify(targets.map((t) => t.type)));
  console.log("attached to:", page.title, page.url);

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
      const d = msg.params.exceptionDetails;
      const text = d.exception?.description || d.text;
      issues.push("EXCEPTION: " + text);
      console.log("\n[EXCEPTION]", text, "\n");
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      issues.push("CONSOLE ERROR: " + text);
      console.log("\n[CONSOLE ERROR]", text, "\n");
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      const text = msg.params.entry.text;
      if (!text.includes("DevTools")) {
        issues.push("LOG ERROR: " + text);
        console.log("\n[LOG ERROR]", text, "\n");
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

  async function evaluate(expr) {
    const res = await send("Runtime.evaluate", {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(
        "evaluate failed: " +
          (d.exception?.description || d.exception?.value || d.text || "unknown") +
          " | expr: " +
          expr.slice(0, 120),
      );
    }
    return res.result.value;
  }

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");

  // Detect the SQL API shape available in the global bundle
  const apiShape = await evaluate(
    `JSON.stringify({
      sql: typeof window.__TAURI__.sql,
      keys: window.__TAURI__.sql ? Object.keys(window.__TAURI__.sql) : null,
      hasDefault: !!(window.__TAURI__.sql && window.__TAURI__.sql.default),
    })`,
  );
  console.log("tauri sql api:", apiShape);

  async function makeDb() {
    const shape = JSON.parse(apiShape);
    if (shape.hasDefault) {
      return evaluate(
        `window.__TAURI__.sql.default.load('${DB}').then((d) => { window.__db = d; return 'loaded'; })`,
      );
    }
    return "invoke-only";
  }

  console.log("db:", await makeDb());

  const sqlSel = (sql) => {
    const shape = apiShape ? JSON.parse(apiShape) : {};
    if (shape.hasDefault) {
      return evaluate(`window.__db.select(${JSON.stringify(sql)}, [])`);
    }
    return evaluate(
      `window.__TAURI__.core.invoke('plugin:sql|select', { db: '${DB}', query: ${JSON.stringify(sql)}, values: [] })`,
    );
  };
  const sqlExec = (sql) => {
    const shape = apiShape ? JSON.parse(apiShape) : {};
    if (shape.hasDefault) {
      return evaluate(`window.__db.execute(${JSON.stringify(sql)}, [])`);
    }
    return evaluate(
      `window.__TAURI__.core.invoke('plugin:sql|execute', { db: '${DB}', query: ${JSON.stringify(sql)}, values: [] })`,
    );
  };

  // 0. normalize route
  await evaluate(`location.hash = "#/"`);
  await sleep(800);

  // 1. basic render probe
  const basic = await evaluate(
    `JSON.stringify({
      hash: location.hash,
      title: document.title,
      h1: document.querySelector('h1')?.textContent,
      navLinks: document.querySelectorAll('nav a').length,
      hasTauri: !!window.__TAURI__,
      hasCoreInvoke: !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke),
    })`,
  );
  console.log("render probe:", basic);

  // 2. DB probe through the real plugin commands
  const exCount = await sqlSel("SELECT COUNT(*) AS c FROM exercises");
  console.log("exercises in DB:", JSON.stringify(exCount));

  // 3. seed a test plan through the same SQL the UI uses
  await sqlExec("INSERT INTO plans (name) VALUES ('CDP Test Plan')");
  const planId = (await sqlSel("SELECT MAX(id) AS id FROM plans"))[0].id;
  await sqlExec(`INSERT INTO plan_days (plan_id, name, day_order) VALUES (${planId}, 'CDP Day', 0)`);
  const dayId = (await sqlSel("SELECT MAX(id) AS id FROM plan_days"))[0].id;
  await sqlExec(`INSERT INTO plan_exercises (day_id, exercise_id, exercise_order) VALUES (${dayId}, 1, 0)`);
  console.log("created plan", planId, "day", dayId);

  // 4. walk routes
  const routes = ["/", "/plans", "/workout", "/history", "/stats", "/settings"];
  for (const r of routes) {
    await evaluate(`location.hash = "#${r}"`);
    await sleep(900);
    const probe = await evaluate(
      `JSON.stringify({ h1: document.querySelector('h1')?.textContent, navLinks: document.querySelectorAll('nav a').length })`,
    );
    console.log(`route ${r} ->`, probe);
  }

  // 5. plan detail page renders plan name
  await evaluate(`location.hash = "#/plans/${planId}"`);
  await sleep(1200);
  const planDetail = await evaluate(
    `JSON.stringify({ h1: document.querySelector('h1')?.textContent, hasStartBtn: !!document.querySelector('.nm-btn-success') })`,
  );
  console.log("plan detail ->", planDetail);

  // 6. start session from plan day (tests WorkoutPage auto-start + redirect)
  await evaluate(`location.hash = "#/workout/day/${dayId}"`);
  await sleep(1500);
  const sessionProbe = await evaluate(
    `JSON.stringify({
      hash: location.hash,
      h1: document.querySelector('h1')?.textContent,
      tables: document.querySelectorAll('table').length,
      hasSetForm: !!document.querySelector('input[placeholder="0"]'),
    })`,
  );
  console.log("active session ->", sessionProbe);

  const sessMatch = await evaluate(`location.hash.match(/session\\/(\\d+)/)`);
  const sessionId = sessMatch ? Number(sessMatch[1]) : null;
  if (sessionId) {
    // 7. log a set through the UI's exact SQL path, then reload page data by re-navigating
    await sqlExec(
      `INSERT INTO set_logs (session_id, exercise_id, set_number, weight_kg, reps, rpe, is_warmup, is_pr) VALUES (${sessionId}, 1, 1, 60, 10, 8, 0, 0)`,
    );
    const rows = await sqlSel(`SELECT COUNT(*) AS c FROM set_logs WHERE session_id = ${sessionId}`);
    console.log("logged sets in session", sessionId, ":", JSON.stringify(rows));

    // 8. history + stats with data
    await evaluate(`location.hash = "#/history"`);
    await sleep(900);
    console.log("history ->", await evaluate(`JSON.stringify({ rows: document.querySelectorAll('table tbody tr, .space-y-2 > div').length })`));
    await evaluate(`location.hash = "#/stats"`);
    await sleep(900);
    console.log("stats ->", await evaluate(`JSON.stringify({ h1: document.querySelector('h1')?.textContent, bars: document.querySelectorAll('.bg-blue-500, .bg-emerald-500').length })`));
  }

  // 9. cleanup test data
  if (sessionId) await sqlExec(`DELETE FROM sessions WHERE id = ${sessionId}`);
  await sqlExec(`DELETE FROM plan_exercises WHERE day_id = ${dayId}`);
  await sqlExec(`DELETE FROM plan_days WHERE plan_id = ${planId}`);
  await sqlExec(`DELETE FROM plans WHERE id = ${planId}`);
  console.log("cleanup done");

  console.log("\n==== RESULT ====");
  const realIssues = issues.filter(
    (i) => !i.includes("favicon") && !i.includes("Autofill") && !i.includes("Third-party cookie"),
  );
  if (realIssues.length === 0) {
    console.log("NO RUNTIME ERRORS 🎉");
  } else {
    console.log(`${realIssues.length} issues:`);
    realIssues.forEach((i) => console.log(" -", i.split("\n")[0].slice(0, 300)));
  }
  ws.close();
  process.exit(realIssues.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("CDP script failed:", e.message);
  process.exit(2);
});
