// Sprite-pet renderer: plays Codex v1/v2 atlases and the optional coquou.json
// extension. Spec: docs/pet-format.md.

const CODEX_CELL = [192, 208];
const CODEX_COLS = 8;

// Codex standard rows: [row, frame durations in ms]
const tail = (n, each, last) => [...Array(n - 1).fill(each), last];
const CODEX_ROWS = {
  "idle": [0, [280, 110, 110, 140, 140, 320]],
  "running-right": [1, tail(8, 120, 220)],
  "running-left": [2, tail(8, 120, 220)],
  "waving": [3, tail(4, 140, 280)],
  "jumping": [4, tail(5, 140, 280)],
  "failed": [5, tail(8, 140, 240)],
  "waiting": [6, tail(6, 150, 260)],
  "running": [7, tail(6, 120, 220)],
  "review": [8, tail(6, 150, 280)],
};
const LOOK_ROWS = [9, 10]; // v2 only: 16 clockwise directions, 0° = up

async function petBytes(key, path) {
  return window.__TAURI__.core.invoke("read_pet_file", { key, path });
}
async function petImage(key, path) {
  return createImageBitmap(new Blob([await petBytes(key, path)]));
}
async function petJson(key, path, optional) {
  try {
    return JSON.parse(new TextDecoder().decode(await petBytes(key, path)));
  } catch (e) {
    if (optional && /No such file|not found|os error 2/i.test(String(e))) return null;
    throw new Error(`${path}: ${e}`);
  }
}

// Feet anchor = horizontal centre and lowest opaque row of idle frame 0.
function autoAnchor(img, cw, ch) {
  const c = new OffscreenCanvas(cw, ch);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, cw, ch, 0, 0, cw, ch);
  const { data } = g.getImageData(0, 0, cw, ch);
  let minX = cw, maxX = -1, maxY = -1, minY = ch;
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++)
      if (data[(y * cw + x) * 4 + 3] > 16) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y > maxY) maxY = y; if (y < minY) minY = y;
      }
  if (maxX < 0) return { x: cw / 2, y: ch - 4, top: 0, w: cw };
  return { x: (minX + maxX) / 2, y: maxY + 1, top: minY, w: maxX - minX + 1 };
}

function makeAnim(img, cw, ch, row, durs, loop, col0 = 0) {
  const total = durs.reduce((a, b) => a + b, 0);
  return { img, cw, ch, row, col0, durs, total, loop };
}

