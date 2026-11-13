// Shared drawing kit for the procedurally drawn preset pets.
//
// Everything is drawn in Codex cell units (192×208, feet on GROUND) and the
// caller scales the context, so the same code renders the 1× atlas and the
// 2× HD atlas. Drawing is deterministic (seeded noise), so re-rendering gives
// identical files.

const CELL_W = 192, CELL_H = 208;
const GROUND = 199, CX = 96;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(c, a) { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; }
function mix(c1, c2, t) {
  const a = hex(c1), b = hex(c2);
  return "#" + a.map((v, i) => Math.round(lerp(v, b[i], t)).toString(16).padStart(2, "0")).join("");
}

// ---------- paths ----------

function ellipsePath(g, cx, cy, rx, ry, rot = 0) {
  g.beginPath();
  g.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
}

// Egg: wider at the bottom (k > 0) or top (k < 0).
function eggPath(g, cx, cy, rx, ry, k = 0.18) {
  g.beginPath();
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TAU;
    const y = Math.sin(t);
    const x = Math.cos(t) * (1 + k * y);
    i ? g.lineTo(cx + x * rx, cy + y * ry) : g.moveTo(cx + x * rx, cy + y * ry);
  }
  g.closePath();
}

// Fluffy outline: an ellipse whose radius is pushed out into tufts.
function fluffPath(g, cx, cy, rx, ry, tufts, depth, seed, from = 0, to = TAU) {
  const r = rng(seed);
  const jit = Array.from({ length: tufts + 1 }, () => 0.6 + r() * 0.8);
  g.beginPath();
  const n = tufts * 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = -Math.PI / 2 + t * TAU;
    const inArc = ((a - from) % TAU + TAU) % TAU <= ((to - from) % TAU + TAU) % TAU || to - from >= TAU;
    const k = (t * tufts) % 1;
    const bump = inArc ? Math.pow(Math.sin(k * Math.PI), 0.7) * depth * jit[Math.floor(t * tufts)] : 0;
    const x = cx + Math.cos(a) * (rx + bump);
    const y = cy + Math.sin(a) * (ry + bump);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

// ---------- shading ----------

// Soft-vinyl / plush shading of the current path:
// light from the upper left, ambient occlusion underneath, rim light on the
// shadow side, a sheen highlight and a thin darker outline.
function shade(g, box, col, o = {}) {
  const { x, y, rx, ry } = box;
  const lx = x - rx * (0.35 - (o.lightShift || 0)), ly = y - ry * 0.5;
  const grad = g.createRadialGradient(lx, ly, Math.min(rx, ry) * 0.1, x, y + ry * 0.15, Math.max(rx, ry) * 1.25);
  grad.addColorStop(0, col.light);
  grad.addColorStop(0.5, col.base);
  grad.addColorStop(1, col.dark);
  g.fillStyle = grad;
  g.fill();

  g.save();
  g.clip();
  // Ambient occlusion along the bottom.
  if (o.ao !== 0) {
    const ao = g.createLinearGradient(0, y + ry * 0.25, 0, y + ry * 1.05);
    ao.addColorStop(0, rgba(col.dark, 0));
    ao.addColorStop(1, rgba(col.dark, o.ao ?? 0.45));
    g.fillStyle = ao;
    g.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 4);
  }
  // Rim light on the lower right.
  if (o.rim !== 0) {
    const rim = g.createRadialGradient(x - rx * 0.25, y - ry * 0.25, Math.max(rx, ry) * 0.85, x - rx * 0.25, y - ry * 0.25, Math.max(rx, ry) * 1.3);
    rim.addColorStop(0, "rgba(255,255,255,0)");
    rim.addColorStop(1, `rgba(255,248,235,${o.rim ?? 0.28})`);
    g.fillStyle = rim;
    g.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 4);
  }
  if (o.texture) o.texture(g);
  // Sheen.
  if (o.sheen !== 0) {
    const sh = g.createRadialGradient(lx, ly, 0, lx, ly, Math.min(rx, ry) * 0.55);
    sh.addColorStop(0, `rgba(255,255,255,${o.sheen ?? 0.32})`);
    sh.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sh;
    g.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 4);
  }
  g.restore();
  if (o.line !== 0) {
    g.lineWidth = o.lineWidth ?? 1.4;
    g.strokeStyle = o.line || col.line || col.dark;
    g.lineJoin = "round";
    g.stroke();
  }
}

