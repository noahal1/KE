/**
 * Pixel-level sanity check for the BodyMap preview screenshot:
 * decodes the PNG (no deps), scans ink coverage per row, and prints the
 * figure's width at key heights so proportions can be judged numerically.
 *
 * Usage: node scripts/check-bodymap-pixels.cjs [path-to-png]
 */
const fs = require("fs");
const zlib = require("zlib");
const os = require("os");
const path = require("path");

const file = process.argv[2] || path.join(os.tmpdir(), "fitplan-bodymap-preview.png");
const buf = fs.readFileSync(file);
if (buf.readUInt32BE(12) !== 0x49484452) throw new Error("not a PNG (no IHDR)");
const width = buf.readUInt32BE(16);
const height = buf.readUInt32BE(20);
const bitDepth = buf[24];
const colorType = buf[25];
if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2))
  throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType} (need 8/RGB or 8/RGBA)`);
const bpp = colorType === 6 ? 4 : 3;

// --- decode all IDAT chunks and inflate ---
const idat = [];
let pos = 8;
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.readUInt32BE(pos + 4);
  if (type === 0x49444154) idat.push(buf.subarray(pos + 8, pos + 8 + len));
  pos += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));

// --- unfilter (filter type 0/1/2/3/4 per scanline) ---
const stride = width * bpp;
const px = Buffer.alloc(height * stride);
for (let y = 0; y < height; y++) {
  const f = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  const out = px.subarray(y * stride, (y + 1) * stride);
  const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? out[x - bpp] : 0;
    const b = prev ? prev[x] : 0;
    const c = x >= bpp && prev ? prev[x - bpp] : 0;
    let v = line[x];
    if (f === 1) v += a;
    else if (f === 2) v += b;
    else if (f === 3) v += (a + b) >> 1;
    else if (f === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[x] = v & 0xff;
  }
}

// --- ink mask: anything darker than the white bg. The base silhouette fill
// is only ~7% ink (≈239 over white), so the threshold must sit between
// that and pure white (255) to capture the whole body.
const isInk = (x, y) => {
  const i = y * stride + x * bpp;
  const r = px[i], g = px[i + 1], b = px[i + 2];
  return r < 246 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30; // grayscale-ish ink
};

// column extents of each figure (front = left half, back = right half)
const half = Math.floor(width / 2);
const colHasInk = (x0, x1) => {
  for (let x = x0; x < x1; x++) for (let y = 0; y < height; y++) if (isInk(x, y)) return true;
  return false;
};
const boundsOf = (x0, x1) => {
  let left = -1, right = -1, top = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    // require a solid run so stray antialiasing specks don't skew the box
    let run = 0, ok = false;
    for (let x = x0; x < x1; x++) {
      run = isInk(x, y) ? run + 1 : 0;
      if (run >= 3) { ok = true; break; }
    }
    if (!ok) continue;
    for (let x = x0; x < x1; x++) {
      if (!isInk(x, y)) continue;
      if (left < 0 || x < left) left = x;
      if (x > right) right = x;
    }
    if (top < 0) top = y;
    bottom = y;
  }
  return { left, right, top, bottom };
};

const rowWidth = (box, y) => {
  let min = -1, max = -1;
  for (let x = box.left; x <= box.right; x++) {
    if (isInk(x, y)) {
      if (min < 0) min = x;
      max = x;
    }
  }
  return min < 0 ? 0 : max - min + 1;
};

for (const [label, x0, x1] of [["FRONT", 0, half], ["BACK", half, width]]) {
  const box = boundsOf(x0, x1);
  if (box.left < 0) { console.log(`${label}: no ink found`); continue; }
  const W = box.right - box.left + 1;
  const H = box.bottom - box.top + 1;
  const at = (frac) => rowWidth(box, Math.round(box.top + H * frac));
  console.log(`\n${label}  bbox ${W}x${H}px (top=${box.top} bottom=${box.bottom})`);
  console.log(`  head(6%)   ${at(0.06)}px`);
  console.log(`  traps(13%) ${at(0.13)}px`);
  console.log(`  chest(22%) ${at(0.22)}px`);
  console.log(`  waist(42%) ${at(0.42)}px`);
  console.log(`  hips(52%)  ${at(0.52)}px`);
  console.log(`  thigh(62%) ${at(0.62)}px`);
  console.log(`  knee(76%)  ${at(0.76)}px`);
  console.log(`  ankle(94%) ${at(0.94)}px`);
  const head = at(0.055), shoulder = Math.max(at(0.16), at(0.18)), waist = at(0.42);
  console.log(`  ratios: shoulder/head=${(shoulder / head).toFixed(2)} (want 1.5-1.9), waist/head=${(waist / head).toFixed(2)} (want 0.9-1.3)`);
}
