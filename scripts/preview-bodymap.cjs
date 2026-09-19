/**
 * BodyMap visual preview generator.
 *
 * Renders src/data/body-model.json — the exact geometry the app uses —
 * with the same two-pass drawing as src/components/BodyMap.tsx (oversized
 * base pass + clipped highlight pass + union stroke), for a fixed test
 * muscle set, then screenshots it with headless Chrome.
 *
 * NOTE: keep INK/GRAY/BASE/LINE, PAD and STROKE in sync with BodyMap.tsx.
 *
 * Usage:  node scripts/preview-bodymap.cjs
 * Output: paths of the generated .html and .png are printed (OS temp dir).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const model = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../src/data/body-model.json"), "utf8"),
);

/** Muscle set used to exercise every fill branch (ink / gray / base). */
const TEST = {
  primary: ["chest", "quads", "glutes", "biceps"],
  secondary: ["abs", "lats", "traps", "calves"],
};
const INK = "#1C1C1C";
const GRAY = "#9A9A9A";
const BASE = "#1C1C1C14";
const LINE = "#1C1C1C40";
const PAD = "translate(50 110) scale(1.05) translate(-50 -110)";
const STROKE = 0.4;

const stateOf = (key) =>
  TEST.primary.includes(key) ? "primary" : TEST.secondary.includes(key) ? "secondary" : "base";
const fillOf = (key) => (stateOf(key) === "primary" ? INK : GRAY);

function viewSvg(view) {
  const regions = model[view];
  const clipPolys = regions
    .flatMap((r) => r.p)
    .map((pts) => `<polygon points="${pts}"/>`)
    .join("");
  const base = regions
    .flatMap((r) => r.p.map((pts) => `<polygon points="${pts}" fill="${BASE}" stroke="${LINE}" stroke-width="${STROKE}" transform="${PAD}"/>`))
    .join("");
  const highlights = regions
    .map((r) => ({ r, s: stateOf(r.m) }))
    .filter((x) => x.s !== "base")
    .flatMap((x) =>
      x.r.p.map((pts) => `<polygon points="${pts}" fill="${fillOf(x.r.m)}" stroke="${LINE}" stroke-width="${STROKE}"/>`),
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${model.viewBox}" width="144" height="288" style="background:#fff">` +
    `<defs><clipPath id="clip-${view}">${clipPolys}</clipPath></defs>` +
    `<g clip-path="url(#clip-${view})" stroke-linejoin="round">` +
    base + highlights +
    `</g></svg>`
  );
}

const front = viewSvg("front");
const back = viewSvg("back");
for (const [name, svg] of [["front", front], ["back", back]]) {
  if (svg.includes("undefined") || svg.includes("NaN")) throw new Error(`${name} svg contains undefined/NaN`);
  const n = (svg.match(/<polygon/g) || []).length;
  if (n < 20) throw new Error(`${name} svg has only ${n} polygons`);
}

const htmlPath = path.join(os.tmpdir(), "fitplan-bodymap-preview.html");
const pngPath = path.join(os.tmpdir(), "fitplan-bodymap-preview.png");

const html = `<!doctype html>
<html><body style="margin:0;display:flex;gap:28px;padding:28px;background:#ffffff">
${front}
${back}
</body></html>`;
fs.writeFileSync(htmlPath, html);

const chromeCandidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
].filter(Boolean);
const chrome = chromeCandidates.find((p) => fs.existsSync(p));
if (!chrome) throw new Error("Chrome not found — open the HTML manually: " + htmlPath);

const args = (flag) => [
  "--headless" + flag,
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--force-device-scale-factor=1",
  `--user-data-dir=${os.tmpdir()}/fitplan-chrome-profile`,
  "--hide-scrollbars",
  "--window-size=420,400",
  `--screenshot=${pngPath}`,
  "file:///" + htmlPath.replace(/\\/g, "/"),
];
try {
  execFileSync(chrome, args("=new"), { stdio: "ignore" });
} catch {
  execFileSync(chrome, args(""), { stdio: "ignore" });
}
if (!fs.existsSync(pngPath)) throw new Error("screenshot was not written");

console.log("preview html:", htmlPath);
console.log("screenshot  :", pngPath);