// Short fur strokes scattered inside a box, following a downward flow.
function furStrokes(g, box, colors, seed, count = 90, len = 5, width = 0.7) {
  const r = rng(seed);
  g.lineCap = "round";
  g.lineWidth = width;
  for (let i = 0; i < count; i++) {
    const a = r() * TAU, d = Math.sqrt(r());
    const px = box.x + Math.cos(a) * box.rx * d;
    const py = box.y + Math.sin(a) * box.ry * d;
    const ang = Math.atan2(py - (box.y - box.ry * 1.2), px - box.x) + (r() - 0.5) * 0.6;
    const l = len * (0.6 + r() * 0.8);
    g.strokeStyle = colors[i % colors.length];
    g.beginPath();
    g.moveTo(px, py);
    g.quadraticCurveTo(px + Math.cos(ang) * l * 0.5 + 0.8, py + Math.sin(ang) * l * 0.5, px + Math.cos(ang) * l, py + Math.sin(ang) * l);
    g.stroke();
  }
}

// Flocked (velvet) speckle, like a felt toy.
function flock(g, box, color, seed, count = 160, size = 0.6) {
  const r = rng(seed);
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const a = r() * TAU, d = Math.sqrt(r());
    g.beginPath();
    g.arc(box.x + Math.cos(a) * box.rx * d, box.y + Math.sin(a) * box.ry * d, size * (0.5 + r()), 0, TAU);
    g.fill();
  }
}

function softSpot(g, x, y, rx, ry, color, alpha) {
  const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
  gr.addColorStop(0, rgba(color, alpha));
  gr.addColorStop(1, rgba(color, 0));
  g.save();
  g.translate(x, y);
  g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
  g.translate(-x, -y);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, Math.max(rx, ry), 0, TAU);
  g.fill();
  g.restore();
}

// ---------- face parts ----------

