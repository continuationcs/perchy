// Procedural placeholder pet ("团子猫"). Draws into a small sprite buffer with
// its feet at the origin. Later this is replaced by sprite sheets loaded from
// a .pet package; the runner only needs drawPet(g, pet, t) to fill the buffer.

const CAT = {
  fur: "#ffd7a3",
  furDark: "#f2b06b",
  line: "#5a3a22",
  blush: "rgba(255,120,140,0.55)",
  eye: "#2b1d14",
};

function ellipse(g, x, y, rx, ry, fill, stroke) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2.5; g.stroke(); }
}

// face: "open" | "blink" | "happy" | "sleep" | "shock"
function drawEyes(g, face, hx, hy, look) {
  g.strokeStyle = CAT.eye;
  g.fillStyle = CAT.eye;
  g.lineWidth = 2.5;
  g.lineCap = "round";
  const eyes = [hx - 9, hx + 9];
  for (const ex of eyes) {
    const ey = hy - 2;
    g.beginPath();
    switch (face) {
      case "blink":
        g.moveTo(ex - 4, ey); g.lineTo(ex + 4, ey); g.stroke();
        break;
      case "happy": // ^ ^
        g.moveTo(ex - 5, ey + 2); g.lineTo(ex, ey - 3); g.lineTo(ex + 5, ey + 2); g.stroke();
        break;
      case "sleep": // ‿ ‿
        g.arc(ex, ey - 1, 4.5, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
        break;
      case "shock":
        ellipse(g, ex, ey, 4.5, 5.5, "#fff", CAT.eye);
        ellipse(g, ex, ey, 1.6, 1.8, CAT.eye);
        break;
      default: {
        const lx = look ? look[0] * 1.8 : 0;
        const ly = look ? look[1] * 1.5 : 0;
        ellipse(g, ex + lx, ey + ly, 3.6, 4.6, CAT.eye);
        ellipse(g, ex + lx + 1.2, ey + ly - 1.8, 1.2, 1.2, "#fff");
      }
    }
  }
}

function drawPet(g, p, t) {
  const walking = p.state === "walk";
  const held = p.state === "held" || p.state === "air";
  const sleeping = p.state === "sleep";

  // Squash & stretch
  let sx = 1, sy = 1, lift = 0;
  if (p.state === "idle") { sy = 1 + 0.025 * Math.sin(t * 2.2); sx = 2 - sy; }
  if (sleeping) { sy = 0.86 + 0.02 * Math.sin(t * 1.3); sx = 1.12; }
  if (walking) { lift = Math.abs(Math.sin(t * 9)) * 3; }
  if (held) { sy = 1.08; sx = 0.94; }
  if (p.state === "land") { const k = Math.max(0, 1 - p.stateT / 0.28); sy = 1 - 0.22 * k; sx = 1 + 0.18 * k; }

  g.save();
  g.translate(0, -lift);
  if (held) g.rotate(Math.max(-0.5, Math.min(0.5, p.swing || 0)));
  g.scale(p.facing * sx, sy);

  // Tail
  const tailWag = Math.sin(t * (sleeping ? 1 : 3)) * (sleeping ? 0.1 : 0.35);
  g.save();
  g.translate(-26, -22);
  g.rotate(-0.9 + tailWag);
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(-6, -22, 6, -34);
  g.lineWidth = 9; g.lineCap = "round"; g.strokeStyle = CAT.line; g.stroke();
  g.lineWidth = 5; g.strokeStyle = CAT.furDark; g.stroke();
  g.restore();

  // Feet
  const step = walking ? Math.sin(t * 9) * 5 : 0;
  const dangle = held ? 6 : 0;
  for (const [fx, ph] of [[-18, 1], [-6, -1], [10, -1], [22, 1]]) {
    ellipse(g, fx + step * ph * 0.6, -4 + dangle * (ph > 0 ? 1 : 0.7), 6, 5, CAT.fur, CAT.line);
  }

  // Body
  ellipse(g, 0, -24, 32, 22, CAT.fur, CAT.line);
  ellipse(g, 4, -18, 16, 10, "#fff4e3");

  // Head
  const hx = 10, hy = 54;
  g.save();
  g.translate(0, -hy);
  // Ears
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(hx + 25 * d, -8);
    g.lineTo(hx + 19 * d, -34);
    g.lineTo(hx + 4 * d, -21);
    g.closePath();
    g.fillStyle = CAT.fur; g.fill();
    g.strokeStyle = CAT.line; g.lineWidth = 2.5; g.stroke();
  }
  ellipse(g, hx, 0, 28, 24, CAT.fur, CAT.line);
  // Forehead stripes
  g.strokeStyle = CAT.furDark; g.lineWidth = 3; g.lineCap = "round";
  for (const dx of [-5, 0, 5]) { g.beginPath(); g.moveTo(hx + dx, -22); g.lineTo(hx + dx, -15); g.stroke(); }

  // Face
  let face = "open";
  if (p.dropHover) face = "shock";
  else if (sleeping) face = "sleep";
  else if (p.faceOverride && p.faceOverride.until > t) face = p.faceOverride.face;
  else if (held) face = "shock";
  else if (p.blinkUntil > t) face = "blink";
  const look = p.look ? [p.look[0] * p.facing, p.look[1]] : null;
  drawEyes(g, face, hx, 2, look);

  // Blush
  const blush = face === "happy" || p.loved > t;
  ellipse(g, hx - 17, 8, 5, 3, blush ? CAT.blush : "rgba(255,150,150,0.25)");
  ellipse(g, hx + 17, 8, 5, 3, blush ? CAT.blush : "rgba(255,150,150,0.25)");

  // Mouth (ω)
  g.strokeStyle = CAT.line; g.lineWidth = 2;
  g.beginPath();
  if (face === "shock") { ellipse(g, hx, 11, 3, 3.5, CAT.line); }
  else {
    g.arc(hx - 3, 8, 3, 0, Math.PI); g.moveTo(hx + 6, 8); g.arc(hx + 3, 8, 3, 0, Math.PI); g.stroke();
  }
  g.restore();

  g.restore();
}

// Renderer interface shared with sprite pets (see sprite.js):
//   S      sprite buffer size (CSS px); FOOT feet offset from buffer bottom
//   width / height  visual size, used for particles, shadow and ceiling
//   draw(g, pet, t) draws with the feet at the origin
window.builtinRenderer = {
  name: "团子猫",
  S: 180, FOOT: 24, width: 70, height: 110,
  draw: drawPet,
};
