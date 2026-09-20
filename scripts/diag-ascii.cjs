/**
 * Dump a coarse ASCII rendering of a screenshot PNG so figure geometry
 * can be inspected directly in the terminal.
 *
 * Usage: node scripts/diag-ascii.cjs [png] [threshold]
 */
const fs = require("fs");
const zlib = require("zlib");
const os = require("os");
const path = require("path");

const file = process.argv[2] || path.join(os.tmpdir(), "ke-bodymap-preview.png");
const TH = Number(process.argv[3] || 246);
const buf = fs.readFileSync(file);
const width = buf.readUInt32BE(16);
const height = buf.readUInt32BE(20);
const bpp = buf[25] === 6 ? 4 : 3;
const idat = [];
let pos = 8;
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.readUInt32BE(pos + 4);
  if (type === 0x49444154) idat.push(buf.subarray(pos + 8, pos + 8 + len));
  pos += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
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
const lum = (x, y) => px[y * stride + x * bpp];
// downsample: 4px per column, 6px per row
const cols = Math.floor(width / 4);
const rows = Math.floor(height / 6);
const lines = [];
for (let r = 0; r < rows; r++) {
  let s = "";
  for (let cx = 0; cx < cols; cx++) {
    // darkest pixel in the block
    let m = 255;
    for (let dy = 0; dy < 6; dy++)
      for (let dx = 0; dx < 4; dx++) {
        const v = lum(cx * 4 + dx, r * 6 + dy);
        if (v < m) m = v;
      }
    s += m < 100 ? "#" : m < TH ? "." : " ";
  }
  lines.push(s.replace(/\s+$/, ""));
}
console.log(lines.join("\n"));
