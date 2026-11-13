// The three preset pets, drawn with rig.js:
//   mianmian 棉棉 — ragdoll kitten
//   qiqi     栖栖 — anime girl, Coquou's mascot (little bird hair clip)
//
// Local coordinates: origin at the feet on the ground, y grows downward
// (so the body lives at negative y).

(() => {
const R = window.RIG;
const { TAU, ellipsePath, eggPath, fluffPath, shade, furStrokes, flock, softSpot,
  drawEye, brows, blush, drawMouth, drawFx, rgba } = R;

// Tapered capsule from (x0,y0,r0) to (x1,y1,r1).
function capsulePath(g, x0, y0, r0, x1, y1, r1) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.beginPath();
  g.arc(x0, y0, r0, a + Math.PI / 2, a - Math.PI / 2);
  g.arc(x1, y1, r1, a - Math.PI / 2, a + Math.PI / 2);
  g.closePath();
}

// Fill the current capsule path with a cylinder-like gradient across it.
function shadeCapsule(g, x0, y0, x1, y1, r, col, lw = 1.1) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const nx = -Math.sin(a), ny = Math.cos(a);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const gr = g.createLinearGradient(mx - nx * r, my - ny * r, mx + nx * r, my + ny * r);
  // light comes from the upper left: pick the normal side facing it
  const lit = nx * -0.7 + ny * -0.7 > 0;
  const [c0, c1] = lit ? [col.light, col.dark] : [col.dark, col.light];
  gr.addColorStop(0, c0); gr.addColorStop(0.45, col.base); gr.addColorStop(1, c1);
  g.fillStyle = gr; g.fill();
  g.strokeStyle = col.line; g.lineWidth = lw; g.lineJoin = "round"; g.stroke();
}

// Arm: from the shoulder at angle a (0 = down, + = outward, < 0 = across the front).
function arm(g, sx, sy, a, side, len, sleeve, skin, o = {}) {
  const dx = side * Math.sin(a), dy = Math.cos(a);
  const ex = sx + dx * len, ey = sy + dy * len;
  const w = (o.w ?? 7) / 2;
  // forearm / whole arm
  capsulePath(g, sx, sy, w * 1.05, ex, ey, w * 0.85);
  shadeCapsule(g, sx, sy, ex, ey, w, skin);
  // sleeve over the upper part
  if (sleeve) {
    const sl = o.sleeveLen ?? 0.6;
    const mx = sx + dx * len * sl, my = sy + dy * len * sl;
    const sw = (o.sleeveW ?? 10) / 2;
    if (o.puff) {
      ellipsePath(g, sx + dx * 3, sy + dy * 3, sw * 1.15, sw * 1.05, Math.atan2(dy, dx));
      shade(g, { x: sx + dx * 3, y: sy + dy * 3, rx: sw, ry: sw }, sleeve, { ao: 0.25, rim: 0.2, sheen: 0.35, lineWidth: 1.1 });
      g.strokeStyle = sleeve.cuff; g.lineWidth = 1.8; g.lineCap = "round";
      const cx = sx + dx * (3 + sw * 0.95), cy = sy + dy * (3 + sw * 0.95);
      g.beginPath(); g.moveTo(cx - dy * sw * 0.85, cy + dx * sw * 0.85); g.lineTo(cx + dy * sw * 0.85, cy - dx * sw * 0.85); g.stroke();
    } else {
      capsulePath(g, sx, sy, sw * 1.05, mx, my, sw * 0.92);
      shadeCapsule(g, sx, sy, mx, my, sw, sleeve, 1.2);
      // ribbed cuff
      capsulePath(g, mx - dx * 2.2, my - dy * 2.2, sw * 0.86, mx, my, sw * 0.86);
      shadeCapsule(g, mx - dx * 2.2, my - dy * 2.2, mx, my, sw * 0.86,
        { light: sleeve.cuff, base: sleeve.cuff, dark: sleeve.dark, line: sleeve.line }, 1);
    }
  }
  // hand / paw
  const hr = o.hand ?? 4.8;
  ellipsePath(g, ex + dx * 1.2, ey + dy * 1.2, hr, hr * 0.95);
  shade(g, { x: ex + dx * 1.2, y: ey + dy * 1.2, rx: hr, ry: hr }, skin, { ao: 0.2, rim: 0.15, sheen: 0.45, lineWidth: 1.1, line: skin.line });
  if (o.toes) {
    g.strokeStyle = rgba(skin.line, 0.75); g.lineWidth = 0.7; g.lineCap = "round";
    for (const t of [-1, 1]) {
      const px = ex + dx * (1.2 + hr * 0.55) + dy * t * hr * 0.32, py = ey + dy * (1.2 + hr * 0.55) - dx * t * hr * 0.32;
      g.beginPath(); g.moveTo(px - dx * 1.6, py - dy * 1.6); g.lineTo(px, py); g.stroke();
    }
  }
}

