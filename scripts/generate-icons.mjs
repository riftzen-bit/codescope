#!/usr/bin/env node

/**
 * Pure Node.js icon generator — no external dependencies.
 * Creates resources/icon.png (1024x1024) from computed pixels.
 *
 * electron-builder auto-generates platform-specific formats:
 *   - Windows: icon.ico
 *   - macOS:   icon.icns
 *   - Linux:   uses icon.png directly
 *
 * Usage:  node scripts/generate-icons.mjs
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', 'apps', 'desktop', 'resources');

// ── Color palette ───────────────────────────────────────────────────────────
const C_BG1 = [79, 70, 229];    // #4F46E5 indigo
const C_BG2 = [124, 58, 237];   // #7C3AED purple
const C_WHITE = [255, 255, 255];
const C_BRACKET = [224, 231, 255]; // #E0E7FF
const C_CHECK = [52, 211, 153];   // #34D399 emerald

// ── Math helpers ────────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(x1, y1, x2, y2) { return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2); }

function lerpColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

/** Signed distance to a rounded rectangle centered at (cx,cy) with half-sizes (hw,hh) and radius r. */
function sdRoundedRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.max(Math.abs(x - cx) - hw + r, 0);
  const dy = Math.max(Math.abs(y - cy) - hh + r, 0);
  return Math.sqrt(dx * dx + dy * dy) - r;
}

/** Signed distance to a circle. Negative = inside. */
function sdCircle(x, y, cx, cy, r) {
  return dist(x, y, cx, cy) - r;
}

/** Signed distance to a line segment from (ax,ay) to (bx,by). */
function sdSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  const px = ax + t * dx, py = ay + t * dy;
  return dist(x, y, px, py);
}

/** Anti-aliased fill: returns alpha 0..1 from signed distance and AA width. */
function fill(sd, aa = 1.5) {
  return clamp(0.5 - sd / aa, 0, 1);
}

/** Anti-aliased stroke: ring shape at distance `radius` with `width`. */
function stroke(sd, radius, width, aa = 1.5) {
  return fill(Math.abs(sd - radius) - width / 2, aa);
}

// ── Bracket path builder ────────────────────────────────────────────────────
// Approximate curly brackets using line segments

function sdLeftBracket(x, y) {
  // { bracket — a series of connected arcs approximated as segments
  const cx = 310, topY = 280, botY = 740, midY = 510;
  const indent = 80, bulge = 50;

  // Top curve
  const d1 = sdSegment(x, y, cx, topY, cx, midY - 40);
  // Middle notch going left
  const d2 = sdSegment(x, y, cx, midY - 40, cx - bulge, midY);
  const d3 = sdSegment(x, y, cx - bulge, midY, cx, midY + 40);
  // Bottom curve
  const d4 = sdSegment(x, y, cx, midY + 40, cx, botY);
  // Top serif
  const d5 = sdSegment(x, y, cx, topY, cx + indent, topY - 20);
  // Bottom serif
  const d6 = sdSegment(x, y, cx, botY, cx + indent, botY + 20);

  return Math.min(d1, d2, d3, d4, d5, d6);
}

function sdRightBracket(x, y) {
  const cx = 714, topY = 280, botY = 740, midY = 510;
  const indent = 80, bulge = 50;

  const d1 = sdSegment(x, y, cx, topY, cx, midY - 40);
  const d2 = sdSegment(x, y, cx, midY - 40, cx + bulge, midY);
  const d3 = sdSegment(x, y, cx + bulge, midY, cx, midY + 40);
  const d4 = sdSegment(x, y, cx, midY + 40, cx, botY);
  const d5 = sdSegment(x, y, cx, topY, cx - indent, topY - 20);
  const d6 = sdSegment(x, y, cx, botY, cx - indent, botY + 20);

  return Math.min(d1, d2, d3, d4, d5, d6);
}

// ── Pixel shader ────────────────────────────────────────────────────────────