// Eye kinds: "bead" (small glossy black) or "anime" (big coloured iris).
function drawEye(g, x, y, s, pose, side, kind, iris) {
  const state = pose.eyes;
  const [lx, ly] = pose.look;
  g.lineCap = "round";
  g.lineJoin = "round";
  const lineCol = kind === "anime" ? "#2b1e1a" : "#1d1410";
  if (state === "blink" || state === "sleep" || state === "closed") {
    g.strokeStyle = lineCol; g.lineWidth = s * 0.32;
    g.beginPath();
    if (state === "blink") { g.moveTo(x - s, y + s * 0.1); g.quadraticCurveTo(x, y + s * 0.45, x + s, y + s * 0.1); }
    else { g.moveTo(x - s, y - s * 0.1); g.quadraticCurveTo(x, y + s * 0.75, x + s, y - s * 0.1); }
    g.stroke();
    if (kind === "anime" && state !== "blink") { // lashes
      g.lineWidth = s * 0.18;
      g.beginPath(); g.moveTo(x + side * s * 0.95, y - s * 0.05); g.lineTo(x + side * s * 1.35, y - s * 0.35); g.stroke();
    }
    return;
  }
  if (state === "happy") {
    g.strokeStyle = lineCol; g.lineWidth = s * 0.34;
    g.beginPath(); g.moveTo(x - s, y + s * 0.35); g.quadraticCurveTo(x, y - s * 0.75, x + s, y + s * 0.35); g.stroke();
    return;
  }
  if (state === "cry") { // > <
    g.strokeStyle = lineCol; g.lineWidth = s * 0.3;
    g.beginPath();
    g.moveTo(x - side * s * 0.9, y - s * 0.6); g.lineTo(x + side * s * 0.6, y); g.lineTo(x - side * s * 0.9, y + s * 0.6);
    g.stroke();
    return;
  }
  const wide = state === "wide" ? 1.15 : 1;
  const squint = state === "squint" ? 0.55 : 1;
  const ex = x + lx * s * 0.28, ey = y + ly * s * 0.25;
  if (kind === "bead") {
    const r = s * 0.78 * wide;
    g.save();
    if (squint < 1) { g.beginPath(); g.rect(x - s * 2, y - r * (squint * 1.4 - 0.4), s * 4, s * 4); g.clip(); }
    const gr = g.createRadialGradient(ex - r * 0.3, ey - r * 0.35, r * 0.1, ex, ey, r * 1.1);
    gr.addColorStop(0, "#4a3a32"); gr.addColorStop(0.55, "#16100c"); gr.addColorStop(1, "#050302");
    g.fillStyle = gr; ellipsePath(g, ex, ey, r * 0.92, r * (state === "wide" ? 1.1 : 1)); g.fill();
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.beginPath(); g.arc(ex - r * 0.32, ey - r * 0.38, r * 0.34, 0, TAU); g.fill();
    g.fillStyle = "rgba(255,255,255,0.6)";
    g.beginPath(); g.arc(ex + r * 0.35, ey + r * 0.35, r * 0.15, 0, TAU); g.fill();
    g.restore();
    if (squint < 1) {
      g.strokeStyle = lineCol; g.lineWidth = s * 0.26;
      g.beginPath(); g.moveTo(x - r * 1.1, y - r * 0.2); g.lineTo(x + r * 1.1, y - r * 0.35 * side); g.stroke();
    }
  } else {
    const rx = s * 0.95, ry = s * 1.12 * wide;
    g.save();
    ellipsePath(g, x, y, rx, ry);
    g.clip();
    // sclera hint
    g.fillStyle = "#fbf7f2"; g.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 4);
    // iris
    const ir = rx * (state === "wide" ? 0.82 : 0.9);
    const igr = g.createRadialGradient(ex, ey + ir * 0.35, ir * 0.1, ex, ey, ir * 1.05);
    igr.addColorStop(0, iris[0]); igr.addColorStop(0.55, iris[1]); igr.addColorStop(1, iris[2]);
    g.fillStyle = igr; ellipsePath(g, ex, ey, ir, ir * 1.12); g.fill();
    // iris ring + pupil
    g.strokeStyle = rgba(iris[2], 0.9); g.lineWidth = s * 0.12; g.stroke();
    g.fillStyle = "#120c14";
    ellipsePath(g, ex, ey + ir * 0.05, ir * (state === "wide" ? 0.3 : 0.42), ir * (state === "wide" ? 0.36 : 0.62)); g.fill();
    // lid shadow
    const lid = g.createLinearGradient(0, y - ry, 0, y - ry * 0.2);
    lid.addColorStop(0, "rgba(40,20,20,0.45)"); lid.addColorStop(1, "rgba(40,20,20,0)");
    g.fillStyle = lid; g.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 2);
    if (squint < 1) { g.fillStyle = "#e9dccb"; g.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * (2 - squint * 0.9)); }
    // highlights
    g.fillStyle = "rgba(255,255,255,0.97)";
    ellipsePath(g, ex - ir * 0.36, ey - ir * 0.42, ir * 0.34, ir * 0.3); g.fill();
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.beginPath(); g.arc(ex + ir * 0.38, ey + ir * 0.45, ir * 0.14, 0, TAU); g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)";
    ellipsePath(g, ex, ey + ir * 0.7, ir * 0.55, ir * 0.18); g.fill();
    g.restore();
    // upper lash line
    g.strokeStyle = lineCol; g.lineWidth = s * 0.3;
    const top = y - ry * (squint < 1 ? squint * 0.9 - 0.25 : 0.98);
    g.beginPath();
    g.moveTo(x - rx * 1.05, y - ry * 0.05);
    g.quadraticCurveTo(x - rx * 0.2, top - s * 0.25, x + rx * 1.05, y - ry * 0.25);
    g.stroke();
    g.lineWidth = s * 0.2;
    g.beginPath(); g.moveTo(x + side * rx * 1.0, y - ry * (side > 0 ? 0.25 : 0.05)); g.lineTo(x + side * rx * 1.4, y - ry * 0.55); g.stroke();
  }
}

function brows(g, x, y, s, side, mood, color) {
  if (!mood) return;
  g.strokeStyle = color; g.lineWidth = s * 0.28; g.lineCap = "round";
  g.beginPath();
  if (mood === "sad") { g.moveTo(x - side * s * 0.9, y - s * 0.1); g.lineTo(x + side * s * 0.7, y + s * 0.35); }
  else if (mood === "think") { g.moveTo(x - s * 0.8, y + side * s * 0.15); g.lineTo(x + s * 0.8, y - side * s * 0.15); }
  else if (mood === "focus") { g.moveTo(x - side * s * 0.9, y + s * 0.3); g.lineTo(x + side * s * 0.8, y - s * 0.05); }
  g.stroke();
}

