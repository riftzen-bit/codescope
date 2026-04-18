#!/usr/bin/env node

/**
 * Pure Node.js icon generator — no external dependencies.
 * Creates resources/icon.png (1024x1024) from computed pixels.
 *
 * Design — "Ember" identity:
 *   - Warm plum-ink background (app's --bg-deep → --bg-elevated diagonal).
 *   - Two cream-paper code brackets framing a stylized amber ember inside.
 *   - Subtle radial highlight top-left, vignette bottom-right for depth.
 *   - Fine amber baseline under the ember, echoing a code cursor.
 *   - Inner rounded-rect inset so the ink reads as a pressed tile.
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

// ── Palette (matches app tokens in globals.css) ──────────────────────────────
const C_BG_DEEP = [18, 15, 21];       // #120F15 — --bg-deep
const C_BG      = [29, 24, 35];       // #1D1823 — --bg-secondary
const C_BG_HI   = [44, 37, 53];       // warm-plum highlight
const C_EMBER   = [232, 154, 60];     // #E89A3C — --accent
const C_EMBER_HI= [255, 198, 115];    // hotter ember core
const C_EMBER_DK= [179, 94, 26];      // ember base, darker
const C_CREAM   = [241, 235, 226];    // #F1EBE2 — --text
const C_CREAM_DIM = [200, 190, 175];
const C_INK_SHADOW = [8, 5, 12];

// ── Math helpers ────────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function smooth(t) { return t * t * (3 - 2 * t); }
function dist(x1, y1, x2, y2) { return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2); }

function lerpColor(c1, c2, t) {
  const tc = clamp(t, 0, 1);
  return [lerp(c1[0], c2[0], tc), lerp(c1[1], c2[1], tc), lerp(c1[2], c2[2], tc)];
}

function blend(base, top, alpha) {
  const a = clamp(alpha, 0, 1);
  return [
    base[0] + (top[0] - base[0]) * a,
    base[1] + (top[1] - base[1]) * a,
    base[2] + (top[2] - base[2]) * a,
  ];
}

/** Signed distance to a rounded rectangle centered at (cx,cy) with half-sizes (hw,hh) and radius r. */
function sdRoundedRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.max(Math.abs(x - cx) - hw + r, 0);
  const dy = Math.max(Math.abs(y - cy) - hh + r, 0);
  const outside = Math.sqrt(dx * dx + dy * dy) - r;
  // For interior points we also want a negative SD, so compute the max-norm
  // shrinkage and take min(outside, inside-negative).
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside;
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

// ── Bracket path — cleaner curly { shape via Bezier-approximating arcs ──────
// Uses a fan of segments to approximate a curly bracket with a crisp center notch.

function sdCurlyBracket(x, y, cx, topY, botY, mirrored, thickness = 22) {
  const midY = (topY + botY) / 2;
  const bulge = 58;      // depth of center notch
  const shoulder = 70;   // width of outer serif
  const quarter = (botY - topY) * 0.22;
  const s = mirrored ? -1 : 1;

  // Control points
  const p0x = cx + s * shoulder,     p0y = topY - 12;      // top serif tip
  const p1x = cx,                    p1y = topY + 14;      // top turn
  const p2x = cx,                    p2y = midY - quarter; // upper arm
  const p3x = cx - s * bulge,        p3y = midY;           // notch
  const p4x = cx,                    p4y = midY + quarter; // lower arm
  const p5x = cx,                    p5y = botY - 14;      // bottom turn
  const p6x = cx + s * shoulder,     p6y = botY + 12;      // bottom serif tip

  // Fan of segments between the control points
  let d = sdSegment(x, y, p0x, p0y, p1x, p1y);
  d = Math.min(d, sdSegment(x, y, p1x, p1y, p2x, p2y));
  d = Math.min(d, sdSegment(x, y, p2x, p2y, p3x, p3y));
  d = Math.min(d, sdSegment(x, y, p3x, p3y, p4x, p4y));
  d = Math.min(d, sdSegment(x, y, p4x, p4y, p5x, p5y));
  d = Math.min(d, sdSegment(x, y, p5x, p5y, p6x, p6y));

  // Stroke: distance to path minus half-thickness
  return d - thickness / 2;
}

// ── Ember (flame) — stylised teardrop, drawn as a union of circles ──────────

function sdEmber(x, y, cx, cy, scale) {
  // Teardrop: a large bottom bulb + a tapered top. Approximate via blended
  // circles. The union keeps it C1-continuous enough that the AA edge reads
  // smooth at 128px and up.
  const r1 = 90 * scale;   // bottom bulb
  const r2 = 70 * scale;   // mid
  const r3 = 48 * scale;   // shoulder
  const r4 = 26 * scale;   // tip
  const d1 = dist(x, y, cx,               cy + 60 * scale) - r1;
  const d2 = dist(x, y, cx + 10 * scale,  cy - 10 * scale) - r2;
  const d3 = dist(x, y, cx - 8 * scale,   cy - 70 * scale) - r3;
  const d4 = dist(x, y, cx + 4 * scale,   cy - 110 * scale) - r4;
  // Smooth-min union
  const k = 18 * scale;
  function smin(a, b) {
    const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
    return lerp(b, a, h) - k * h * (1 - h);
  }
  return smin(smin(smin(d1, d2), d3), d4);
}