function shade(x, y, size) {
  // Normalized coordinates
  const u = x / size, v = y / size;

  // Background: rounded rect with gradient
  const bgDist = sdRoundedRect(x, y, size / 2, size / 2, size / 2, size / 2, size * 0.215);
  const bgAlpha = fill(bgDist);
  if (bgAlpha < 0.001) return [0, 0, 0, 0];

  const gradT = clamp((u + v) / 2, 0, 1);
  let r = lerp(C_BG1[0], C_BG2[0], gradT);
  let g = lerp(C_BG1[1], C_BG2[1], gradT);
  let b = lerp(C_BG1[2], C_BG2[2], gradT);

  // Subtle inner glow at top-left
  const glowDist = dist(x, y, size * 0.3, size * 0.3);
  const glowT = clamp(1 - glowDist / (size * 0.6), 0, 0.15);
  r = lerp(r, 255, glowT);
  g = lerp(g, 255, glowT);
  b = lerp(b, 255, glowT);

  // Left bracket {
  const lbDist = sdLeftBracket(x, y);
  const lbAlpha = fill(lbDist - 18, 2) * 0.85;
  if (lbAlpha > 0) {
    r = lerp(r, C_BRACKET[0], lbAlpha);
    g = lerp(g, C_BRACKET[1], lbAlpha);
    b = lerp(b, C_BRACKET[2], lbAlpha);
  }

  // Right bracket }
  const rbDist = sdRightBracket(x, y);
  const rbAlpha = fill(rbDist - 18, 2) * 0.85;
  if (rbAlpha > 0) {
    r = lerp(r, C_BRACKET[0], rbAlpha);
    g = lerp(g, C_BRACKET[1], rbAlpha);
    b = lerp(b, C_BRACKET[2], rbAlpha);
  }

  // Magnifying glass — circle
  const glassCx = size * 0.625, glassCy = size * 0.332;
  const glassR = size * 0.137;
  const ringDist = sdCircle(x, y, glassCx, glassCy, glassR);
  const ringAlpha = fill(Math.abs(ringDist) - size * 0.019, 1.5) * 0.95;
  if (ringAlpha > 0) {
    r = lerp(r, C_WHITE[0], ringAlpha);
    g = lerp(g, C_WHITE[1], ringAlpha);
    b = lerp(b, C_WHITE[2], ringAlpha);
  }

  // Magnifying glass — handle
  const handleDist = sdSegment(x, y, glassCx + glassR * 0.71, glassCy + glassR * 0.71, glassCx + glassR * 1.5, glassCy + glassR * 1.5);
  const handleAlpha = fill(handleDist - size * 0.019, 1.5) * 0.95;
  if (handleAlpha > 0) {
    r = lerp(r, C_WHITE[0], handleAlpha);
    g = lerp(g, C_WHITE[1], handleAlpha);
    b = lerp(b, C_WHITE[2], handleAlpha);
  }

  // Checkmark inside magnifying glass
  const chk1 = sdSegment(x, y, glassCx - glassR * 0.45, glassCy, glassCx - glassR * 0.1, glassCy + glassR * 0.35);
  const chk2 = sdSegment(x, y, glassCx - glassR * 0.1, glassCy + glassR * 0.35, glassCx + glassR * 0.5, glassCy - glassR * 0.4);
  const chkDist = Math.min(chk1, chk2);
  const chkAlpha = fill(chkDist - size * 0.017, 1.5);
  if (chkAlpha > 0) {
    r = lerp(r, C_CHECK[0], chkAlpha);
    g = lerp(g, C_CHECK[1], chkAlpha);
    b = lerp(b, C_CHECK[2], chkAlpha);
  }

  return [Math.round(r), Math.round(g), Math.round(b), Math.round(bgAlpha * 255)];
}

// ── PNG encoder (minimal, spec-compliant) ───────────────────────────────────

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const payload = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([len, payload, crc]);
}

function encodePNG(width, height, rgba) {
  // Build raw scanlines: filter byte 0 (None) + RGBA row
  const rowBytes = 1 + width * 4;
  const raw = Buffer.alloc(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const offset = y * rowBytes;
    raw[offset] = 0; // filter: None
    rgba.copy(raw, offset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Main ────────────────────────────────────────────────────────────────────

function generateIcon(size) {
  console.log(`Generating ${size}x${size} icon...`);
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = shade(x, y, size);
      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }

  return encodePNG(size, size, rgba);
}

// 1024x1024 — electron-builder source
const png1024 = generateIcon(1024);
writeFileSync(resolve(ROOT, 'icon.png'), png1024);
console.log('Wrote icon.png (1024x1024)');

// 256x256 — used by BrowserWindow on Linux
const png256 = generateIcon(256);
writeFileSync(resolve(ROOT, 'icon-256.png'), png256);
console.log('Wrote icon-256.png (256x256)');

console.log('Done.');