function blush(g, x, y, r, amount) {
  if (amount <= 0) return;
  softSpot(g, x, y, r * 1.3, r * 0.8, "#ff6f8a", 0.45 * amount);
  if (amount > 0.5) { // little blush lines
    g.strokeStyle = `rgba(230,80,110,${0.5 * amount})`; g.lineWidth = r * 0.14; g.lineCap = "round";
    for (const d of [-0.45, 0, 0.45]) {
      g.beginPath(); g.moveTo(x + d * r - r * 0.12, y + r * 0.2); g.lineTo(x + d * r + r * 0.12, y - r * 0.2); g.stroke();
    }
  }
}

// Mouth kinds: smile, open, o, frown, flat, cat (ω), wobble
function drawMouth(g, x, y, s, kind, line = "#3a2420") {
  g.strokeStyle = line; g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = s * 0.16;
  g.beginPath();
  switch (kind) {
    case "cat":
      g.moveTo(x - s * 0.9, y - s * 0.05);
      g.quadraticCurveTo(x - s * 0.45, y + s * 0.55, x, y);
      g.quadraticCurveTo(x + s * 0.45, y + s * 0.55, x + s * 0.9, y - s * 0.05);
      g.stroke(); break;
    case "smile":
      g.moveTo(x - s * 0.6, y); g.quadraticCurveTo(x, y + s * 0.55, x + s * 0.6, y); g.stroke(); break;
    case "flat":
      g.moveTo(x - s * 0.45, y + s * 0.1); g.lineTo(x + s * 0.45, y + s * 0.05); g.stroke(); break;
    case "frown":
      g.moveTo(x - s * 0.55, y + s * 0.35); g.quadraticCurveTo(x, y - s * 0.15, x + s * 0.55, y + s * 0.35); g.stroke(); break;
    case "wobble":
      g.moveTo(x - s * 0.7, y + s * 0.2);
      for (let i = 1; i <= 4; i++) g.lineTo(x - s * 0.7 + i * s * 0.35, y + s * (i % 2 ? -0.05 : 0.2));
      g.stroke(); break;
    case "o":
    case "open": {
      const w = kind === "o" ? s * 0.38 : s * 0.75, h = kind === "o" ? s * 0.5 : s * 0.62;
      g.beginPath();
      if (kind === "o") g.ellipse(x, y + h * 0.5, w, h, 0, 0, TAU);
      else { g.moveTo(x - w, y); g.quadraticCurveTo(x, y + h * 2.2, x + w, y); g.closePath(); }
      g.fillStyle = "#7a2b33"; g.fill();
      g.save(); g.clip();
      g.fillStyle = "#ff8f9e"; ellipsePath(g, x, y + h * 1.3, w * 0.75, h * 0.6); g.fill();
      g.restore();
      g.lineWidth = s * 0.13; g.stroke();
    }
  }
}

// ---------- effects ----------

function drop(g, x, y, s, color = "#7cc8ff") {
  g.beginPath();
  g.moveTo(x, y - s * 1.3);
  g.bezierCurveTo(x + s * 0.2, y - s * 0.6, x + s, y - s * 0.1, x + s * 0.0, y + s * 0.95 - s * 0.9 + s * 0.9);
  g.bezierCurveTo(x - s, y - s * 0.1, x - s * 0.2, y - s * 0.6, x, y - s * 1.3);
  g.closePath();
  const gr = g.createLinearGradient(x, y - s, x, y + s);
  gr.addColorStop(0, "#d8f1ff"); gr.addColorStop(1, color);
  g.fillStyle = gr; g.fill();
  g.strokeStyle = "rgba(40,110,170,0.7)"; g.lineWidth = s * 0.16; g.stroke();
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath(); g.arc(x - s * 0.3, y - s * 0.15, s * 0.2, 0, TAU); g.fill();
}

