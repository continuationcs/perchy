// Perchy runner (PoC): state machine, physics, per-pixel click-through.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// Mirror info/warn/error to the native stdout.
for (const level of ["info", "warn", "error"]) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    invoke("log", { level, msg: args.map((a) => (a instanceof Error ? a.message : typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ") }).catch(() => {});
  };
}
window.addEventListener("error", (e) => console.error("uncaught:", e.message, `${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => console.error("unhandled:", String(e.reason)));

const stage = document.getElementById("stage");
const ctx = stage.getContext("2d");

// The pet is drawn into a small sprite buffer first; hit tests read alpha
// from this buffer, so only opaque pet pixels catch the mouse.
let renderer = window.builtinRenderer; // see cat.js / sprite.js
const buf = document.createElement("canvas");
const bctx = buf.getContext("2d", { willReadFrequently: true });

let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  stage.width = Math.round(W * dpr); stage.height = Math.round(H * dpr);
  sizeBuffer();
  pet.x = Math.min(Math.max(pet.x, 60), W - 60);
  if (pet.state !== "held") pet.y = Math.min(pet.y, H);
}

const GRAVITY = 2600;    // px/s²
const WALK_SPEED = 70;   // px/s
const SLEEP_AFTER = 45;  // s without interaction

const pet = {
  x: 300, y: -120, vx: 0, vy: 0,
  facing: 1, state: "air", stateT: 0, nextDecision: 2,
  blinkUntil: 0, nextBlink: 3, faceOverride: null, loved: 0,
  look: null, swing: 0, lastTouch: 0,
};

function sizeBuffer() {
  buf.width = Math.round(renderer.S * dpr); buf.height = Math.round(renderer.S * dpr);
}

function setState(s) { pet.state = s; pet.stateT = 0; }
function touch(t) { pet.lastTouch = t; }
function showFace(face, t, dur) { pet.faceOverride = { face, until: t + dur }; }

// ---------- particles (hearts, Zzz, !) ----------
const particles = [];
function emit(text, color, size, x, y, vx, vy, life) {
  particles.push({ text, color, size, x, y, vx, vy, life, age: 0 });
}
function hearts(n) {
  for (let i = 0; i < n; i++)
    emit("♥", "#ff6b8b", 16 + Math.random() * 8, pet.x + (Math.random() - 0.5) * 50,
      pet.y - renderer.height - 10, (Math.random() - 0.5) * 60, -60 - Math.random() * 50, 1.2);
}

// ---------- input: cursor polling + pointer events ----------
let cursor = null;      // latest cursor, CSS px relative to the window
let passthrough = true; // mirrors the native ignore-cursor-events flag
let drag = null;        // { offX, offY, samples: [[x, y, t]], start }

function bufferPoint(x, y) {
  const { S, FOOT } = renderer;
  return [x - (pet.x - S / 2), y - (pet.y - (S - FOOT))];
}
function hitTest(x, y) {
  const [bx, by] = bufferPoint(x, y);
  if (bx < 0 || by < 0 || bx >= renderer.S || by >= renderer.S) return false;
  const a = bctx.getImageData(Math.floor(bx * dpr), Math.floor(by * dpr), 1, 1).data[3];
  return a > 24;
}
function setPassthrough(on) {
  if (on === passthrough) return;
  passthrough = on;
  invoke("set_passthrough", { enabled: on });
  stage.style.cursor = on ? "default" : "grab";
}

stage.addEventListener("pointerdown", (e) => {
  if (!hitTest(e.clientX, e.clientY)) return;
  stage.setPointerCapture(e.pointerId);
  const now = performance.now() / 1000;
  drag = { offX: e.clientX - pet.x, offY: e.clientY - pet.y, samples: [[e.clientX, e.clientY, now]], start: now, moved: 0 };
  stage.style.cursor = "grabbing";
});
stage.addEventListener("pointermove", (e) => {
  cursor = [e.clientX, e.clientY];
  if (!drag) return;
  const now = performance.now() / 1000;
  const last = drag.samples[drag.samples.length - 1];
  drag.moved += Math.hypot(e.clientX - last[0], e.clientY - last[1]);
  drag.samples.push([e.clientX, e.clientY, now]);
  while (drag.samples.length > 2 && now - drag.samples[0][2] > 0.08) drag.samples.shift();
  if (drag.moved > 6 && pet.state !== "held") { pet.target = null; setState("held"); touch(clock); }
  if (pet.state === "held") {
    const nx = e.clientX - drag.offX;
    pet.swing += (nx - pet.x) * 0.02;
    pet.x = nx; pet.y = e.clientY - drag.offY;
  }
});
stage.addEventListener("pointerup", (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  stage.style.cursor = "grab";
  touch(clock);
  if (pet.state !== "held") { onClick(); return; }
  // Released outside this display's overlay → carry the pet to that display.
  if (e.clientX < 0 || e.clientX > W || e.clientY < 0 || e.clientY > H) {
    hopScreens().then((moved) => {
      if (!moved) { pet.x = Math.min(Math.max(pet.x, 60), W - 60); pet.vx = 0; pet.vy = 0; setState("air"); }
    });
    return;
  }
  // Throw with the velocity of the last ~80 ms of movement.
  const a = d.samples[0], b = d.samples[d.samples.length - 1];
  const dt = Math.max(0.016, b[2] - a[2]);
  const clamp = (v) => Math.max(-3000, Math.min(3000, v));
  pet.vx = clamp((b[0] - a[0]) / dt); pet.vy = clamp((b[1] - a[1]) / dt);
  setState("air");
});

function nextResize() {
  return new Promise((r) => window.addEventListener("resize", r, { once: true }));
}
async function hopScreens() {
  const resized = nextResize();
  if (!(await invoke("follow_cursor_monitor"))) return false;
  await Promise.race([resized, new Promise((r) => setTimeout(r, 600))]);
  const c = await invoke("cursor_local");
  if (c) { pet.x = c[0]; pet.y = Math.min(c[1], H); }
  pet.vx = 0; pet.vy = 0; setState("air");
  return true;
}

// ---------- power: hidden while a fullscreen app runs, 30 fps on battery ----------
let power = { paused: false, battery: false };
let loopRunning = true;
function applyPower(next) {
  power = next;
  console.info("[perchy] power:", JSON.stringify(next));
  if (!power.paused && !loopRunning) {
    loopRunning = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }
}
listen("power", ({ payload }) => applyPower(payload));
invoke("power_state").then(applyPower).catch(() => {});

function onClick() {
  if (pet.state === "sleep") {
    showFace("shock", clock, 0.8);
    emit("!", "#ff9f1c", 28, pet.x + 20, pet.y - renderer.height - 20, 0, -40, 0.8);
  } else {
    showFace("happy", clock, 1.2);
    hearts(3);
  }
  pet.vy = -620; pet.vx = 0;
  setState("air");
}

listen("tray", ({ payload }) => {
  touch(clock);
  if (payload === "reset") {
    pet.x = nearestHome(W); pet.y = -100; pet.vx = 0; pet.vy = 0; setState("air");
  } else if (payload === "sleep") {
    pet.vx = 0; setState("sleep");
  } else if (payload.startsWith("pet:")) {
    usePet(payload.slice(4));
  } else if (payload === "export") {
    if (petKey === "builtin") { say("内置的团子猫不能导出，换一只宠物再试", 3); return; }
    invoke("export_pet", { key: petKey })
      .then((name) => say(`已导出到「下载」：${name}`, 4))
      .catch((e) => say("导出失败：" + e, 5));
  } else if (payload.startsWith("zone:")) {
    setZone(payload.slice(5));
  } else if (payload.startsWith("size:")) {
    setSize(Number(payload.slice(5)));
  }
});

// ---------- size (tray 「大小」, remembered per pet) ----------
let baseRenderer = renderer, petKey = "builtin", sizeMul = 1;
const sizeKey = (key) => `perchy.size.${key}`;
function scaled(r, mul) {
  if (mul === 1) return r;
  return {
    ...r,
    S: Math.ceil(r.S * mul), FOOT: r.FOOT * mul, width: r.width * mul, height: r.height * mul,
    draw: (g, p, t) => { g.save(); g.scale(mul, mul); r.draw(g, p, t); g.restore(); },
  };
}
function applySize() {
  renderer = scaled(baseRenderer, sizeMul);
  sizeBuffer();
}
function setSize(mul) {
  if (!(mul > 0)) return;
  sizeMul = mul;
  try { localStorage.setItem(sizeKey(petKey), String(mul)); } catch {}
  applySize();
  pet.y = Math.min(pet.y, H);
  if (pet.state !== "held") { pet.vy = -200; setState("air"); }
}

// ---------- installing pets (drop a .pet onto the pet / double-click) ----------
let dropHover = false;
listen("drop-hover", ({ payload }) => {
  dropHover = payload;
  if (payload) { touch(clock); if (pet.state === "walk" || pet.state === "sleep") setState("idle"); }
});
listen("pet-installed", async ({ payload }) => {
  invoke("take_pending_pet"); // handled here; don't re-apply at next start
  touch(clock);
  if (await usePet(payload.key)) {
    hearts(5);
    say(`${payload.replaced ? "更新" : "安装"}好了：${payload.displayName}`, 3);
  }
});
listen("pet-install-failed", ({ payload }) => {
  showFace("shock", clock, 1.5);
  say(`装不上${payload.file ? " " + payload.file : ""}：${payload.error}`, 5);
});

// ---------- speech bubble ----------
// Messages queue up so several results (e.g. a multi-file drop) all get read.
let bubble = null;
const bubbleQueue = [];
function say(text, seconds) { bubbleQueue.push({ text, seconds }); }
function drawBubble() {
  if (bubble && bubble.until < clock) bubble = null;
  if (!bubble && bubbleQueue.length) {
    const next = bubbleQueue.shift();
    bubble = { text: next.text, until: clock + next.seconds };
  }
  if (!bubble) return;
  const maxW = 240, pad = 9, lineH = 18;
  ctx.font = `13px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  const lines = [];
  let line = "";
  for (const ch of bubble.text) {
    if (ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; } else line += ch;
  }
  lines.push(line);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * lineH + pad * 2 - 4;
  const x = Math.min(Math.max(pet.x - w / 2, 6), W - w - 6);
  const y = Math.max(6, pet.y - renderer.height - h - 18);
  ctx.globalAlpha = Math.min(1, (bubble.until - clock) * 3);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#333";
  lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + 10 + i * lineH));
  ctx.globalAlpha = 1;
}

// ---------- pet switching ----------
const PET_PREF = "perchy.pet";
async function usePet(key) {
  let next = window.builtinRenderer;
  if (key !== "builtin") {
    try {
      const entry = (await invoke("list_pets")).find((p) => p.key === key);
      if (!entry) throw new Error(`pet ${key} not found`);
      next = await window.loadSpritePet(entry);
    } catch (e) {
      console.error("[perchy] failed to load pet", key, e);
      emit("?", "#ff6b6b", 28, pet.x, pet.y - renderer.height - 20, 0, -40, 1.2);
      return false;
    }
  }
  baseRenderer = next;
  petKey = key;
  sizeMul = 1;
  try { sizeMul = Number(localStorage.getItem(sizeKey(key))) || 1; } catch {}
  applySize();
  try { localStorage.setItem(PET_PREF, key); } catch {}
  console.info("[perchy] pet:", key, renderer.name, `S=${renderer.S} h=${Math.round(renderer.height)}`);
  // Drop the new pet in from above.
  pet.y = -40; pet.vx = 0; pet.vy = 0; setState("air");
  return true;
}

// ---------- activity zone (tray 「活动范围」) ----------
// Keep the pet out of the middle of the screen, where input boxes and
// content usually are. Outside its zone (after being dropped or thrown
// there) it walks back to the nearest one.
const ZONE_PREF = "perchy.zone";
let zoneMode = "corners";
try { zoneMode = localStorage.getItem(ZONE_PREF) || "corners"; } catch {}
function zones() {
  const m = 50;                                         // keep off the very edge
  const cw = Math.min(Math.max(W * 0.16, 180), 360);   // corner zone width
  switch (zoneMode) {
    case "full": return [[m, W - m]];
    case "left": return [[m, m + cw]];
    case "right": return [[W - m - cw, W - m]];
    default: return [[m, m + cw], [W - m - cw, W - m]];
  }
}
function zoneOf(x) { return zones().find(([a, b]) => x >= a && x <= b) || null; }
function nearestHome(x) {
  let best = x, bestD = Infinity;
  for (const [a, b] of zones()) {
    const tx = Math.min(Math.max(x, a + 30), b - 30);
    if (Math.abs(tx - x) < bestD) { bestD = Math.abs(tx - x); best = tx; }
  }
  return best;
}
function setZone(mode) {
  zoneMode = mode;
  try { localStorage.setItem(ZONE_PREF, mode); } catch {}
  touch(clock);
  if (!zoneOf(pet.x) && (pet.state === "idle" || pet.state === "walk" || pet.state === "sleep")) {
    pet.target = nearestHome(pet.x); setState("walk");
  }
}

// ---------- behaviour ----------
function think(t, dt) {
  pet.stateT += dt;

  if (t > pet.nextBlink) { pet.blinkUntil = t + 0.14; pet.nextBlink = t + 2 + Math.random() * 4; }

  // Eyes follow the cursor when it's close.
  if (cursor) {
    const dx = cursor[0] - pet.x, dy = cursor[1] - (pet.y - 60);
    const dist = Math.hypot(dx, dy);
    pet.look = dist < 400 ? [dx / Math.max(dist, 1), dy / Math.max(dist, 1)] : null;
    // Sprite pets with look rows turn toward a recently moved, nearby cursor.
    // 0° = up, clockwise; a deadzone around the head falls back to idle.
    const hy = pet.y - renderer.height * 0.6;
    const ldx = cursor[0] - pet.x, ldy = cursor[1] - hy, ld = Math.hypot(ldx, ldy);
    const recent = t - lastCursorMove < 2.5;
    pet.lookAngle = recent && ld > renderer.width * 0.6 && ld < 500
      ? (Math.atan2(ldx, -ldy) * 180 / Math.PI + 360) % 360 : null;
  }

  switch (pet.state) {
    case "idle":
      if (!zoneOf(pet.x)) { pet.target = nearestHome(pet.x); setState("walk"); break; }
      if (t - pet.lastTouch > SLEEP_AFTER && Math.random() < dt * 0.2) { setState("sleep"); break; }
      if (pet.stateT > pet.nextDecision) {
        pet.nextDecision = 2 + Math.random() * 4;
        if (Math.random() < 0.6) {
          pet.facing = Math.random() < 0.5 ? -1 : 1;
          setState("walk");
        } else setState("idle");
      }
      break;
    case "walk": {
      if (pet.target != null) { // heading back to its zone
        const dx = pet.target - pet.x, step = WALK_SPEED * 1.6 * dt;
        if (dx) pet.facing = Math.sign(dx);
        if (Math.abs(dx) <= step) { pet.x = pet.target; pet.target = null; pet.nextDecision = 1 + Math.random() * 2; setState("idle"); }
        else pet.x += Math.sign(dx) * step;
        break;
      }
      const [a, b] = zoneOf(pet.x) || [50, W - 50];
      pet.x += pet.facing * WALK_SPEED * dt;
      if (pet.x < a || pet.x > b) { pet.facing *= -1; pet.x = Math.min(Math.max(pet.x, a), b); }
      if (pet.stateT > pet.nextDecision) { pet.nextDecision = 2 + Math.random() * 4; setState("idle"); }
      break;
    }
    case "sleep":
      if (Math.random() < dt * 0.8) emit("z", "#7f8fa6", 14 + Math.random() * 8, pet.x + renderer.width * 0.4, pet.y - renderer.height * 0.8, 15, -30, 2);
      break;
    case "held":
      pet.swing *= Math.pow(0.02, dt);
      break;
    case "air":
      pet.vy += GRAVITY * dt;
      pet.x += pet.vx * dt; pet.y += pet.vy * dt;
      pet.swing = Math.max(-0.4, Math.min(0.4, pet.vx / 3000));
      if (Math.abs(pet.vx) > 30) pet.facing = Math.sign(pet.vx);
      if (pet.x < 50) { pet.x = 50; pet.vx = -pet.vx * 0.5; }
      if (pet.x > W - 50) { pet.x = W - 50; pet.vx = -pet.vx * 0.5; }
      if (pet.y < renderer.height + 10) { pet.y = renderer.height + 10; pet.vy = Math.abs(pet.vy) * 0.3; }
      if (pet.y >= H) {
        pet.y = H;
        if (pet.vy > 500) { pet.vy = -pet.vy * 0.35; pet.vx *= 0.7; }
        else { pet.vx = 0; pet.vy = 0; pet.swing = 0; setState("land"); }
      }
      break;
    case "land":
      if (pet.stateT > 0.35) { pet.nextDecision = 1 + Math.random() * 2; setState("idle"); }
      break;
  }
}

// Rubbing: moving the cursor back and forth over the pet makes it happy.
let rub = 0, lastRubPos = null;
function petting(t, dt, hovering) {
  rub = Math.max(0, rub - 250 * dt);
  if (hovering && !drag && cursor && lastRubPos && pet.state !== "air") {
    rub += Math.hypot(cursor[0] - lastRubPos[0], cursor[1] - lastRubPos[1]);
    if (rub > 700) {
      rub = 0; touch(t);
      if (pet.state === "sleep" || pet.state === "walk") setState("idle");
      pet.loved = t + 2.5; showFace("happy", t, 2.5); hearts(4);
    }
  }
  lastRubPos = cursor ? [...cursor] : null;
}

// ---------- render loop ----------
let clock = 0, lastCursorMove = -10, lastFrame = performance.now();
function frame(now) {
  if (power.paused) { loopRunning = false; return; } // resumed by applyPower
  if (power.battery && now - lastFrame < 1000 / 30 - 2) { requestAnimationFrame(frame); return; }
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now; clock += dt;

  // While click-through is on the webview gets no mouse events, so ask the
  // native side where the cursor is.
  if (!drag) invoke("cursor_local").then((c) => {
    if (!c) return;
    if (!cursor || Math.hypot(c[0] - cursor[0], c[1] - cursor[1]) > 2) lastCursorMove = clock;
    cursor = c;
  });

  think(clock, dt);

  // Draw the pet into the sprite buffer (also the hit-test mask).
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { S, FOOT } = renderer;
  bctx.clearRect(0, 0, S, S);
  bctx.save(); bctx.translate(S / 2, S - FOOT); renderer.draw(bctx, pet, clock); bctx.restore();

  const hovering = cursor ? hitTest(cursor[0], cursor[1]) : false;
  pet.dropHover = dropHover;
  setPassthrough(!(hovering || drag || dropHover));
  petting(clock, dt, hovering);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  // Soft shadow on the "floor".
  if (pet.state !== "held") {
    const lift = Math.max(0, H - pet.y);
    ctx.fillStyle = `rgba(0,0,0,${0.18 * Math.max(0.2, 1 - lift / 400)})`;
    ctx.beginPath(); ctx.ellipse(pet.x, H - 3, renderer.width * 0.45 * Math.max(0.4, 1 - lift / 600), 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.drawImage(buf, pet.x - S / 2, pet.y - (S - FOOT), S, S);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.age > p.life) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - p.age / p.life;
    ctx.fillStyle = p.color;
    ctx.font = `bold ${p.size}px -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
  drawBubble();

  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resize();
pet.x = nearestHome(W);
requestAnimationFrame(frame);

// Restore the last pet; on first run prefer a pet found on disk (e.g. Codex).
(async () => {
  let saved = null;
  try { saved = localStorage.getItem(PET_PREF); } catch {}
  const pets = await invoke("list_pets").catch(() => []);
  console.info("[perchy] pets found:", pets.map((p) => p.key).join(", ") || "(none)");
  // A pet just installed by double-clicking a .pet wins.
  const pending = await invoke("take_pending_pet").catch(() => null);
  const first = pending ?? saved ?? (pets[0] ? pets[0].key : "builtin");
  if (first !== "builtin" && !(await usePet(first))) usePet("builtin");
})();
