/**
 * One-off diagnostic: renders 4 SVG swatches (solid ink / hatch pattern /
 * 7% base tint / hairline stroke) and reports the rendered pixel values,
 * to verify which fills the headless-Chrome screenshot actually shows.
 */
const fs = require("fs");
const zlib = require("zlib");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const tmp = os.tmpdir();
const htmlPath = path.join(tmp, "fitplan-swatch-test.html");
const pngPath = path.join(tmp, "fitplan-swatch-test.png");

const html =
  '<!doctype html><html><body style="margin:0;background:#fff">' +
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60" viewBox="0 0 240 60">' +
  '<defs><pattern id="p" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2.2" stroke="#1C1C1C8C" stroke-width="0.6"/></pattern></defs>' +
  '<rect x="0" y="0" width="60" height="60" fill="#1C1C1C"/>' +
  '<rect x="60" y="0" width="60" height="60" fill="url(#p)"/>' +
  '<rect x="120" y="0" width="60" height="60" fill="#1C1C1C12"/>' +
  '<rect x="180" y="0" width="60" height="60" fill="none" stroke="#1C1C1C40" stroke-width="2"/>' +
  "</svg></body></html>";
fs.writeFileSync(htmlPath, html);

const chromeCandidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
].filter(Boolean);
const chrome = chromeCandidates.find((p) => fs.existsSync(p));
if (!chrome) throw new Error("Chrome not found");

const args = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--force-device-scale-factor=1",
  "--user-data-dir=" + path.join(tmp, "fitplan-chrome-profile"),
  "--hide-scrollbars",
  "--window-size=240,60",
  "--screenshot=" + pngPath,
  "file:///" + htmlPath.split(path.sep).join("/"),
];
try {
  execFileSync(chrome, args, { stdio: "ignore" });
} catch {
  args[0] = "--headless";
  execFileSync(chrome, args, { stdio: "ignore" });
}

// --- decode PNG ---
const buf = fs.readFileSync(pngPath);
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
const avg = (x0, x1, y) => {
  let s = 0, n = 0;
  for (let x = x0; x <= x1; x++) {
    s += px[y * stride + x * bpp];
    n++;
  }
  return (s / n).toFixed(1);
};

console.log("PNG:", width, "x", height, "colorType:", buf[25]);
console.log("solid ink  (0-59)    avg R @y30:", avg(5, 55, 30));
console.log("hatch pat  (60-119)  avg R @y30:", avg(65, 115, 30));
console.log("base 12    (120-179) avg R @y30:", avg(125, 175, 30));
console.log("inside stroke box  avg R @y30:", avg(181, 239, 30));
