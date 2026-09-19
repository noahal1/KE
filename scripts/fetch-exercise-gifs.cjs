/**
 * Maps FitPlan's built-in exercise slugs to animation GIFs from the open
 * dataset https://github.com/hasaneyldrm/exercises-dataset (1,324 exercises,
 * each with a 180x180 animation GIF).
 *
 * Media terms: GIFs are © Gym visual (https://gymvisual.com/), redistributed
 * in that repo with permission. Must be shown at 180x180 with attribution
 * "© Gym visual — https://gymvisual.com/". We hotlink (do not redistribute)
 * and keep the attribution visible in the UI.
 *
 * Usage:  node scripts/fetch-exercise-gifs.cjs
 * Output: fitplan/src/data/exercise-gifs.json  (slug -> gif url, only matches)
 */
const fs = require("fs");
const path = require("path");

const DATASET_URLS = [
  "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/data/exercises.json",
  "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json",
];
const OUT = path.join(__dirname, "..", "src", "data", "exercise-gifs.json");
const SEED = path.join(__dirname, "..", "src-tauri", "seed", "exercises.sql");
// Local cache: run `curl -sL -o scripts/exercises-dataset.cache.json \
//   https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/data/exercises.json`
// if missing. Avoids node https flakiness with the ~9MB payload.
const CACHE = path.join(__dirname, "exercises-dataset.cache.json");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects) => {
      const req = require("https").get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          return get(new URL(res.headers.location, u).toString(), redirects - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      });
      req.on("error", reject);
      req.setTimeout(20000, () => req.destroy(new Error(`timeout for ${u}`)));
    };
    get(url, 5);
  });
}

// --- helpers -------------------------------------------------------------
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const STOP = new Set(["the", "a", "an", "with", "on", "in", "of", "and"]);
const tokens = (s) => norm(s).split(" ").filter((t) => t && !STOP.has(t));