// ── Pixel shader ────────────────────────────────────────────────────────────

function shade(x, y, size) {
  // Scale all design constants (authored at 1024) to the target size.
  const S = size / 1024;
  const sx = x / S, sy = y / S;  // "design space" coords

  // Background: large rounded rect, 21.5% radius — a soft iOS-ish tile.
  const bgDist = sdRoundedRect(x, y, size / 2, size / 2, size / 2, size / 2, size * 0.215);
  const bgAlpha = fill(bgDist);
  if (bgAlpha < 0.001) return [0, 0, 0, 0];

  // Base ink: diagonal warm-plum gradient.
  const gradT = clamp((sx + sy) / 2048, 0, 1);
  let rgb = lerpColor(C_BG_DEEP, C_BG, smooth(gradT));

  // Radial highlight top-left (subtle, adds tactile depth without glow).
  const hi = clamp(1 - dist(sx, sy, 320, 280) / 820, 0, 1);
  rgb = blend(rgb, C_BG_HI, hi * 0.35);

  // Vignette bottom-right.
  const vig = clamp(dist(sx, sy, 820, 860) / 780, 0, 1);
  rgb = blend(rgb, C_INK_SHADOW, vig * 0.22);

  // Inner inset "pressed tile" outline — 1.5px darker hairline inside the bg.
  const innerDist = sdRoundedRect(sx, sy, 512, 512, 440, 440, 180);
  const insetRing = clamp(0.5 - Math.abs(innerDist - 0) / 2, 0, 1);
  rgb = blend(rgb, C_INK_SHADOW, insetRing * 0.25);

  // Ember glow — large soft amber radial BEHIND the ember, behind brackets.
  const glowR = dist(sx, sy, 512, 560);
  const glow = clamp(1 - glowR / 420, 0, 1);
  rgb = blend(rgb, C_EMBER_DK, Math.pow(glow, 2.2) * 0.55);

  // Ember body.
  const emberSD = sdEmber(sx, sy, 512, 560, 1.0);
  const emberA = fill(emberSD, 2.5);
  if (emberA > 0) {
    // Inner hot core: lerp from outer amber to bright tip based on verticality.
    const coreT = clamp((500 - sy) / 260, 0, 1);
    const emberColor = lerpColor(C_EMBER, C_EMBER_HI, smooth(coreT));
    rgb = blend(rgb, emberColor, emberA);
  }

  // Inner ember highlight — small bright streak near the top of the flame.
  const streakSD = sdEmber(sx - 6, sy + 40, 512, 560, 0.55);
  const streakA = fill(streakSD, 2.5);
  if (streakA > 0) {
    rgb = blend(rgb, C_EMBER_HI, streakA * 0.85);
  }

  // Brackets — cream-paper, symmetric, framing the ember.
  const bracketThickness = 30;
  const lb = sdCurlyBracket(sx, sy, 276, 260, 860, false, bracketThickness);
  const rb = sdCurlyBracket(sx, sy, 748, 260, 860, true,  bracketThickness);
  const lbA = fill(lb, 2.5);
  const rbA = fill(rb, 2.5);

  if (lbA > 0) {
    // Subtle right-edge shadow so the cream reads as relief against ink.
    const shadowSD = sdCurlyBracket(sx - 4, sy + 4, 276, 260, 860, false, bracketThickness);
    const shA = fill(shadowSD, 2.5) * 0.35;
    rgb = blend(rgb, C_INK_SHADOW, shA);
    rgb = blend(rgb, C_CREAM, lbA);
  }
  if (rbA > 0) {
    const shadowSD = sdCurlyBracket(sx - 4, sy + 4, 748, 260, 860, true, bracketThickness);
    const shA = fill(shadowSD, 2.5) * 0.35;
    rgb = blend(rgb, C_INK_SHADOW, shA);
    rgb = blend(rgb, C_CREAM, rbA);
  }

  // Amber baseline under the ember — a fine cursor-line accent.
  const baselineSD = Math.abs(sy - 800) - 3;
  const baselineMask = Math.abs(sx - 512) < 140 ? 1 : 0;
  const baseA = fill(baselineSD, 1.5) * baselineMask;
  if (baseA > 0) rgb = blend(rgb, C_EMBER_HI, baseA * 0.9);

  // Three amber dots below baseline — hints of "findings".
  for (let i = -1; i <= 1; i++) {
    const dotSD = dist(sx, sy, 512 + i * 34, 830) - 5;
    const dotA = fill(dotSD, 1.5);
    if (dotA > 0) rgb = blend(rgb, C_CREAM_DIM, dotA * 0.6);
  }

  return [
    Math.round(clamp(rgb[0], 0, 255)),
    Math.round(clamp(rgb[1], 0, 255)),
    Math.round(clamp(rgb[2], 0, 255)),
    Math.round(bgAlpha * 255),
  ];
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
