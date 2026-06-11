/* 依存なしのPNG生成スクリプト。
 * 朝＝太陽（サンライズ）をモチーフにしたアプリアイコンを描く。
 * 使い方: node tools/generate-icons.js
 */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

// ---- 色 -------------------------------------------------------------------
const bgTop = [99, 102, 241]; // indigo
const bgBot = [168, 85, 247]; // violet
const gold1 = [253, 224, 71]; // light gold
const gold2 = [245, 158, 11]; // amber

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (A, B, t) => [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** size px のRGBAバッファを描画（supersampling込みで呼ぶ前提） */
function renderRGBA(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size * 0.52; // 少し下げて日の出感
  const sunR = size * 0.17;
  const rayIn = size * 0.24;
  const rayOut = size * 0.4;
  const rays = 12;
  const rayHalfWidth = 0.06; // ラジアン

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 背景グラデーション
      const tb = clamp01((x + y) / (2 * size));
      let [r, g, b] = lerp3(bgTop, bgBot, tb);

      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      // 太陽本体（縦方向グラデーション）
      const sunCov = smooth(sunR + 1.2, sunR - 1.2, dist);
      if (sunCov > 0) {
        const tg = clamp01((y - (cy - sunR)) / (2 * sunR));
        const [sr, sg, sb] = lerp3(gold1, gold2, tg);
        r = lerp(r, sr, sunCov);
        g = lerp(g, sg, sunCov);
        b = lerp(b, sb, sunCov);
      }

      // 光線
      if (dist > rayIn - 2 && dist < rayOut + 2) {
        let ang = Math.atan2(dy, dx); // -PI..PI
        const step = (Math.PI * 2) / rays;
        // 最も近い光線の中心角との差
        let nearest = Math.round(ang / step) * step;
        let da = Math.abs(ang - nearest);
        da = Math.min(da, Math.PI * 2 - da);
        // 先細りさせる（外側ほど細く）
        const radial = clamp01((dist - rayIn) / (rayOut - rayIn));
        const halfW = rayHalfWidth * (1 - 0.6 * radial);
        const angCov = smooth(halfW + 0.012, halfW - 0.012, da);
        const radCov = smooth(rayIn - 1.5, rayIn + 1.5, dist) * smooth(rayOut + 1.5, rayOut - 1.5, dist);
        const cov = angCov * radCov;
        if (cov > 0) {
          const [sr, sg, sb] = gold1;
          r = lerp(r, sr, cov);
          g = lerp(g, sg, cov);
          b = lerp(b, sb, cov);
        }
      }

      const i = (y * size + x) * 4;
      buf[i] = Math.round(r);
      buf[i + 1] = Math.round(g);
      buf[i + 2] = Math.round(b);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

/** 2x supersample → box downsample で滑らかに */
function renderAA(size) {
  const ss = 2;
  const big = renderRGBA(size * ss);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const bi = ((y * ss + sy) * size * ss + (x * ss + sx)) * 4;
          r += big[bi]; g += big[bi + 1]; b += big[bi + 2]; a += big[bi + 3];
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = Math.round(a / n);
    }
  }
  return out;
}

// ---- PNGエンコード --------------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // 残りは0（圧縮/フィルタ/インターレース）
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---- 出力 -----------------------------------------------------------------
const outDir = path.resolve(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const png = encodePNG(size, renderAA(size));
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, png);
  console.log("wrote", file, png.length, "bytes");
}