// Leg from hip to foot plus a shoe.
function leg(g, hx, hy, fx, fy, skin, sock, shoe, yaw, side) {
  g.lineCap = "round";
  g.strokeStyle = skin.line; g.lineWidth = 8.6;
  g.beginPath(); g.moveTo(hx, hy); g.lineTo(fx, fy - 4); g.stroke();
  g.strokeStyle = skin.base; g.lineWidth = 6.6;
  g.beginPath(); g.moveTo(hx, hy); g.lineTo(fx, fy - 4); g.stroke();
  if (sock) {
    const t = sock.from;
    const sx = hx + (fx - hx) * t, sy = hy + (fy - 4 - hy) * t;
    g.strokeStyle = sock.line; g.lineWidth = 9;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(fx, fy - 4); g.stroke();
    g.strokeStyle = sock.base; g.lineWidth = 7;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(fx, fy - 4); g.stroke();
  }
  const sx = fx + yaw * 3 + side * 0.5;
  eggPath(g, sx, fy - 3.2, 8.2, 4.8, 0.15);
  shade(g, { x: sx, y: fy - 3.2, rx: 8.2, ry: 4.8 }, shoe, { ao: 0.3, rim: 0.2, sheen: 0.55, lineWidth: 1.2 });
  if (shoe.sole) {
    g.strokeStyle = shoe.sole; g.lineWidth = 1.6;
    g.beginPath(); g.ellipse(sx, fy - 2.6, 7.6, 3.6, 0, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  }
}

function facePath(g, x, y, rx, ry, yaw) {
  g.beginPath();
  g.moveTo(x - rx, y);
  g.bezierCurveTo(x - rx, y - ry * 1.36, x + rx, y - ry * 1.36, x + rx, y);
  g.bezierCurveTo(x + rx, y + ry * 0.62, x + rx * 0.42 + yaw * 7, y + ry * 0.97, x + yaw * 9, y + ry);
  g.bezierCurveTo(x - rx * 0.42 + yaw * 7, y + ry * 0.97, x - rx, y + ry * 0.62, x - rx, y);
  g.closePath();
}

// Eye with perspective squash on the far side when the head turns.
function eye(g, x, y, s, p, side, iris) {
  const far = Math.max(0, -side * p.yaw);
  g.save();
  g.translate(x, y);
  g.scale(1 - 0.38 * far, 1);
  g.translate(-x, -y);
  drawEye(g, x, y, s, p, side, "anime", iris);
  g.restore();
}

// Anime hair: bangs as a row of tapered locks under a dome.
function bangsPath(g, x, y, rx, ry, locks, yaw) {
  const top = y - ry * 1.2;
  const L = x - rx * 1.1, Rr = x + rx * 1.1;
  g.beginPath();
  g.moveTo(L, y + ry * 0.1);
  g.bezierCurveTo(L - rx * 0.05, top - ry * 0.25, Rr + rx * 0.05, top - ry * 0.25, Rr, y + ry * 0.1);
  // run back along the fringe, right to left
  for (let i = locks.length - 1; i >= 0; i--) {
    const [cxr, tipY, w, curl] = locks[i];
    const cx = x + cxr * rx + yaw * 6;
    const ty = y + tipY * ry;
    const root = y - ry * 0.62;
    g.quadraticCurveTo(cx + w * rx * 0.6, root + (ty - root) * 0.35, cx + curl * rx * 0.25, ty);
    g.quadraticCurveTo(cx - w * rx * 0.35, root + (ty - root) * 0.5, cx - w * rx * 0.9, root + (ty - root) * 0.2);
  }
  g.closePath();
}

function hairShine(g, x, y, rx, ry, col, yaw) {
  // "Angel ring": a broken light band across the crown.
  g.save();
  g.strokeStyle = rgba(col.shine, 0.85);
  g.lineCap = "round";
  for (let i = 0; i < 5; i++) {
    const a0 = Math.PI * (1.18 + i * 0.13) + yaw * 0.12, a1 = a0 + 0.08;
    g.lineWidth = i % 2 ? 2.2 : 3.2;
    g.beginPath(); g.ellipse(x + yaw * 4, y - ry * 0.35, rx * 0.86, ry * 0.62, 0, a0, a1); g.stroke();
  }
  g.restore();
}

function strands(g, x, y, rx, ry, col, seed, n = 9) {
  const r = R.rng(seed);
  g.strokeStyle = rgba(col.dark, 0.55); g.lineWidth = 0.8; g.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const sx = x + (r() - 0.5) * rx * 1.6;
    g.beginPath();
    g.moveTo(sx, y - ry * 1.05);
    g.quadraticCurveTo(sx + (r() - 0.5) * rx * 0.5, y - ry * 0.4, sx + (r() - 0.5) * rx * 0.8, y + ry * (0.0 + r() * 0.4));
    g.stroke();
  }
}