async function loadSpritePet(entry) {
  const key = entry.key;
  const manifest = await petJson(key, "pet.json");
  const version = manifest.spriteVersionNumber ?? 1;
  const atlas = await petImage(key, manifest.spritesheetPath || "spritesheet.webp");
  const [cw, ch] = CODEX_CELL;
  const rows = version >= 2 ? 11 : 9;
  if (atlas.width !== cw * CODEX_COLS || atlas.height !== ch * rows)
    throw new Error(`spritesheet is ${atlas.width}×${atlas.height}, Codex v${version} needs ${cw * CODEX_COLS}×${ch * rows}`);

  const anims = {};
  for (const [name, [row, durs]] of Object.entries(CODEX_ROWS))
    anims[name] = makeAnim(atlas, cw, ch, row, durs, true);

  // coquou.json: extra states (own sheets or rows of the main atlas) + metadata.
  // perchy.json: the same file from before the app was renamed.
  const ext = (await petJson(key, "coquou.json", true)) ?? (await petJson(key, "perchy.json", true));
  if (ext?.states) {
    for (const [name, s] of Object.entries(ext.states)) {
      const img = s.sheet ? await petImage(key, s.sheet) : atlas;
      const [scw, sch] = s.cell || [cw, ch];
      const frames = s.frames ?? Math.floor(img.width / scw);
      const durs = s.durations || Array(frames).fill(1000 / (s.fps || 8));
      if (durs.length !== frames) throw new Error(`coquou.json state "${name}": durations has ${durs.length} entries, frames is ${frames}`);
      anims[name] = makeAnim(img, scw, sch, s.row || 0, durs, s.loop !== false, s.column || 0);
    }
  }

  // Optional HD copy of the main atlas (same layout, 2–4× the pixels) for
  // HiDPI screens; Codex ignores it and keeps using the 1× atlas.
  let hd = null, hk = 1;
  if (ext?.hd) {
    try {
      const img = await petImage(key, ext.hd);
      const k = img.width / atlas.width;
      if (Number.isInteger(k) && k >= 2 && k <= 4 && img.height === atlas.height * k) { hd = img; hk = k; }
      else console.warn(`[coquou] ${ext.hd} is ${img.width}×${img.height}, not 2–4× the atlas; ignored`);
    } catch (e) { console.warn("[coquou] hd atlas:", e); }
  }

  const box = autoAnchor(atlas, cw, ch);
  const anchor = ext?.anchor ? { x: ext.anchor[0], y: ext.anchor[1] } : box;
  // Default: scale so the visible body is ~120 px tall on screen.
  const scale = ext?.scale ?? Math.min(1, 120 / Math.max(40, anchor.y - box.top));
  const S = Math.ceil(Math.max(cw, ch) * scale * 1.15) + 16;

  const has = (n) => !!anims[n];
  let current = null, startedAt = 0;

  // Map the runner's behaviour state to an animation (+ optional frame lock).
  function choose(p, t) {
    // A file is being dragged over the pet: open wide.
    if (p.dropHover && (p.state === "idle" || p.state === "walk" || p.state === "sleep"))
      return { name: has("eat") ? "eat" : "waiting" };
    switch (p.state) {
      case "walk": return { name: p.facing > 0 ? "running-right" : "running-left" };
      case "held": return { name: has("held") ? "held" : "waiting" };
      case "air":
        if (has("fall")) return { name: p.vy < 0 && has("rise") ? "rise" : "fall" };
        return { name: "jumping", frame: p.vy < 0 ? 2 : 3 };
      case "land": return has("land") ? { name: "land" } : { name: "jumping", frame: 4 };
      case "sleep": return has("sleep") ? { name: "sleep" } : { name: "idle", frame: 0 };
    }
    if (p.loved > t) return { name: has("loved") ? "loved" : "waving" };
    if (p.faceOverride && p.faceOverride.until > t && p.faceOverride.face === "happy")
      return { name: has("happy") ? "happy" : "waving" };
    if (version >= 2 && p.lookAngle != null) return { look: p.lookAngle };
    return { name: "idle" };
  }

  function frameOf(anim, elapsedMs) {
    let ms = anim.loop ? elapsedMs % anim.total : Math.min(elapsedMs, anim.total - 1);
    for (let i = 0; i < anim.durs.length; i++) {
      if (ms < anim.durs[i]) return i;
      ms -= anim.durs[i];
    }
    return anim.durs.length - 1;
  }

  function draw(g, p, t) {
    const pick = choose(p, t);
    let img, sx, sy, scw, sch;
    if (pick.look != null) {
      const idx = Math.round(pick.look / 22.5) % 16;
      img = atlas; scw = cw; sch = ch;
      sx = (idx % 8) * cw; sy = LOOK_ROWS[idx >> 3] * ch;
      current = null;
    } else {
      const anim = anims[pick.name];
      if (current !== pick.name) { current = pick.name; startedAt = t; }
      const f = pick.frame ?? frameOf(anim, (t - startedAt) * 1000);
      img = anim.img; scw = anim.cw; sch = anim.ch;
      sx = (anim.col0 + f) * scw; sy = anim.row * sch;
    }
    // Cells of a different size keep the same relative anchor.
    const ax = anchor.x * (scw / cw), ay = anchor.y * (sch / ch);
    let sqx = 1, sqy = 1;
    if (p.state === "land" && !has("land")) { const k = Math.max(0, 1 - p.stateT / 0.28); sqy = 1 - 0.15 * k; sqx = 1 + 0.12 * k; }
    g.save();
    g.scale(sqx, sqy);
    g.imageSmoothingQuality = "high";
    if (img === atlas && hd) g.drawImage(hd, sx * hk, sy * hk, scw * hk, sch * hk, -ax * scale, -ay * scale, scw * scale, sch * scale);
    else g.drawImage(img, sx, sy, scw, sch, -ax * scale, -ay * scale, scw * scale, sch * scale);
    g.restore();
  }

  return {
    name: manifest.displayName || manifest.id,
    S, FOOT: Math.ceil((ch - anchor.y) * scale) + 8,
    width: box.w * scale,
    height: (anchor.y - box.top) * scale,
    lines: ext?.lines || null,
    draw,
  };
}

window.loadSpritePet = loadSpritePet;
