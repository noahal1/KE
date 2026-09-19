/**
 * Downloads all exercise GIFs referenced by src/data/exercise-gifs.json to
 * public/gifs/videos/ so the app can load them locally instead of hotlinking
 * the jsdelivr CDN (which is unreachable from some networks).
 *
 * Media terms: GIFs are © Gym visual (https://gymvisual.com/), redistributed
 * in the upstream dataset repo with permission. Must be shown at 180x180 with
 * attribution "© Gym visual — https://gymvisual.com/". The local copy is for
 * personal/offline use of this app only — do not redistribute the files.
 *
 * Tries several jsdelivr mirror hosts in order; skips files that already
 * exist with a non-zero size, so re-running only fills gaps.
 *
 * Usage:  node scripts/download-exercise-gifs.cjs
 * Output: fitplan/public/gifs/videos/<id>.gif
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const MAP = path.join(__dirname, "..", "src", "data", "exercise-gifs.json");
const OUT_DIR = path.join(__dirname, "..", "public", "gifs");

// Fastest first (gcore works where cdn.jsdelivr.net is blocked; fastly 301s to
// raw.githubusercontent.com which is also blocked, so it is last).
const MIRRORS = [
  "https://gcore.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/",
  "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/",
  "https://fastly.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@main/",
  "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/",
];

const CONCURRENCY = 6;
const RETRIES = 3;
const TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchBuffer(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "fitplan-gif-fetch/1.0" } },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirects > 0
        ) {
          res.resume();
          return resolve(
            fetchBuffer(new URL(res.headers.location, url).toString(), redirects - 1)
          );
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("timeout")));
  });
}

/** Returns buffer on success, null if every mirror attempt failed. */
async function downloadOne(relPath) {
  for (const base of MIRRORS) {
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        const buf = await fetchBuffer(base + relPath);
        if (buf.length > 1000) return buf; // sanity: real gifs are tens of KB
        throw new Error(`suspiciously small (${buf.length} bytes)`);
      } catch (e) {
        if (attempt < RETRIES) await sleep(500 * attempt);
        else console.log(`  all mirrors failed for ${relPath}: ${e.message}`);
      }
    }
  }
  return null;
}

async function main() {
  const map = JSON.parse(fs.readFileSync(MAP, "utf8"));
  const files = [...new Set(Object.values(map))];
  console.log(`${files.length} unique gifs to ensure in ${OUT_DIR}`);

  fs.mkdirSync(path.join(OUT_DIR, "videos"), { recursive: true });

  const missing = files.filter((rel) => {
    const p = path.join(OUT_DIR, rel);
    try {
      return fs.statSync(p).size < 1000;
    } catch {
      return true;
    }
  });
  console.log(`${missing.length} missing, downloading...`);
  if (!missing.length) {
    console.log("ALL GIFS ALREADY PRESENT");
    return;
  }

  let done = 0;
  let failed = [];
  const queue = [...missing];
  async function worker() {
    while (queue.length) {
      const rel = queue.shift();
      const buf = await downloadOne(rel);
      if (buf) {
        fs.writeFileSync(path.join(OUT_DIR, rel), buf);
      } else {
        failed.push(rel);
      }
      done++;
      if (done % 20 === 0 || done === missing.length)
        console.log(`  progress ${done}/${missing.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (failed.length) {
    console.error(`FAILED (${failed.length}):`);
    for (const f of failed) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`DONE: downloaded ${missing.length} gifs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