// ---------- shared human figure ----------

const SKIN = { light: "#fff6f0", base: "#ffe4d4", dark: "#f1bca5", line: "#d0937e" };

function humanDraw(cfg) {
  return function draw(g, p) {
    const yaw = p.yaw, pitch = p.pitch;
    const neck = { x: yaw * 1.5, y: -64 };
    const H = { x: yaw * 3, y: -100 + pitch * 2, rx: 37, ry: 34 };

    // Head group transform (tilt around the neck).
    const headT = (fn) => {
      g.save();
      g.translate(neck.x, neck.y); g.rotate(p.headTilt + yaw * 0.03); g.translate(-neck.x, -neck.y);
      fn();
      g.restore();
    };

    headT(() => cfg.backHair(g, H, p));
    if (cfg.behindBody) cfg.behindBody(g, p);

    // legs
    for (const side of [-1, 1]) {
      const f = side < 0 ? p.footL : p.footR;
      leg(g, side * 6.5 + yaw * 2, -24, side * 8.5 + f.dx + yaw * 2.5, f.dy, SKIN, cfg.sock, cfg.shoe, yaw, side);
    }
    cfg.body(g, p);

    const front = [];
    for (const side of [-1, 1]) {
      const a = side < 0 ? p.armL : p.armR;
      const sh = { x: side * 13.5 + yaw * 2, y: -58 };
      const drawArm = () => arm(g, sh.x, sh.y, a, side, 23, cfg.sleeve, SKIN, cfg.armOpts);
      if (a < -1.5 || a > 1.9) front.push(drawArm); else drawArm();
    }

    headT(() => {
      // neck
      g.fillStyle = SKIN.dark;
      g.fillRect(neck.x - 5, neck.y - 8, 10, 10);
      facePath(g, H.x, H.y, H.rx, H.ry, yaw);
      shade(g, H, SKIN, { ao: 0.18, rim: 0.12, sheen: 0.18, lineWidth: 1.3, line: SKIN.line, lightShift: yaw * 0.2 });
      const fx = H.x + yaw * 11, fy = H.y + pitch * 6;
      // eyes
      for (const side of [-1, 1]) {
        const ex = fx + side * 15.5 * (1 - 0.12 * Math.max(0, -side * yaw));
        eye(g, ex, fy + 7, 9, p, side, cfg.iris);
        brows(g, ex, fy - 7, 7, side, p.brow, cfg.hair.dark);
      }
      // blush, nose, mouth
      for (const side of [-1, 1]) blush(g, fx + side * 23, fy + 19, 7, p.blush);
      g.fillStyle = rgba(SKIN.line, 0.7);
      g.beginPath(); g.arc(fx + yaw * 3, fy + 16, 0.9, 0, TAU); g.fill();
      drawMouth(g, fx + yaw * 2, fy + 22, 4.2, p.mouth, "#8a3f3f");
      if (cfg.face) cfg.face(g, H, p, fx, fy);
      cfg.frontHair(g, H, p);
      hairShine(g, H.x, H.y, H.rx, H.ry, cfg.hair, yaw);
      if (cfg.accessory) cfg.accessory(g, H, p);
    });

    for (const f of front) f();
    drawFx(g, p.fx, { x: H.x, y: H.y });
  };
}

