// Drives real UI interactions via CDP: creating plans/days/exercises through
// clicks, logging sets through the form, verifying PR flags, rest timer,
// language and unit switching. Reports PASS/FAIL per step.
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
  const page = targets.find((t) => t.type === "page" && t.url.includes("1420"));
  if (!page) throw new Error("no page target found");
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
      issues.push(text);
      console.log("\n[EXCEPTION]", text.split("\n")[0], "\n");
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (!text.includes("favicon")) {
        issues.push(text);
        console.log("\n[CONSOLE ERROR]", text.split("\n")[0], "\n");
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
          expr.slice(0, 100),
      );
    }
    return res.result.value;
  }

  const sqlSel = (sql) =>
    evaluate(`window.__TAURI__.core.invoke('plugin:sql|select', { db: '${DB}', query: ${JSON.stringify(sql)}, values: [] })`);
  const sqlExec = (sql) =>
    evaluate(`window.__TAURI__.core.invoke('plugin:sql|execute', { db: '${DB}', query: ${JSON.stringify(sql)}, values: [] })`);

  await send("Runtime.enable");
  await send("Page.enable");

  let passed = 0;
  let failed = 0;
  function check(name, cond, extra = "") {
    if (cond) {
      passed++;
      console.log(`PASS  ${name}`);
    } else {
      failed++;
      console.log(`FAIL  ${name} ${extra}`);
    }
  }

  const click = (sel) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const clickText = (text) =>
    evaluate(
      `(() => { const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`,
    );
  const goto = async (hash) => {
    await evaluate(`location.hash = ${JSON.stringify(hash)}`);
    await sleep(700);
  };

  // ---------- 0. clean slate ----------
  await sqlExec("DELETE FROM set_logs");
  await sqlExec("DELETE FROM session_exercises");
  await sqlExec("DELETE FROM sessions");
  await sqlExec("DELETE FROM plan_exercises");
  await sqlExec("DELETE FROM plan_days");
  await sqlExec("DELETE FROM plans");

  // ---------- 1. Create a plan via real UI clicks ----------
  await goto("#/plans");
  check("plans page shows empty hint", await evaluate(`!!document.body.textContent.match(/还没有计划|No plans yet/)`));

  await clickText("新建计划") || clickText("New Plan");
  await sleep(300);
  await evaluate(
    `(() => { const el = document.querySelector('input[placeholder]'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, '推拉腿计划'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await sleep(200);
  await clickText("保存");
  await sleep(800);
  check("plan created, navigated to detail", await evaluate(`location.hash.startsWith('#/plans/')`));
  const planId = Number((await evaluate(`location.hash.split('/').pop()`)));
  check("plan detail shows name", await evaluate(`document.querySelector('h1')?.textContent === '推拉腿计划'`));

  // ---------- 2. Add a day via UI ----------
  await clickText("添加训练日") || clickText("Add Day");
  await sleep(300);
  await evaluate(
    `(() => { const el = document.querySelector('input[placeholder]'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, '推日'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await sleep(200);
  await clickText("保存");
  await sleep(800);
  check("day added (start button visible)", await evaluate(`!![...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始这次训练') || b.textContent.includes('Start this workout'))`));

  // ---------- 3. Add exercise via picker modal ----------
  await clickText("添加动作") || clickText("Add Exercise");
  await sleep(500);
  check("picker modal opened", await evaluate(`!!document.querySelector('input[placeholder*=\"搜索\"], input[placeholder*=\"Search\"]')`));
  // search and click first result
  await evaluate(
    `(() => { const el = document.querySelector('input[placeholder*=\"搜索\"], input[placeholder*=\"Search\"]'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, 'bench'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await sleep(500);
  const picked = await evaluate(
    `(() => { const btn = [...document.querySelectorAll('.fixed button')].find((b) => /卧推|Bench/.test(b.textContent)); if (!btn) return false; btn.click(); return true; })()`,
  );
  await sleep(700);
  check("exercise picked from modal", picked);
  const peCount = (await sqlSel("SELECT COUNT(*) AS c FROM plan_exercises"))[0].c;
  check("exercise row added to plan in DB", peCount === 1, "count=" + peCount);

  // ---------- 4. Start workout from the plan day ----------
  await clickText("开始这次训练") || clickText("Start this workout");
  await sleep(1200);
  check("session started", await evaluate(`location.hash.includes('/workout/session/')`));
  check("session header shows day name", await evaluate(`document.querySelector('h1')?.textContent === '推日'`));
  check("exercise block rendered in session", await evaluate(`document.querySelectorAll('table').length >= 0 && !!document.querySelector('input[type=number]')`));

  const sessionId = Number((await evaluate(`location.hash.match(/session\\/(\\d+)/)`))[1]);

  // ---------- 5. Log first set via the form ----------
  for (let i = 0; i < 10; i++) {
    if (await evaluate(`document.querySelectorAll('input[type=number]').length >= 2`)) break;
    await sleep(400);
  }
  check("set form inputs available", await evaluate(`document.querySelectorAll('input[type=number]').length >= 2`));
  await evaluate(
    `(() => { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; const w = document.querySelector('input[placeholder=\"0\"]'); setter.call(w, '60'); w.dispatchEvent(new Event('input', { bubbles: true })); const inputs = [...document.querySelectorAll('input[type=number]')]; setter.call(inputs[1], '8'); inputs[1].dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await clickText("完成") || clickText("Done");
  await sleep(800);
  let sets = await sqlSel(`SELECT * FROM set_logs WHERE session_id = ${sessionId}`);
  check("set logged in DB", sets.length === 1, JSON.stringify(sets));
  check("set weight correct (60kg)", sets[0]?.weight_kg === 60);
  check("reps correct (8)", sets[0]?.reps === 8);
  check("row rendered in table", await evaluate(`document.querySelectorAll('tbody tr').length >= 1`));

  // rest timer should have started (default 90s)
  check("rest timer started", await evaluate(`!!document.body.textContent.match(/休息中|Resting/)`));
  await clickText("跳过") || clickText("Skip");
  await sleep(300);

  // ---------- 6. Log PR set ----------
  await evaluate(
    `(() => { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; const inputs = [...document.querySelectorAll('input[type=number]')]; setter.call(inputs[0], '100'); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); setter.call(inputs[1], '5'); inputs[1].dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await clickText("完成") || clickText("Done");
  await sleep(800);
  sets = await sqlSel(`SELECT * FROM set_logs WHERE session_id = ${sessionId} ORDER BY id`);
  check("second set logged", sets.length === 2);
  check("second set weight 100kg", sets[1]?.weight_kg === 100);
  check("PR flag NOT set (no previous history)", sets[1]?.is_pr === 0);

  // ---------- 7. Log a true PR in a NEW session ----------
  await sqlExec(`UPDATE sessions SET finished_at = datetime('now') WHERE id = ${sessionId}`);
  await goto("#/workout");
  await sleep(400);
  await clickText("自由训练") || clickText("Free Workout");
  await sleep(1200);
  const sessionId2 = Number((await evaluate(`location.hash.match(/session\\/(\\d+)/)`))[1]);
  // add the same exercise via picker
  await clickText("添加动作") || clickText("Add Exercise");
  await sleep(500);
  await evaluate(
    `(() => { const el = document.querySelector('input[placeholder*=\"搜索\"], input[placeholder*=\"Search\"]'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, 'bench'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await sleep(500);
  await evaluate(
    `(() => { const btn = [...document.querySelectorAll('.fixed button')].find((b) => /卧推|Bench/.test(b.textContent)); if (btn) btn.click(); })()`,
  );
  await sleep(800);
  check("previous best shown", await evaluate(`document.body.textContent.match(/上次最好|Prev best/) && document.body.textContent.match(/100/)`) ? true : false);
  // log 105kg -> should be PR
  await evaluate(
    `(() => { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; const inputs = [...document.querySelectorAll('input[type=number]')]; setter.call(inputs[0], '105'); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); setter.call(inputs[1], '3'); inputs[1].dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await clickText("完成") || clickText("Done");
  await sleep(800);
  const prSets = await sqlSel(`SELECT * FROM set_logs WHERE session_id = ${sessionId2} AND is_pr = 1`);
  check("PR flagged (105 > 100)", prSets.length === 1 && prSets[0].weight_kg === 105);
  check("PR banner visible", await evaluate(`!!document.body.textContent.match(/个人纪录|New PR/)`));

  // ---------- 8. Finish workout -> history ----------
  await evaluate(`window.confirm = () => true`);
  await clickText("结束训练") || clickText("Finish Workout");
  await sleep(800);
  check("navigated to history", await evaluate(`location.hash === '#/history'`));
  check("history shows 2 finished sessions", (await sqlSel("SELECT COUNT(*) AS c FROM sessions WHERE finished_at IS NOT NULL"))[0].c === 2);

  // ---------- 9. Stats page has data ----------
  await goto("#/stats");
  check("weekly volume chart bars rendered", (await evaluate(`document.querySelectorAll('[class*="7c6fff"]').length`)) >= 1);
  check("muscle split bars rendered", (await evaluate(`document.querySelectorAll('[class*="4ecdc4"]').length`)) >= 1);
  check("PR table has row", await evaluate(`!!document.body.textContent.match(/105/)`) ? true : false);

  // ---------- 10. Language switch ----------
  await goto("#/settings");
  await clickText("English");
  await sleep(500);
  check("nav switched to English", await evaluate(`document.querySelector('nav a')?.textContent.includes('Exercise Library')`));
  await clickText("中文");
  await sleep(500);
  check("nav switched back to Chinese", await evaluate(`document.querySelector('nav a')?.textContent.includes('动作库')`));

  // ---------- 11. Unit switch (lb display conversion) ----------
  await goto("#/settings");
  await clickText("英制 lb");
  await sleep(500);
  await goto("#/history");
  await sleep(500);
  const lbText = await evaluate(`document.body.textContent`);
  check("lb volume conversion visible (980kg -> 2,161lb)", lbText.includes("2,161"), "text sample: " + lbText.slice(0, 200));
  // per-set weight formatting on session detail (105kg -> 231.5lb)
  await goto(`#/history/${sessionId2}`);
  await sleep(600);
  const detailText = await evaluate(`document.body.textContent`);
  check("lb per-set conversion (105kg -> 231.5lb)", detailText.includes("231.5"), "sample: " + detailText.slice(0, 150));
  await goto("#/settings");
  await clickText("公制 kg");
  await sleep(400);

  // ---------- 12. Custom exercise via UI ----------
  await goto("#/");
  await clickText("自定义动作") || clickText("Custom Exercise");
  await sleep(700);
  const modalDebug = await evaluate(
    `JSON.stringify({ fixedDivs: document.querySelectorAll('.fixed').length, inputs: document.querySelectorAll('.fixed input').length })`,
  );
  console.log("custom modal debug:", modalDebug);
  await evaluate(
    `(() => { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; const inputs = [...document.querySelectorAll('.fixed input')]; setter.call(inputs[0], 'Test Movement'); inputs[0].dispatchEvent(new Event('input', { bubbles: true })); setter.call(inputs[1], '测试动作'); inputs[1].dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await sleep(300);
  const saveDebug = await evaluate(
    `JSON.stringify({ values: [...document.querySelectorAll('.fixed input')].map((i) => i.value), saveDisabled: [...document.querySelectorAll('button')].find((b) => b.textContent.includes('保存'))?.disabled })`,
  );
  console.log("before save:", saveDebug);
  await clickText("保存");
  await sleep(800);
  const customCount = (await sqlSel("SELECT COUNT(*) AS c FROM exercises WHERE is_custom = 1"))[0].c;
  check("custom exercise created", customCount === 1);
  check("custom exercise visible with badge", await evaluate(`!!document.body.textContent.match(/自定义|Custom/)`));

  // ---------- cleanup ----------
  await sqlExec("DELETE FROM set_logs");
  await sqlExec("DELETE FROM session_exercises");
  await sqlExec("DELETE FROM sessions");
  await sqlExec("DELETE FROM plan_exercises");
  await sqlExec("DELETE FROM plan_days");
  await sqlExec("DELETE FROM plans");
  await sqlExec("DELETE FROM exercises WHERE is_custom = 1");
  console.log("\ncleanup done");

  console.log(`\n==== ${passed} passed, ${failed} failed ====`);
  if (issues.length > 0) {
    console.log("runtime issues observed:");
    issues.forEach((i) => console.log(" -", i.split("\n")[0].slice(0, 200)));
  }
  ws.close();
  process.exit(failed > 0 || issues.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("interaction test failed:", e.message);
  process.exit(2);
});
