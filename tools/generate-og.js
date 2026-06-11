/* 依存なしの OG画像ジェネレータ (1200x630)。
 * グラデ背景＋にっこり太陽＋チェックバッジでブランドカードを描く。
 * 使い方: node tools/generate-og.js  ->  icons/og.png
 */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const W = 1200, H = 630, SS = 2;
const w = W * SS, h = H * SS;
const buf = Buffer.alloc(w * h * 4);

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;

function setPx(x, y, col, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  const ea = a == null ? 1 : a;
  buf[i] = Math.round(lerp(buf[i], col[0], ea));
  buf[i + 1] = Math.round(lerp(buf[i + 1], col[1], ea));
  buf[i + 2] = Math.round(lerp(buf[i + 2], col[2], ea));
  buf[i + 3] = 255;
}

function fillDisc(cx, cy, r, colFn) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const col = typeof colFn === "function" ? colFn(x, y) : colFn;
        setPx(x, y, col);
      }
    }
  }
}

function stamp(x, y, r, col) {
  fillDisc(x, y, r, col);
}

function strokePath(pts, width, col) {
  const r = width / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      stamp(lerp(x0, x1, t), lerp(y0, y1, t), r, col);
    }
  }
}

function arc(cx, cy, r, a0, a1, width, col) {
  const pts = [];
  const steps = 80;
  for (let s = 0; s <= steps; s++) {
    const a = lerp(a0, a1, s / steps);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  strokePath(pts, width, col);
}

// ---- 背景グラデーション ----
const bgA = [99, 102, 241], bgB = [139, 92, 246];
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const t = clamp((x + y) / (w + h), 0, 1);
    const i = (y * w + x) * 4;
    buf[i] = Math.round(lerp(bgA[0], bgB[0], t));
    buf[i + 1] = Math.round(lerp(bgA[1], bgB[1], t));
    buf[i + 2] = Math.round(lerp(bgA[2], bgB[2], t));
    buf[i + 3] = 255;
  }
}

// ---- 太陽（左） ----
const cx = 360 * SS, cy = 315 * SS, R = 150 * SS;
// 光線
const gold = [251, 191, 36];
for (let k = 0; k < 16; k++) {
  const a = (Math.PI * 2 * k) / 16;
  const x1 = cx + Math.cos(a) * (R + 22 * SS);
  const y1 = cy + Math.sin(a) * (R + 22 * SS);
  const x2 = cx + Math.cos(a) * (R + 70 * SS);
  const y2 = cy + Math.sin(a) * (R + 70 * SS);
  strokePath([[x1, y1], [x2, y2]], 14 * SS, gold);
}
// 本体（縦グラデ）
fillDisc(cx, cy, R, (x, y) => {
  const t = clamp((y - (cy - R)) / (2 * R), 0, 1);
  return [Math.round(lerp(253, 245, t)), Math.round(lerp(224, 158, t)), Math.round(lerp(71, 11, t))];
});
// 顔
const eyeY = cy - 16 * SS;
const dark = [91, 59, 0];
const cheek = [251, 113, 133];
arc(cx - 52 * SS, eyeY + 10 * SS, 26 * SS, Math.PI * 1.15, Math.PI * 1.85, 11 * SS, dark); // 左目（^）
arc(cx + 52 * SS, eyeY + 10 * SS, 26 * SS, Math.PI * 1.15, Math.PI * 1.85, 11 * SS, dark); // 右目（^）
arc(cx, cy + 26 * SS, 60 * SS, Math.PI * 0.15, Math.PI * 0.85, 13 * SS, dark); // 笑顔
fillDisc(cx - 86 * SS, cy + 30 * SS, 18 * SS, cheek);
fillDisc(cx + 86 * SS, cy + 30 * SS, 18 * SS, cheek);

// ---- チェックバッジ（右） ----
const white = [255, 255, 255];
const green = [34, 197, 94];
const badges = [
  [820, 180, 70],
  [980, 330, 84],
  [820, 470, 70],
];
for (const [bxr, byr, br] of badges) {
  const bx = bxr * SS, by = byr * SS, r = br * SS;
  fillDisc(bx, by, r, white);
  fillDisc(bx, by, r - 9 * SS, [240, 253, 244]);
  strokePath(
    [
      [bx - 0.42 * r, by + 0.02 * r],
      [bx - 0.08 * r, by + 0.34 * r],
      [bx + 0.46 * r, by - 0.34 * r],
    ],
    13 * SS,
    green
  );
}

// ---- ダウンサンプル & PNG ----
function downsample() {
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const bi = ((y * SS + sy) * w + (x * SS + sx)) * 4;
          r += buf[bi]; g += buf[bi + 1]; b += buf[bi + 2];
        }
      const n = SS * SS, i = (y * W + x) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = 255;
    }
  }
  return out;
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const outDir = path.resolve(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, "og.png");
fs.writeFileSync(file, encodePNG(W, H, downsample()));
console.log("wrote", file);