// ---------- 栖栖 (girl) ----------

const QH = { light: "#ffd9d6", base: "#f4a3ac", dark: "#c76d82", line: "#94485f", shine: "#fff3f0" };
const NAVY = { light: "#7182b8", base: "#3f4c80", dark: "#262f58", line: "#1b2142" };
const WHITE = { light: "#ffffff", base: "#f6f5fb", dark: "#d4d3e3", line: "#9c9ab4" };

const qiqi = {
  id: "qiqi",
  displayName: "栖栖",
  description: "Coquou 的看板娘，头上停着一只小黄鸟。",
  iris: ["#ffe9a8", "#ee8a6a", "#8a2f4a"],
  hair: QH,
  sock: { from: 0.35, base: "#ffffff", line: "#b9b7cc" },
  shoe: { light: "#c08a64", base: "#8a5534", dark: "#5a321d", line: "#3f2213" },
  sleeve: Object.assign({ cuff: "#3f4c80" }, WHITE),
  armOpts: { puff: true, sleeveW: 12, w: 6.4, hand: 4.4 },
  backHair(g, H, p) {
    const x = H.x - p.yaw * 3, y = H.y;
    // side ponytail (viewer's left), swings with the tail parameter
    g.save();
    g.translate(x - H.rx * 0.95, y - H.ry * 0.35);
    g.rotate(0.25 + p.tail * 0.6 + p.dy * -0.004);
    g.beginPath();
    g.moveTo(-3, 0);
    g.bezierCurveTo(-24, 8, -26, 40, -14, 64);
    g.quadraticCurveTo(-11, 56, -7, 68);
    g.quadraticCurveTo(-3, 56, 1, 64);
    g.quadraticCurveTo(3, 54, 7, 58);
    g.bezierCurveTo(12, 36, 12, 12, 5, 0);
    g.closePath();
    shade(g, { x: -8, y: 30, rx: 14, ry: 34 }, QH, { ao: 0.3, rim: 0.2, sheen: 0.25, lineWidth: 1.3, line: QH.line });
    g.save(); g.clip(); strands(g, -8, 34, 10, 30, QH, 7, 5); g.restore();
    g.restore();
    // long back hair
    g.beginPath();
    g.moveTo(x - H.rx * 1.12, y);
    g.bezierCurveTo(x - H.rx * 1.25, y - H.ry * 1.5, x + H.rx * 1.25, y - H.ry * 1.5, x + H.rx * 1.12, y);
    g.bezierCurveTo(x + H.rx * 1.18, y + H.ry * 0.8, x + H.rx * 1.05, y + H.ry * 1.25, x + H.rx * 0.9, y + H.ry * 1.45);
    g.quadraticCurveTo(x + H.rx * 0.7, y + H.ry * 1.1, x + H.rx * 0.55, y + H.ry * 1.35);
    g.lineTo(x - H.rx * 0.55, y + H.ry * 1.35);
    g.quadraticCurveTo(x - H.rx * 0.7, y + H.ry * 1.1, x - H.rx * 0.9, y + H.ry * 1.45);
    g.bezierCurveTo(x - H.rx * 1.05, y + H.ry * 1.25, x - H.rx * 1.18, y + H.ry * 0.8, x - H.rx * 1.12, y);
    g.closePath();
    shade(g, { x, y: y + 4, rx: H.rx * 1.15, ry: H.ry * 1.3 }, QH, { ao: 0.45, rim: 0.15, sheen: 0.1, lineWidth: 1.4, line: QH.line });
  },
  body(g, p) {
    const yx = p.yaw * 2;
    // skirt
    g.beginPath();
    g.moveTo(yx - 14, -44); g.lineTo(yx + 14, -44);
    g.quadraticCurveTo(yx + 22, -32, yx + 25, -20);
    g.quadraticCurveTo(yx, -16, yx - 25, -20);
    g.quadraticCurveTo(yx - 22, -32, yx - 14, -44);
    g.closePath();
    shade(g, { x: yx, y: -32, rx: 25, ry: 13 }, NAVY, { ao: 0.35, rim: 0.2, sheen: 0.2, lineWidth: 1.3 });
    g.save(); g.clip();
    g.strokeStyle = rgba(NAVY.dark, 0.9); g.lineWidth = 1;
    for (const d of [-14, -7, 0, 7, 14]) { g.beginPath(); g.moveTo(yx + d * 0.55, -44); g.lineTo(yx + d * 1.1, -17); g.stroke(); }
    g.strokeStyle = "#ffffff"; g.lineWidth = 1.3;
    g.beginPath(); g.moveTo(yx - 26, -23.5); g.quadraticCurveTo(yx, -19.5, yx + 26, -23.5); g.stroke();
    g.restore();
    // blouse
    g.beginPath();
    g.moveTo(yx - 9, -66); g.lineTo(yx + 9, -66);
    g.quadraticCurveTo(yx + 16, -64, yx + 16, -56);
    g.lineTo(yx + 15, -42); g.quadraticCurveTo(yx, -39, yx - 15, -42);
    g.lineTo(yx - 16, -56); g.quadraticCurveTo(yx - 16, -64, yx - 9, -66);
    g.closePath();
    shade(g, { x: yx, y: -54, rx: 16, ry: 13 }, WHITE, { ao: 0.3, rim: 0.2, sheen: 0.3, lineWidth: 1.2 });
    // sailor collar
    g.beginPath();
    g.moveTo(yx - 16, -60); g.quadraticCurveTo(yx - 12, -67, yx - 6, -66);
    g.lineTo(yx + p.yaw * 2, -52); g.lineTo(yx + 6, -66);
    g.quadraticCurveTo(yx + 12, -67, yx + 16, -60);
    g.lineTo(yx + 9, -57); g.lineTo(yx + p.yaw * 2, -47); g.lineTo(yx - 9, -57);
    g.closePath();
    shade(g, { x: yx, y: -58, rx: 16, ry: 8 }, NAVY, { ao: 0.2, rim: 0.1, sheen: 0.25, lineWidth: 1 });
    g.strokeStyle = "#ffffff"; g.lineWidth = 0.9;
    g.beginPath(); g.moveTo(yx - 13.5, -60.5); g.lineTo(yx - 8, -58); g.lineTo(yx + p.yaw * 2, -49.5); g.lineTo(yx + 8, -58); g.lineTo(yx + 13.5, -60.5); g.stroke();
    // ribbon
    const bx = yx + p.yaw * 2.5, by = -50;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(bx, by);
      g.bezierCurveTo(bx + s * 4, by - 6, bx + s * 10, by - 4, bx + s * 8, by + 1);
      g.bezierCurveTo(bx + s * 7, by + 3, bx + s * 3, by + 2, bx, by);
      g.closePath();
      shade(g, { x: bx + s * 5, y: by - 1, rx: 6, ry: 4 }, { light: "#ff9aa2", base: "#e8505b", dark: "#a8283a", line: "#7c1a2a" }, { ao: 0.2, rim: 0.1, sheen: 0.45, lineWidth: 0.9 });
      g.beginPath();
      g.moveTo(bx - s * 0.5, by + 1); g.lineTo(bx + s * 3.5, by + 9); g.lineTo(bx + s * 5.5, by + 7); g.lineTo(bx + s * 1.5, by + 0.5);
      g.closePath(); g.fillStyle = "#d63d4b"; g.fill(); g.strokeStyle = "#7c1a2a"; g.lineWidth = 0.8; g.stroke();
    }
    ellipsePath(g, bx, by, 2.4, 2.2); g.fillStyle = "#c2303f"; g.fill(); g.strokeStyle = "#7c1a2a"; g.lineWidth = 0.8; g.stroke();
  },
  frontHair(g, H, p) {
    // side locks framing the face
    for (const side of [-1, 1]) {
      const x0 = H.x + side * H.rx * 0.98 + p.yaw * 4;
      g.beginPath();
      g.moveTo(x0 - side * 6, H.y - H.ry * 0.5);
      g.bezierCurveTo(x0 + side * 4, H.y, x0 + side * 2, H.y + H.ry * 0.7, x0 - side * 1, H.y + H.ry * 1.12);
      g.quadraticCurveTo(x0 - side * 4, H.y + H.ry * 0.6, x0 - side * 9, H.y - H.ry * 0.1);
      g.closePath();
      shade(g, { x: x0, y: H.y + 8, rx: 8, ry: 24 }, QH, { ao: 0.25, rim: 0.2, sheen: 0.2, lineWidth: 1.2, line: QH.line });
    }
    bangsPath(g, H.x, H.y, H.rx, H.ry, [
      [-0.82, 0.05, 0.22, 0.1], [-0.5, -0.12, 0.26, 0.15], [-0.18, -0.02, 0.26, 0.2],
      [0.12, -0.16, 0.22, -0.1], [0.42, -0.04, 0.27, -0.15], [0.78, 0.02, 0.24, -0.1],
    ], p.yaw);
    shade(g, { x: H.x, y: H.y - H.ry * 0.55, rx: H.rx * 1.1, ry: H.ry * 0.75 }, QH, { ao: 0.2, rim: 0.15, sheen: 0.25, lineWidth: 1.3, line: QH.line });
    g.save(); g.clip(); strands(g, H.x, H.y - 4, H.rx, H.ry * 0.9, QH, 11, 10); g.restore();
  },
  accessory(g, H, p) {
    // little yellow bird perched on her head
    const x = H.x + H.rx * 0.45 + p.yaw * 6, y = H.y - H.ry * 1.12 + Math.max(0, -p.dy) * 0.08;
    const BIRD = { light: "#fff6c4", base: "#ffd54a", dark: "#e09a1c", line: "#a8650e" };
    g.save();
    g.translate(x, y);
    g.rotate(0.12 + (p.ear ? -0.2 : 0) + p.tail * 0.15);
    // tail
    g.beginPath(); g.moveTo(-7, 1); g.lineTo(-14, -3); g.lineTo(-12, 3); g.closePath();
    g.fillStyle = BIRD.dark; g.fill(); g.strokeStyle = BIRD.line; g.lineWidth = 0.9; g.stroke();
    eggPath(g, 0, 0, 9, 7.5, -0.1);
    shade(g, { x: 0, y: 0, rx: 9, ry: 7.5 }, BIRD, { ao: 0.25, rim: 0.2, sheen: 0.5, lineWidth: 1 });
    // wing
    g.beginPath(); g.ellipse(-2, 1.5, 4.5, 3, -0.4, 0, TAU);
    g.fillStyle = "#ffc62e"; g.fill(); g.strokeStyle = BIRD.line; g.lineWidth = 0.8; g.stroke();
    // beak + eye
    g.beginPath(); g.moveTo(8.4, -1.6); g.lineTo(12, -0.4); g.lineTo(8.4, 1); g.closePath();
    g.fillStyle = "#ff9a3c"; g.fill(); g.strokeStyle = "#b5561a"; g.lineWidth = 0.7; g.stroke();
    const shut = p.eyes === "happy" || p.eyes === "closed" || p.eyes === "blink";
    if (shut) { g.strokeStyle = "#2a1a0e"; g.lineWidth = 1; g.beginPath(); g.arc(4.6, -2, 1.4, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    else { g.fillStyle = "#2a1a0e"; g.beginPath(); g.arc(4.6, -2.2, 1.4, 0, TAU); g.fill(); g.fillStyle = "#fff"; g.beginPath(); g.arc(4.2, -2.7, 0.5, 0, TAU); g.fill(); }
    softSpot(g, 5, 1.5, 2, 1.3, "#ff8a8a", 0.6);
    g.restore();
    // hair tie on the ponytail
    const tx = H.x - p.yaw * 3 - H.rx * 0.95, ty = H.y - H.ry * 0.35;
    ellipsePath(g, tx, ty, 4.2, 4.2);
    shade(g, { x: tx, y: ty, rx: 4.2, ry: 4.2 }, { light: "#ff9aa2", base: "#e8505b", dark: "#a8283a", line: "#7c1a2a" }, { ao: 0.2, rim: 0.1, sheen: 0.5, lineWidth: 0.9 });
  },
};
qiqi.draw = humanDraw(qiqi);

// ---------- 棉棉 (ragdoll kitten) ----------

const CREAM = { light: "#fffdf8", base: "#f7efe4", dark: "#d8c4ad", line: "#a68b74" };
const SEAL = { light: "#b59682", base: "#8a6b58", dark: "#5c4535", line: "#45332a" };
const PAW = { light: "#ffffff", base: "#fbf8f3", dark: "#dcd2c6", line: "#a68b74" };

const mianmian = {
  id: "mianmian",
  displayName: "棉棉",
  description: "蓝眼睛的布偶猫，软乎乎一大团。",
  draw(g, p) {
    const yaw = p.yaw, pitch = p.pitch;
    const H = { x: yaw * 3, y: -94 + pitch * 2, rx: 41, ry: 34 };

    // tail
    g.save();
    g.translate(16 - yaw * 6, -18);
    g.rotate(-0.35 + p.tail * 0.9);
    fluffPath(g, 8, -24, 10, 26, 12, 3.2, 5);
    const tg = g.createLinearGradient(0, 0, 0, -50);
    tg.addColorStop(0, CREAM.dark); tg.addColorStop(0.35, SEAL.base); tg.addColorStop(1, SEAL.dark);
    g.fillStyle = tg; g.fill();
    g.strokeStyle = SEAL.line; g.lineWidth = 1.2; g.stroke();
    g.save(); g.clip(); furStrokes(g, { x: 8, y: -24, rx: 10, ry: 26 }, [rgba(SEAL.light, 0.6), rgba(SEAL.dark, 0.5)], 9, 50, 5, 0.6); g.restore();
    g.restore();

    // hind feet
    for (const side of [-1, 1]) {
      const f = side < 0 ? p.footL : p.footR;
      const x = side * 11 + f.dx + yaw * 2.5, y = -5 + f.dy;
      ellipsePath(g, x, y, 9, 5.6);
      shade(g, { x, y, rx: 9, ry: 5.6 }, PAW, { ao: 0.3, rim: 0.2, sheen: 0.4, lineWidth: 1.1 });
      g.strokeStyle = rgba(PAW.line, 0.6); g.lineWidth = 0.8;
      for (const t of [-3, 0, 3]) { g.beginPath(); g.moveTo(x + t, y - 3.5); g.lineTo(x + t, y - 1.4); g.stroke(); }
    }

    // body
    const B = { x: yaw * 2, y: -32, rx: 27, ry: 28 };
    fluffPath(g, B.x, B.y, B.rx, B.ry, 18, 2.4, 3);
    shade(g, B, CREAM, {
      ao: 0.4, rim: 0.25, sheen: 0.2, lineWidth: 1.3,
      texture: (g) => {
        softSpot(g, B.x + 18, B.y - 6, 14, 22, SEAL.base, 0.25);
        furStrokes(g, B, [rgba(CREAM.dark, 0.55), "rgba(255,255,255,0.7)"], 13, 110, 5, 0.6);
      },
    });
    // chest ruff
    fluffPath(g, B.x + yaw * 3, B.y - 13, 16, 12, 12, 3, 17);
    shade(g, { x: B.x, y: B.y - 13, rx: 16, ry: 12 }, PAW, { ao: 0.15, rim: 0.1, sheen: 0.3, line: rgba(CREAM.line, 0.6), lineWidth: 0.9 });

    const front = [];
    for (const side of [-1, 1]) {
      const a = side < 0 ? p.armL : p.armR;
      const draw = () => arm(g, side * 14 + yaw * 2, -46, a, side, 12, null, PAW, { w: 12.5, hand: 6.6, toes: true });
      if (a < -1.5 || a > 1.9) front.push(draw); else draw();
    }

    // head
    g.save();
    g.translate(0, -62); g.rotate(p.headTilt + yaw * 0.03); g.translate(0, 62);
    // ears
    for (const side of [-1, 1]) {
      const ex = H.x + side * 25 - yaw * 3, ey = H.y - 22;
      g.save();
      g.translate(ex, ey);
      g.rotate(side * 0.28 + (p.ear && side > 0 ? 0.25 : 0));
      g.beginPath();
      g.moveTo(-11, 6); g.quadraticCurveTo(-5, -14, 0, -19); g.quadraticCurveTo(5, -14, 11, 6);
      g.closePath();
      shade(g, { x: 0, y: -4, rx: 11, ry: 13 }, SEAL, { ao: 0.2, rim: 0.2, sheen: 0.2, lineWidth: 1.2 });
      g.beginPath(); g.moveTo(-6, 4); g.quadraticCurveTo(-3, -9, 0, -13); g.quadraticCurveTo(3, -9, 6, 4); g.closePath();
      const ig = g.createLinearGradient(0, -13, 0, 4); ig.addColorStop(0, "#d9a0a0"); ig.addColorStop(1, "#f2c9c4");
      g.fillStyle = ig; g.fill();
      g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 0.7;
      for (const t of [-3, 0, 3]) { g.beginPath(); g.moveTo(t, 4); g.quadraticCurveTo(t * 0.6, -2, t * 0.3, -6); g.stroke(); }
      g.restore();
    }
    // head fluff
    fluffPath(g, H.x, H.y, H.rx, H.ry, 22, 3.4, 11, Math.PI * 0.05, Math.PI * 0.95);
    shade(g, H, CREAM, {
      ao: 0.2, rim: 0.2, sheen: 0.15, lineWidth: 1.3, lightShift: yaw * 0.2,
      texture: (g) => {
        const fx = H.x + yaw * 11;
        // seal-point mask with the white inverted V of a bicolour ragdoll
        for (const side of [-1, 1]) softSpot(g, fx + side * 20, H.y - 8 + pitch * 4, 16, 16, "#9c7a63", 0.72);
        softSpot(g, fx, H.y - 28, 22, 9, "#9c7a63", 0.45);
        softSpot(g, fx, H.y + 10, 13, 24, "#ffffff", 1);
        softSpot(g, fx, H.y - 8, 5, 12, "#ffffff", 0.85);
        furStrokes(g, H, [rgba(CREAM.dark, 0.45), "rgba(255,255,255,0.65)"], 19, 120, 4.5, 0.55);
      },
    });
    const fx = H.x + yaw * 11, fy = H.y + pitch * 6;
    for (const side of [-1, 1]) {
      const ex = fx + side * 16 * (1 - 0.12 * Math.max(0, -side * yaw));
      eye(g, ex, fy - 3, 8.6, p, side, ["#d6f2ff", "#4a95e6", "#183e8c"]);
      brows(g, ex, fy - 16, 6, side, p.brow, SEAL.dark);
    }
    for (const side of [-1, 1]) blush(g, fx + side * 22, fy + 10, 6, p.blush);
    // nose
    g.beginPath();
    g.moveTo(fx + yaw * 2 - 3.2, fy + 7); g.lineTo(fx + yaw * 2 + 3.2, fy + 7); g.lineTo(fx + yaw * 2, fy + 10.2); g.closePath();
    g.fillStyle = "#f3a0a8"; g.fill(); g.strokeStyle = "#b8616c"; g.lineWidth = 0.8; g.stroke();
    drawMouth(g, fx + yaw * 2, fy + 11.5, 3.8, p.mouth === "smile" ? "cat" : p.mouth, "#6e4440");
    // whiskers
    g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 0.8; g.lineCap = "round";
    for (const side of [-1, 1]) for (const k of [-1, 0, 1]) {
      g.beginPath();
      g.moveTo(fx + side * 12, fy + 9 + k * 2);
      g.quadraticCurveTo(fx + side * 26, fy + 6 + k * 3.5, fx + side * 36, fy + 6 + k * 5);
      g.stroke();
    }
    g.restore();

    for (const f of front) f();
    drawFx(g, p.fx, { x: H.x, y: H.y });
  },
};

window.PRESETS = [mianmian, qiqi];
})();