function heart(g, x, y, s, color = "#ff5d7e") {
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.moveTo(0, s * 0.35);
  g.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.55, -s * 1.1, 0, -s * 0.5);
  g.bezierCurveTo(s * 0.55, -s * 1.1, s * 1.1, -s * 0.35, 0, s * 0.35);
  g.closePath();
  const gr = g.createRadialGradient(-s * 0.3, -s * 0.6, s * 0.05, 0, -s * 0.2, s * 1.1);
  gr.addColorStop(0, "#ffc2cf"); gr.addColorStop(0.5, color); gr.addColorStop(1, "#c8314f");
  g.fillStyle = gr; g.fill();
  g.strokeStyle = "rgba(150,20,50,0.6)"; g.lineWidth = s * 0.12; g.stroke();
  g.fillStyle = "rgba(255,255,255,0.8)";
  ellipsePath(g, -s * 0.42, -s * 0.55, s * 0.18, s * 0.12, -0.6); g.fill();
  g.restore();
}

function sparkle(g, x, y, s, color = "#ffd75e") {
  g.save();
  g.translate(x, y);
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 ? s * 0.28 : s;
    const a = (i / 8) * TAU - Math.PI / 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = color; g.fill();
  g.strokeStyle = "rgba(190,130,20,0.7)"; g.lineWidth = s * 0.1; g.stroke();
  g.restore();
}

