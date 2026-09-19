/**
 * Generates src/data/body-model.json — the polygon geometry used by
 * src/components/BodyMap.tsx.
 *
 * Source: react-body-highlighter v2.0.5 (MIT) — https://github.com/GV79/react-body-highlighter
 * The upstream package ships hand-drawn per-muscle polygon sets for the
 * anterior (front) and posterior (back) views in a 100×200 viewBox. We
 * vendor the geometry (not the component) so BodyMap can keep its own
 * three-gray rendering and the app's muscle-key vocabulary.
 *
 * Usage:
 *   node scripts/generate-body-model.cjs            # fetches the tarball itself
 *   node scripts/generate-body-model.cjs <assets.ts> <metadata.ts>
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "../src/data/body-model.json");
const VERSION = "2.0.5";

// ---------------------------------------------------------------------------
// Locate upstream sources: either from CLI args or a fresh npm pack.
// ---------------------------------------------------------------------------
function fetchTarball() {
  console.log("fetching react-body-highlighter@" + VERSION + " …");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rbh-"));
  execFileSync("npm", ["pack", "react-body-highlighter@" + VERSION], {
    cwd: tmp,
    stdio: "ignore",
  });
  const tgz = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
  execFileSync("tar", ["xzf", tgz], { cwd: tmp, stdio: "ignore" });
  return path.join(tmp, "package/src");
}

let pkgSrc;
const args = process.argv.slice(2);
if (args.length >= 2) {
  // args: <…/package/src/assets/index.ts> <…/package/src/component/metadata.ts>
  pkgSrc = path.dirname(path.dirname(args[0]));
} else {
  pkgSrc = fetchTarball();
}
const assetsPath = path.join(pkgSrc, "assets/index.ts");
const metaPath = path.join(pkgSrc, "component/metadata.ts");
const src = fs.readFileSync(assetsPath, "utf8");
const meta = fs.readFileSync(metaPath, "utf8");

// ---------------------------------------------------------------------------
// Parse MuscleType enum → upstream muscle keys.
// ---------------------------------------------------------------------------
const enumMap = {};
for (const m of meta.matchAll(/([A-Z_]+):\s*'([a-z-]+)'/g)) enumMap[m[1]] = m[2];

function parseBlock(name) {
  const i = src.indexOf("const " + name);
  if (i < 0) throw new Error(`block "${name}" not found`);
  const seg = src.slice(i, src.indexOf("\n];", i));
  const out = [];
  for (const m of seg.matchAll(
    /muscle:\s*MuscleType\.([A-Z_]+),\s*svgPoints:\s*\[([\s\S]*?)\]/g,
  )) {
    const polys = [...m[2].matchAll(/'([^']+)'/g)].map((p) =>
      p[1]
        .trim()
        .split(/\s+/)
        .map((n) => Number(n).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"))
        .join(" "),
    );
    out.push({ muscle: enumMap[m[1]], polys });
  }
  if (out.length === 0) throw new Error(`no polygons parsed from "${name}"`);
  return out;
}

const front = parseBlock("anteriorData");
const back = parseBlock("posteriorData");

// ---------------------------------------------------------------------------
// Validate geometry: even point counts, coords inside the 100×220 box.
// ---------------------------------------------------------------------------
for (const view of [front, back]) {
  for (const entry of view) {
    for (const poly of entry.polys) {
      const nums = poly.split(/\s+/).map(Number);
      if (nums.length % 2) throw new Error(`odd point count in ${entry.muscle}`);
      for (let k = 0; k < nums.length; k++) {
        const lim = k % 2 === 0 ? 100 : 220;
        if (nums[k] < 0 || nums[k] > lim)
          throw new Error(`${entry.muscle} coord ${nums[k]} out of range`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Project muscle keys → upstream geometry keys (subset = base regions).
// Front view lacks back-geometry; back view lacks front-geometry; muscles
// outside a view fall back to its nearest base region so something always
// highlights (mirrors how the muscle tags fall back to a shared label).
// ---------------------------------------------------------------------------
const FRONT_KEYS = new Set(front.map((e) => e.muscle));
const BACK_KEYS = new Set(back.map((e) => e.muscle));

const MAP = {
  chest: "chest",
  shoulders: "front-deltoids",
  "front-delts": "front-deltoids",
  "side-delts": "front-deltoids",
  "rear-delts": "back-deltoids",
  back: "upper-back",
  lats: "upper-back",
  "upper-back": "upper-back",
  "lower-back": "lower-back",
  traps: "trapezius",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearm",
  abs: "abs",
  obliques: "obliques",
  core: "abs",
  quads: "quadriceps",
  hamstrings: "hamstring",
  glutes: "gluteal",
  adductors: "adductor",
  abductors: "abductors",
  calves: "calves",
  tibialis: "calves",
  // only used by BodyMap's internal fallbacks; never highlighted directly
  neck: "neck",
  head: "head",
  knees: "knees",
};

const FRONT_FALLBACK = {
  "back-deltoids": "front-deltoids",
  trapezius: "front-deltoids",
  "upper-back": "obliques",
  "lower-back": "obliques",
  gluteal: "quadriceps",
  hamstring: "quadriceps",
  adductor: "quadriceps",
  abductors: "quadriceps",
  calves: "calves",
  "left-soleus": "calves",
  "right-soleus": "calves",
  knees: "quadriceps",
  neck: "neck",
  head: "head",
};
const BACK_FALLBACK = {
  chest: "upper-back",
  "front-deltoids": "back-deltoids",
  biceps: "triceps",
  abs: "lower-back",
  obliques: "lower-back",
  quadriceps: "hamstring",
  abductors: "adductor", // posterior view ships no separate abductor geometry
  neck: "head", // posterior view has no neck entry; head base sits above it
};

function normalize(view, viewKeys, fallback, fallbackOf = (k) => k) {
  const byMuscle = new Map(view.map((e) => [e.muscle, e.polys]));
  const out = [];
  for (const [proj, upstream] of Object.entries(MAP)) {
    const keys = Array.isArray(upstream) ? upstream : [upstream];
    for (const k of keys) {
      let polys = viewKeys.has(k) ? byMuscle.get(k) : undefined;
      if (!polys && fallback[k] && viewKeys.has(fallback[k]))
        polys = byMuscle.get(fallback[k]);
      if (!polys) continue;
      out.push({ m: proj, p: polys });
    }
  }
  // dedupe identical (project-key, polygon) pairs produced by mapping two
  // upstream entries onto one project key (e.g. calves + soleus)
  const seen = new Set();
  return out.filter((e) => {
    const key = e.m + "|" + e.p.join(";");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const frontN = normalize(front, FRONT_KEYS, FRONT_FALLBACK);
const backN = normalize(back, BACK_KEYS, BACK_FALLBACK);

// ---------------------------------------------------------------------------
// Emit.
// ---------------------------------------------------------------------------
const doc = {
  source: "react-body-highlighter@" + VERSION + " (MIT) — https://github.com/GV79/react-body-highlighter",
  viewBox: "0 0 100 200",
  front: frontN,
  back: backN,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + "\n");

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(
  `wrote ${OUT} (${kb} KB): front=${frontN.length} regions, back=${backN.length} regions`,
);
const fKeys = new Set(frontN.map((e) => e.m));
const bKeys = new Set(backN.map((e) => e.m));
const missing = Object.keys(MAP).filter(
  (k) => !["neck", "head", "knees"].includes(k) && (!fKeys.has(k) || !bKeys.has(k)),
);
if (missing.length) console.log("NOTE: keys missing in a view:", missing.join(", "));
else console.log("all project muscle keys covered in both views ✓");