function trigramJaccard(a, b) {
  const grams = (s) => {
    const p = ` ${s} `;
    const out = new Set();
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

function score(query, candidate) {
  const q = norm(query);
  const c = norm(candidate.name);
  if (q === c) return 100;
  const qT = tokens(query);
  const cT = tokens(candidate.name);
  const cSet = new Set(cT);
  let covered = qT.filter((t) => cSet.has(t)).length;
  let s = (covered / Math.max(qT.length, 1)) * 45 + trigramJaccard(q, c) * 30;
  // every shared token is a strong signal; missing tokens only mildly penalized
  s += covered * 4;
  s -= Math.min(qT.length - covered, 4) * 3;
  // synonym bonuses (FitPlan term -> dataset term)
  const SYN = [
    ["ez bar", "ez barbell"],
    ["lat pulldown", "pulldown"],
    ["pulldown", "pulldown"],
    ["flye", "fly"],
    ["skullcrusher", "skull crusher"],
    ["lying triceps extension", "skull crusher"],
    ["overhead triceps extension", "overhead extension"],
    ["rdl", "romanian deadlift"],
    ["hip thrust", "thrust"],
    ["glute bridge", "bridge"],
    ["power clean", "power clean"],
    ["hang clean", "hang clean"],
    ["clean and jerk", "clean and jerk"],
    ["face pull", "face pull"],
    ["pec deck", "pec deck"],
    ["woodchop", "wood chop"],
    ["pallof", "pallof"],
    ["treadmill", "treadmill"],
    ["stair climber", "stepmill"],
    ["cycling", "bike"],
    ["assault bike", "bike"],
    ["rowing machine", "rowing"],
    ["leg press", "leg press"],
    ["hammer strength", "hammer"],
    ["pull up", "pull up"],
    ["push up", "push up"],
    ["muscle up", "muscle up"],
    ["burpee", "burpee"],
    ["plank", "plank"],
    ["crossover", "crossover"],
    ["nordic", "nordic"],
  ];
  for (const [k, v] of SYN) {
    if (q.includes(k) && c.includes(v)) s += 8;
  }
  // small equipment consistency bonus
  const eqMap = {
    barbell: ["barbell"],
    dumbbell: ["dumbbell"],
    "ez-bar": ["ez barbell"],
    kettlebell: ["kettlebell"],
    cable: ["cable"],
    machine: ["machine", "lever", "sled", "hammer"],
    smith: ["smith"],
    "trap-bar": ["trap bar"],
    bodyweight: ["body weight"],
    band: ["band", "resistance band"],
    cardio: ["bike", "treadmill", "row", "elliptical", "stepmill", "skierg", "rope", "ergometer"],
    stretch: ["stretch"],
  };
  const eqWanted = eqMap[candidate.__eq];
  if (eqWanted && eqWanted.some((x) => c.includes(x))) s += 6;
  return s;
}

// Manual overrides for FitPlan slugs whose best fuzzy match is wrong or
// missing. Key: slug, value: exact dataset exercise name.
const MANUAL = {
  "bb-conventional-deadlift": "barbell deadlift",
  "bb-front-squat": "barbell front squat",
  "bb-stiff-leg-deadlift": "band stiff leg deadlift",
  "bb-snatch": "barbell one arm snatch",
  "bb-skullcrusher": "barbell lying triceps extension skull crusher",
  "bb-close-grip-skullcrusher": "barbell lying triceps extension skull crusher",
  "bb-overhead-press": "barbell standing close grip military press",
  "db-flye": "dumbbell fly",
  "db-incline-flye": "dumbbell fly",
  "db-turkish-get-up": "kettlebell turkish get up (squat style)",
  "db-farmer-walk": "farmers walk",
  "db-renegade-row": "kettlebell alternating renegade row",
  "db-reverse-lunge": "dumbbell contralateral forward lunge",
  "db-walking-lunge-db": "dumbbell contralateral forward lunge",
  "db-lunge-db": "dumbbell contralateral forward lunge",
  // FitPlan variations with no dataset equivalent — leave null (no gif)
  "bb-hang-clean": null,
  "bb-clean-and-jerk": null,
  "bb-bulgarian-split-squat-bb": null,
  "db-bulgarian-split-squat-db": null,
  // machine/cable/manual matches the fuzzy pass misses
  "cb-pallof-press": "band horizontal pallof press",
  "cb-woodchop": "cable twist",
  "cb-russian-twist-cable": "cable russian twists (on stability ball)",
  "cb-cable-kickback": "cable kickback",
  "cb-cable-hip-abduction": "lever seated hip abduction",
  "mc-shoulder-press-machine": "lever shoulder press",
  "mc-hack-squat-machine": "sled hack squat",
  "kb-cossack-squat": "weighted cossack squats (male)",
  "kb-farmer-carry": "farmers walk",
  "db-single-arm-row": "dumbbell reverse grip incline bench one arm row",
  "ez-skullcrusher": "barbell lying triceps extension skull crusher",
  "ez-upright-row": "barbell upright row",
  "kb-single-leg-rdl-kb": "kettlebell single leg deadlift",
  "kb-russian-twist-kb": "russian twist",
  "cb-face-pull": "cable rear delt row (with rope)",
  "cb-single-arm-pushdown": "cable one arm press",
  "cb-rear-delt-flye-cable": "cable rear delt row (stirrups)",
  "mc-lateral-raise-machine": "lever lateral raise",
  "mc-seated-row-machine": "lever seated row",
  "mc-hip-abduction-machine": "lever seated hip abduction",
  "mc-row-machine-hammer": "lever t bar row",
  "mc-chest-press-hammer": "lever chest press",
  "mc-triceps-extension-machine": "lever triceps extension",
  "mc-pullover-machine": "barbell bent arm pullover",
  "sm-squat": "smith squat",
  "sm-front-squat": "smith front squat (clean grip)",
  "sm-rdl": "smith romanian deadlift",
  "mc-ab-machine": "cable kneeling crunch",
  "mc-hip-adduction-machine": "lever seated hip adduction",
  "mc-pec-deck": "lever seated fly",
  "bb-walking-lunge": "walking lunge",
  "bb-push-press": "standing behind neck press",
  "bb-seated-behind-neck-press": "smith behind neck press",
  "ez-seated-row": "lever seated row",
  "ez-shrug": "barbell shrug",
  "kb-press": "kettlebell seated press",
  "bw-dip": "triceps dip",
  "cd-cycling": "stationary bike run v. 3",
  "cd-assault-bike": "air bike",
  "bw-lunge-bodyweight": "dumbbell lunge",
  "kb-lunge-press": "kettlebell one arm push press",
  "mc-biceps-curl-machine": "lever bicep curl",
  "mc-preacher-curl-machine": "lever preacher curl",
  "mc-dip-machine": "lever overhand triceps dip",
  "mc-neck-extension": "side push neck stretch",
  "sm-rdl": "smith deadlift",
  "sm-good-morning": "smith bent knee good morning",
  "sm-inverted-row": "inverted row",
  "bd-band-good-morning": "band stiff leg deadlift",
  "cd-stair-climber": "walking on stepmill",
  "cb-low-to-high-crossover": "cable low fly",
  "cb-high-to-low-crossover": "cable decline fly",
  "cb-single-arm-crossover": "cable standing fly",
  "cb-single-arm-pushdown": "cable one arm tricep pushdown",
  "tb-deadlift": null,
  "tb-row": null,
  "tb-carry": null,
  "tb-squat": null,
  "tb-hip-thrust": null,
  "tb-jump": null,
  "cd-treadmill-run": "ski step",
  "cd-treadmill-walk": "walking on incline treadmill",
  "cd-outdoor-run": "ski step",
  "cd-rowing": "ski ergometer",
  "cd-elliptical": "walk elliptical cross trainer",
  "cd-swimming": "swimmer kicks v. 2 (male)",
  "cd-arc-trainer": null,
  "bd-band-pull-apart": "band y-raise",
  "bd-band-face-pull": "band standing rear delt row",
  "bd-band-pushdown": "band side triceps extension",
  "bd-band-shoulder-dislocate": "band shoulder press",
  "cb-crossover": "cable standing fly",
  "bd-band-curl": "band alternating biceps curl",
  "bw-plank": null,
  "db-reverse-curl-db": "dumbbell reverse curl",
  "db-curl": "dumbbell curl",
  "bw-commando-pullup": "archer pull up",
  "bw-wide-pushup": "deep push up",
  "bw-bodyweight-squat": "bodyweight drop jump squat",
  "bw-pistol-squat": "kettlebell pistol squat",
  "bw-bench-dip": "triceps dip (bench leg)",
  "mc-assisted-dip": "assisted triceps dip (kneeling)",
  "mc-calf-raise-machine": "lever calf press",
  "mc-seated-calf-raise-machine": "lever calf press",
  "sm-bench-press": "smith incline bench press",
  "sm-decline-bench-press": "smith machine decline close grip bench press",
  "cb-close-grip-pulldown": "cable pulldown (pro lat bar)",
  "cb-neutral-grip-pulldown": "cable pulldown (pro lat bar)",
  "cb-seated-row-close": "cable seated row",
  "cb-crunch-cable": "cable kneeling crunch",
  "db-single-leg-rdl-db": "dumbbell single leg deadlift",
  "bw-bridge": "glute bridge two legs on bench (male)",
  "bb-hip-thrust": "barbell glute bridge",
  "bb-landmine-press-bb": "band one arm twisting chest press",
  "bb-landmine-row": "band one arm standing low row",
  "bb-single-arm-landmine-row": "band one arm standing low row",
  "bb-t-bar-row": "lever t bar row",
  "bb-yates-row": "barbell bent over row",
  "bb-meadows-row": "band one arm standing low row",
  "bb-landmine-twist": "landmine 180",
  "db-floor-press": "kettlebell one arm floor press",
  "db-skullcrusher-db": "dumbbell lying one arm press",
  "db-sumo-squat-db": "band single leg split squat",
  "kb-single-leg-rdl-kb": "band straight leg deadlift",
  "kb-suitcase-carry": "band one arm standing low row",
  "kb-halo": "band twisting overhead press",
  "kb-calf-raise-kb": "band two legs calf raise - (band under both legs) v. 2",
  "mc-chest-flye-machine": "lever seated fly",
  "mc-rear-delt-machine": "lever seated reverse fly",
  "mc-hip-thrust-machine": "band bent-over hip extension",
  "mc-glute-kickback-machine": "cable kickback",
  "mc-tibialis-raise": "band single leg calf raise",
  "mc-smith-squat-note": "smith squat",
  "mc-v-squat": "lever alternate leg press",
  "mc-pendulum-squat": "lever alternate leg press",
  "sm-split-squat": "band single leg split squat",
  "sm-hip-thrust": "barbell glute bridge",
  "sm-calf-raise": "smith squat",
  "bw-nordic-curl": "glute bridge two legs on bench (male)",
  "st-chest-stretch": "back pec stretch",
  "st-shoulder-stretch": "chest and front of shoulder stretch",
  "st-childs-pose": "butterfly yoga pose",
  "st-cat-cow": "skin the cat",
  "bb-hang-power-clean": "power clean",
  "bb-clean-pull": "snatch pull",
  "bb-snatch-pull": "snatch pull",
  "bb-muscle-snatch": "barbell one arm snatch",
};

async function loadDataset() {
  if (fs.existsSync(CACHE)) {
    console.log("using cached dataset:", CACHE);
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  }
  for (const url of DATASET_URLS) {
    try {
      const data = await fetchJson(url);
      console.log(`dataset loaded: ${url} (${data.length} records)`);
      fs.writeFileSync(CACHE, JSON.stringify(data));
      return data;
    } catch (e) {
      console.warn(`  failed: ${url} (${e.message})`);
    }
  }
  console.error("no dataset available. Download it first:\n" +
    "  curl -sL -o scripts/exercises-dataset.cache.json " +
    "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/data/exercises.json");
  process.exit(1);
}

async function main() {
  // 1. Collect all built-in slugs + English names from the seed SQL
  const sql = fs.readFileSync(SEED, "utf8");
  const re = /\('([^']+)','([^']+)','([^']+)','([^']+)'/g;
  const exercises = [];
  let m;
  while ((m = re.exec(sql)) !== null) {
    exercises.push({ slug: m[1], name_en: m[2], name_zh: m[3], equipment: m[4] });
  }
  console.log(`parsed ${exercises.length} exercises from seed sql`);

  // 2. Load dataset (cache first, then network)
  const data = await loadDataset();

  // 3. Index dataset by normalized name; precompute key tokens for prefilter.
  // Tokens that appear in too many names (press, row, curl...) are not key tokens.
  const df = new Map();
  for (const rec of data) {
    if (!rec.gif_url) continue;
    for (const t of new Set(tokens(rec.name))) df.set(t, (df.get(t) || 0) + 1);
  }
  const byName = new Map();
  const index = [];
  for (const rec of data) {
    const rec2 = {
      name: rec.name || "",
      nameNorm: norm(rec.name || ""),
      keyTokens: [...new Set(tokens(rec.name))].filter((t) => (df.get(t) || 0) <= 120),
      gif: rec.gif_url || "",
      equipment: rec.equipment || "",
      category: rec.category || "",
    };
    if (!rec2.gif) continue;
    byName.set(rec2.nameNorm, rec2);
    index.push(rec2);
  }
  console.log(`dataset index: ${byName.size} records with gifs`);

  // 4. Match
  const out = {};
  let exact = 0;
  let fuzzy = 0;
  const misses = [];
  for (const ex of exercises) {
    const key = norm(ex.name_en);
    const qTokSet = new Set(tokens(ex.name_en));
    const q = norm(ex.name_en);
    let best = null;
    let how = "none";
    if (Object.prototype.hasOwnProperty.call(MANUAL, ex.slug)) {
      const mn = MANUAL[ex.slug];
      if (mn) {
        best = byName.get(norm(mn)) || null;
        how = "manual";
      }
    }
    if (!best) best = byName.get(key) || null;
    if (best && how === "none") how = "exact";
    if (!best) {
      let bestScore = 0;
      let bestRec = null;
      // keyword-index prefilter: only consider records sharing >=1 informative token
      const idx = index.filter((r) => r.keyTokens.some((t) => qTokSet.has(t)) || r.nameNorm.includes(q));
      const pool = idx.length ? idx : index;
      for (const rec of pool) {
        const s = score(ex.name_en, rec);
        if (s > bestScore) {
          bestScore = s;
          bestRec = rec;
        }
      }
      if (bestScore >= 60) {
        best = bestRec;
        how = `fuzzy(${bestScore.toFixed(0)})`;
      }
    }
    if (best) {
      out[ex.slug] = best.gif;
      if (how === "exact") exact++;
      else fuzzy++;
    } else {
      misses.push(`${ex.slug} (${ex.name_en})`);
    }
  }

  // 5. Write
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`matched ${Object.keys(out).length}/${exercises.length} (exact ${exact}, fuzzy ${fuzzy})`);
  if (misses.length) {
    console.log(`no match for ${misses.length}:`);
    for (const mi of misses) console.log("  - " + mi);
  }
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
