// Generates the placeholder app icons into build-resources/ with no dependencies (Node's zlib only):
//   icon.png (1024), icon.icns (macOS), icon.ico (Windows, 16-256), icons/<n>x<n>.png (Linux).
// The artwork matches apps/ui/public/pista.svg: a pistachio rounded square with a white "P" built from a stem and a ring.
// To ship real artwork, drop your own square 1024x1024 icon.png (8-bit RGBA, not interlaced) into build-resources/
// and run with --from-png to rebuild icns, ico and the Linux sizes from it. See build-resources/README.md.
//
//   node scripts/make-icons.mjs              render the placeholder
//   node scripts/make-icons.mjs --from-png   build icns/ico/Linux sizes from build-resources/icon.png (downscaled)
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build-resources");
const ACCENT = [0x93, 0xc5, 0x72]; // pistachio #93C572
const WHITE = [255, 255, 255];

/** Colour at (x, y) in a 32-unit design space: the rounded square, the P stem and the P ring. Null outside the square. */
function shade(x, y) {
  const r = 8;
  const cx = Math.min(Math.max(x, r), 32 - r);
  const cy = Math.min(Math.max(y, r), 32 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  // Stem: capsule from (11.5, 9.5) to (11.5, 24.5), stroke 3.
  const sy = Math.min(Math.max(y, 9.5), 24.5);
  if ((x - 11.5) ** 2 + (y - sy) ** 2 <= 1.5 ** 2) return WHITE;
  // Ring: centre (16.5, 14.5), radius 5, stroke 3.
  if (Math.abs(Math.hypot(x - 16.5, y - 14.5) - 5) <= 1.5) return WHITE;
  return ACCENT;
}

/** RGBA pixels at `size`, 4x4 supersampled for smooth edges. */
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const n = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < n; sj++) {
        for (let si = 0; si < n; si++) {
          const c = shade(((i + (si + 0.5) / n) / size) * 32, ((j + (sj + 0.5) / n) / size) * 32);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const o = (j * size + i) * 4;
      if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; px[o + 3] = Math.round((a / (n * n)) * 255); }
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, k) => {
  let c = k;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Decode an 8-bit RGB/RGBA non-interlaced PNG (enough for --from-png). */
function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (ct !== 6 && ct !== 2)) throw new Error("icon.png must be 8-bit RGB or RGBA and not interlaced");
    }
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), rows = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? rows[y * stride + x - bpp] : 0;
      const b = y ? rows[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? rows[(y - 1) * stride + x - bpp] : 0;
      const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      rows[y * stride + x] = (v + pr) & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = rows[i * bpp + k];
    rgba[i * 4 + 3] = bpp === 4 ? rows[i * 4 + 3] : 255;
  }
  return { w, h, rgba };
}
/** Box-filter downscale of a square RGBA image to `size`, weighting colour by alpha. */
function downscale({ w, rgba }, size) {
  const px = Buffer.alloc(size * size * 4), s = w / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const y1 = Math.max(Math.floor(j * s) + 1, Math.floor((j + 1) * s)), x1 = Math.max(Math.floor(i * s) + 1, Math.floor((i + 1) * s));
      for (let y = Math.floor(j * s); y < y1; y++) {
        for (let x = Math.floor(i * s); x < x1; x++) {
          const o = (y * w + x) * 4, al = rgba[o + 3];
          r += rgba[o] * al; g += rgba[o + 1] * al; b += rgba[o + 2] * al; a += al; n++;
        }
      }
      const o = (j * size + i) * 4;
      if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; }
      px[o + 3] = a / n;
    }
  }
  return px;
}

const fromPng = process.argv.includes("--from-png");
const source = fromPng ? decodePng(readFileSync(path.join(out, "icon.png"))) : null;
if (source && source.w !== source.h) throw new Error("icon.png must be square");
const pngAt = (size) => encodePng(size, source ? downscale(source, size) : render(size));

mkdirSync(path.join(out, "icons"), { recursive: true });
if (!fromPng) writeFileSync(path.join(out, "icon.png"), pngAt(1024));

// Linux: electron-builder reads <n>x<n>.png from the icons directory.
for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) writeFileSync(path.join(out, "icons", `${s}x${s}.png`), pngAt(s));

// macOS .icns: a header plus PNG-compressed entries (the same type codes iconutil emits).
const icnsTypes = [["icp4", 16], ["icp5", 32], ["ic11", 32], ["ic12", 64], ["ic07", 128], ["ic13", 256], ["ic08", 256], ["ic14", 512], ["ic09", 512], ["ic10", 1024]];
const entries = icnsTypes.map(([t, s]) => {
  const d = pngAt(s), h = Buffer.alloc(8);
  h.write(t, 0, "ascii");
  h.writeUInt32BE(8 + d.length, 4);
  return Buffer.concat([h, d]);
});
const icnsBody = Buffer.concat(entries), icnsHead = Buffer.alloc(8);
icnsHead.write("icns", 0, "ascii");
icnsHead.writeUInt32BE(8 + icnsBody.length, 4);
writeFileSync(path.join(out, "icon.icns"), Buffer.concat([icnsHead, icnsBody]));

// Windows .ico: PNG-compressed images, 16 to 256.
const icoSizes = [16, 24, 32, 48, 64, 128, 256], images = icoSizes.map(pngAt);
const dir = Buffer.alloc(6 + 16 * icoSizes.length);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(icoSizes.length, 4);
let offset = dir.length;
icoSizes.forEach((s, i) => {
  const o = 6 + i * 16;
  dir[o] = s === 256 ? 0 : s;
  dir[o + 1] = s === 256 ? 0 : s;
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(images[i].length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += images[i].length;
});
writeFileSync(path.join(out, "icon.ico"), Buffer.concat([dir, ...images]));
console.log(`icons written to ${out}`);