function glyph(g, text, x, y, s, color = "#5a4a6a", rot = 0) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.font = `900 ${s}px "Arial Rounded MT Bold", "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = s * 0.22; g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineJoin = "round";
  g.strokeText(text, 0, 0);
  g.fillStyle = color; g.fillText(text, 0, 0);
  g.restore();
}

function puff(g, x, y, s) {
  g.fillStyle = "rgba(235,240,250,0.95)";
  g.strokeStyle = "rgba(120,130,150,0.6)"; g.lineWidth = s * 0.1;
  for (const [dx, dy, r] of [[0, 0, 0.55], [0.55, -0.1, 0.42], [1.0, 0.05, 0.3]]) {
    g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, TAU); g.fill(); g.stroke();
  }
}

function motion(g, x, y, s, n = 3, color = "rgba(120,110,140,0.55)") {
  g.strokeStyle = color; g.lineWidth = s * 0.12; g.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.5;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.6);
    g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
    g.stroke();
  }
}

// Effects anchored to the head: { kind, ... } with head-relative offsets.
function drawFx(g, fx, head) {
  for (const f of fx) {
    const x = head.x + (f.dx || 0), y = head.y + (f.dy || 0), s = f.s || 6;
    switch (f.kind) {
      case "tear": drop(g, x, y, s); break;
      case "sweat": drop(g, x, y, s, "#9fd8ff"); break;
      case "heart": heart(g, x, y, s); break;
      case "sparkle": sparkle(g, x, y, s, f.color); break;
      case "text": glyph(g, f.text, x, y, s, f.color, f.rot || 0); break;
      case "puff": puff(g, x, y, s); break;
      case "motion": motion(g, x, y, s, f.n || 3); break;
    }
  }
}

// ---------- poses ----------
//
// A pose drives every character the same way:
//   dx/dy/rot/sx/sy  whole-body transform (feet stay planted at sx/sy)
//   yaw (-1..1, + = turned to the viewer's right), pitch (-1 up .. 1 down)
//   eyes, look [x,y], mouth, brow, blush
//   arm angles armL/armR (0 = hanging, +π/2 = straight out, π = up, < 0 = across the front)
//   feet {dx, dy}, tail, ear, headTilt, hold (keep holding the prop), fx []

function basePose() {
  return {
    dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, yaw: 0, pitch: 0, headTilt: 0,
    eyes: "open", look: [0, 0], mouth: "smile", brow: null, blush: 0.35,
    armL: 0.25, armR: 0.25, footL: { dx: 0, dy: 0 }, footR: { dx: 0, dy: 0 },
    tail: 0, ear: 0, hold: true, fx: [], prop: "held",
  };
}

const P = (o) => Object.assign(basePose(), o);

// Frames per Codex row (row index, frame count).
const ROWS = [
  ["idle", 6], ["running-right", 8], ["running-left", 8], ["waving", 4], ["jumping", 5],
  ["failed", 8], ["waiting", 6], ["running", 6], ["review", 6],
];

function rowPoses(name, n) {
  const out = [];
  for (let f = 0; f < n; f++) {
    const t = f / n, w = Math.sin(t * TAU);
    switch (name) {
      case "idle":
        out.push(P({
          dy: -w * 1.0, sy: 1 + 0.012 * w, sx: 1 - 0.008 * w,
          eyes: f === 2 ? "blink" : "open", tail: w * 0.18, ear: f === 4 ? 1 : 0,
          look: f === 4 ? [0.25, 0] : [0, 0], headTilt: f === 4 ? 0.03 : 0,
        }));
        break;
      case "running-right": {
        const ph = t * TAU;
        out.push(P({
          yaw: 0.6, rot: 0.06, dy: -Math.abs(Math.sin(ph)) * 3.2,
          footL: { dx: Math.sin(ph) * 9, dy: -Math.max(0, Math.cos(ph)) * 6 },
          footR: { dx: -Math.sin(ph) * 9, dy: -Math.max(0, -Math.cos(ph)) * 6 },
          armL: 0.35 - Math.sin(ph) * 0.55, armR: 0.35 + Math.sin(ph) * 0.55,
          look: [0.7, 0], tail: Math.sin(ph * 2) * 0.25, mouth: "smile", blush: 0.45,
        }));
        break;
      }
      case "waving": {
        const a = [0, 0.4, 0, -0.4][f];
        out.push(P({
          armR: 2.55 + a, armL: 0.2, eyes: "happy", mouth: "open", blush: 0.85,
          headTilt: -0.05 + a * 0.06, hold: true, prop: "oneHand",
          fx: f % 2 ? [{ kind: "sparkle", dx: 40, dy: -36, s: 6 }] : [{ kind: "sparkle", dx: 44, dy: -28, s: 4.5 }],
        }));
        break;
      }
      case "jumping": {
        const frames = [
          { sy: 0.86, sx: 1.1, dy: 0, armL: -0.1, armR: -0.1, eyes: "closed", mouth: "smile" },
          { sy: 1.1, sx: 0.93, dy: -12, armL: 2.2, armR: 2.2, eyes: "happy", mouth: "open", prop: "raised" },
          { sy: 1.03, sx: 0.98, dy: -24, armL: 2.6, armR: 2.6, eyes: "happy", mouth: "open", prop: "raised", footL: { dx: -2, dy: -5 }, footR: { dx: 2, dy: -5 }, fx: [{ kind: "sparkle", dx: -44, dy: -30, s: 5 }, { kind: "sparkle", dx: 46, dy: -20, s: 4 }] },
          { sy: 1.05, sx: 0.97, dy: -14, armL: 1.5, armR: 1.5, eyes: "wide", mouth: "o", prop: "raised", footL: { dx: -3, dy: 2 }, footR: { dx: 3, dy: 2 } },
          { sy: 0.88, sx: 1.08, dy: 0, armL: 0.7, armR: 0.7, eyes: "happy", mouth: "smile" },
        ];
        out.push(P(Object.assign({ blush: 0.6 }, frames[f])));
        break;
      }
      case "failed": {
        const tearN = Math.min(f, 5);
        const base = { eyes: "open", brow: "sad", mouth: "frown", pitch: 0.25, armL: 0.08, armR: 0.08, blush: 0.15, look: [0, 0.5], dy: 1, prop: "low" };
        const frames = [
          {},
          { fx: [{ kind: "tear", dx: -20, dy: 8, s: 3 }] },
          { fx: [{ kind: "tear", dx: -20, dy: 12, s: 3.6 }, { kind: "tear", dx: 22, dy: 8, s: 3 }] },
          { eyes: "closed", mouth: "flat", fx: [{ kind: "puff", dx: 22, dy: 22, s: 7 }] },
          { eyes: "cry", mouth: "wobble", fx: [{ kind: "tear", dx: -22, dy: 16, s: 4 }, { kind: "tear", dx: 24, dy: 12, s: 4 }] },
          { eyes: "cry", mouth: "open", headTilt: 0.04, fx: [{ kind: "tear", dx: -26, dy: 10, s: 4.4 }, { kind: "tear", dx: 28, dy: 18, s: 4.4 }] },
          { eyes: "cry", mouth: "wobble", headTilt: -0.04, fx: [{ kind: "tear", dx: -25, dy: 20, s: 4.6 }, { kind: "tear", dx: 27, dy: 10, s: 4.6 }] },
          { eyes: "closed", mouth: "frown", sy: 0.9, sx: 1.05, dy: 3, pitch: 0.45, armL: -0.05, armR: -0.05, fx: [{ kind: "tear", dx: -22, dy: 14, s: 3.6 }, { kind: "text", text: "…", dx: 34, dy: -34, s: 14, color: "#6a6080" }] },
        ];
        out.push(P(Object.assign({}, base, frames[f], { tail: -0.3 - tearN * 0.02 })));
        break;
      }
      case "waiting": {
        const lx = [0, -0.7, -0.7, 0, 0.7, 0.7][f];
        out.push(P({
          eyes: f === 3 ? "blink" : "wide", mouth: "o", look: [lx, -0.1], yaw: lx * 0.25,
          armL: 0.7, armR: 0.7, rot: lx * 0.03, blush: 0.4, prop: "oneHand",
          fx: f >= 4 ? [{ kind: "sweat", dx: 34, dy: -18, s: 4.2 }] : [],
        }));
        break;
      }
      case "running": { // Codex: "working"
        const up = f % 2;
        out.push(P({
          eyes: "squint", brow: "focus", mouth: f % 3 === 2 ? "flat" : "smile", pitch: 0.3, look: [0, 0.8],
          armL: up ? -0.35 : -0.75, armR: up ? -0.75 : -0.35, dy: up ? -0.8 : 0, blush: 0.25, prop: "work",
          fx: [
            ...(f >= 3 ? [{ kind: "sweat", dx: 36, dy: -22, s: 3.8 }] : []),
            { kind: "motion", dx: up ? -26 : 26, dy: 52, s: 7, n: 3 },
          ],
        }));
        break;
      }
      case "review": {
        const frames = [
          { look: [-0.6, -0.7], eyes: "open", brow: "think", mouth: "flat" },
          { look: [-0.7, -0.7], eyes: "open", brow: "think", mouth: "flat", fx: [{ kind: "text", text: "?", dx: -40, dy: -40, s: 16, color: "#7a62c9", rot: -0.2 }] },
          { look: [-0.3, -0.8], eyes: "blink", brow: "think", mouth: "flat", fx: [{ kind: "text", text: "?", dx: -42, dy: -44, s: 18, color: "#7a62c9", rot: -0.15 }] },
          { look: [0.5, -0.6], eyes: "open", brow: "think", mouth: "wobble", fx: [{ kind: "text", text: "?", dx: -40, dy: -42, s: 16, color: "#7a62c9" }] },
          { eyes: "wide", mouth: "o", fx: [{ kind: "text", text: "!", dx: 40, dy: -44, s: 20, color: "#e8792f" }, { kind: "sparkle", dx: -40, dy: -36, s: 6 }] },
          { eyes: "happy", mouth: "open", blush: 0.7, pitch: 0.12, fx: [{ kind: "sparkle", dx: 42, dy: -40, s: 7 }, { kind: "sparkle", dx: -44, dy: -28, s: 4.5 }] },
        ];
        out.push(P(Object.assign({ armR: -2.55, armL: 0.15, headTilt: 0.06, prop: "oneHand" }, frames[f])));
        break;
      }
    }
  }
  return out;
}

// 16 look directions, 0° = up, clockwise.
function lookPoses() {
  const out = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const x = Math.sin(a), y = -Math.cos(a);
    out.push(P({ yaw: x * 0.55, pitch: y * 0.55, look: [x, y], headTilt: x * 0.04, blush: 0.4 }));
  }
  return out;
}

// Applies the whole-body transform and calls draw(g, pose, rig) per character.
function drawFrame(g, character, pose) {
  g.save();
  g.translate(CX + pose.dx, GROUND + pose.dy);
  g.rotate(pose.rot);
  g.scale(pose.sx, pose.sy);
  character.draw(g, pose);
  g.restore();
}

window.RIG = {
  CELL_W, CELL_H, GROUND, CX, TAU, rng, lerp, rgba, mix,
  ellipsePath, eggPath, fluffPath, roundRectPath, shade, furStrokes, flock, softSpot,
  drawEye, brows, blush, drawMouth, drawFx, drop, heart, sparkle,
  ROWS, rowPoses, lookPoses, drawFrame, P,
};
