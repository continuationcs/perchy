// AI hatch pipeline: prompts, background removal, frame extraction and
// Codex v2 atlas assembly. Pure image work — no network (see ai.rs).
//
// Flow: base character image → one grid sheet per animation (generated with
// the base as reference, on a flat chroma-key background) → matte → split the
// grid into frames → normalise scale / ground line → 8×11 atlas of 192×208.

const HATCH = (() => {
  const CELL_W = 192, CELL_H = 208, COLS = 8, ROWS = 11;
  const TARGET_H = 150;   // standing body height inside a 208 px cell (room for raised arms)
  const FOOT_PAD = 10;    // ground line distance from the cell bottom

  const KEY_RGB = { green: [0, 255, 0], magenta: [255, 0, 255] };
  const KEY_WORDS = {
    green: "pure chroma-key green (#00FF00)",
    magenta: "pure chroma-key magenta (#FF00FF)",
  };

  const LOOK_A = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5];
  const LOOK_B = [180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5];
  const DIR = {
    0: "straight up", 22.5: "up and slightly to the right", 45: "diagonally up-right",
    67.5: "to the right and slightly up", 90: "to the right", 112.5: "to the right and slightly down",
    135: "diagonally down-right", 157.5: "down and slightly to the right", 180: "straight down",
    202.5: "down and slightly to the left", 225: "diagonally down-left", 247.5: "to the left and slightly down",
    270: "to the left", 292.5: "to the left and slightly up", 315: "diagonally up-left", 337.5: "up and slightly to the left",
  };

  // Codex v2 rows. `mirrorOf` rows are derived, not generated.
  const STATES = [
    { id: "idle", label: "待机", row: 0, frames: 6, action: "a calm idle loop: gentle breathing and one blink, standing still, facing the viewer" },
    { id: "running-right", label: "向右走", row: 1, frames: 8, action: "walking to the RIGHT side of the picture (viewer's right), side or three-quarter view facing right, a clear alternating step cycle" },
    { id: "running-left", label: "向左走", row: 2, frames: 8, mirrorOf: "running-right" },
    { id: "waving", label: "挥手", row: 3, frames: 4, action: "a friendly greeting wave with one hand or paw: start, raise, wave, lower" },
    { id: "jumping", label: "跳", row: 4, frames: 5, action: "a happy jump: crouch, take off, peak high in the air, come down, land and settle. Keep the same ground line; at the peak the feet are clearly above it" },
    { id: "failed", label: "失败", row: 5, frames: 8, action: "a sad, deflated reaction to an error: droops and slumps, small sigh, then recovers a little. No tears or effects flying off the body" },
    { id: "waiting", label: "等待", row: 6, frames: 6, action: "expectantly waiting, looking up at the viewer as if asking for attention, slight sway" },
    { id: "running", label: "干活中", row: 7, frames: 6, action: "busy working on a task (not literal running): typing, tinkering or thinking hard, an energetic loop" },
    { id: "review", label: "检查中", row: 8, frames: 6, action: "focused inspection: looking closely at something, e.g. with a magnifying glass or reading a page, small nods" },
    // Not in the atlas: four exaggerated cardinal gazes that ground the 16 directions.
    { id: "look-cardinals", label: "看向锚点（上右下左）", row: null, frames: 4, cardinal: true },
    { id: "look-a", label: "看向 0°–157.5°", row: 9, frames: 8, look: LOOK_A },
    { id: "look-b", label: "看向 180°–337.5°", row: 10, frames: 8, look: LOOK_B },
  ];

  const STYLES = {
    auto: "match the style of the reference / description",
    pixel: "clean pixel art with crisp edges and a limited palette",
    chibi: "cute chibi anime style, big head, soft cel shading, clean outlines",
    plush: "soft plush toy look",
    clay: "claymation look",
    toy3d: "glossy 3D vinyl toy render",
    flat: "flat vector illustration with bold shapes",
  };

  function layoutFor(n) {
    if (n === 4) return { cols: 2, rows: 2, size: "1024x1024" };
    if (n <= 6) return { cols: 3, rows: 2, size: "1536x1024" };
    return { cols: 4, rows: 2, size: "1536x1024" };
  }

  // ---------- prompts ----------
  function basePrompt({ description, style, key, hasReference }) {
    return [
      hasReference
        ? "Turn the character in the reference image into a single desktop-pet character sprite. Keep its identity: face, colours, markings, outfit and props."
        : `Design a single cute desktop-pet character: ${description || "a friendly little mascot"}.`,
      hasReference && description ? `Notes: ${description}.` : "",
      `Style: ${STYLES[style] || STYLES.auto}.`,
      "Full body, standing, facing the viewer, friendly neutral expression, the whole body including feet visible, centred, about 65% of the image height.",
      `Background: flat ${KEY_WORDS[key]} everywhere. Do not use that colour anywhere on the character.`,
      "No ground shadow, no text, no border, no other objects.",
    ].filter(Boolean).join(" ");
  }

  function sheetPrompt(state, key, style) {
    const { cols, rows } = layoutFor(state.frames);
    const cells = cols * rows;
    const empty = cells > state.frames ? ` Leave the last ${cells - state.frames} cell(s) completely empty (background only).` : "";
    let motion;
    const exaggerate = "Exaggerate the gaze so the direction is obvious even when the sprite is tiny: turn the whole head and upper body, tilt the head back to look up, tuck the chin to look down, and point the eyes clearly.";
    if (state.cardinal) {
      motion = `Animation "look-cardinals" with 4 frames, a gaze anchor sheet: 1) looking straight UP; 2) looking to the RIGHT side of the picture (viewer's right), head and body turned right; 3) looking straight DOWN; 4) looking to the LEFT side of the picture (viewer's left), head and body turned left. ${exaggerate} The feet stay planted at the same spot and scale.`;
    } else if (state.look) {
      motion = "16-direction gaze sheet, part " + (state.row === 9 ? "1" : "2") + ". In each frame the character looks in one direction (directions are on the screen, as seen by the viewer). Frames in order: "
        + state.look.map((a, i) => `${i + 1}) ${DIR[a]}`).join("; ")
        + `. The second reference image shows the approved poses for up, right, down and left; reuse them and interpolate evenly between them. ${exaggerate} The feet stay planted at the same spot and scale.`;
    } else {
      motion = `Animation "${state.id}" with ${state.frames} frames in time order: ${state.action}. Consecutive frames must flow smoothly as a loop.`;
    }
    return [
      "Use the character in the reference image. Keep it identical: same design, colours, proportions, outfit and art style.",
      motion,
      `Layout: a grid of ${cols} columns × ${rows} rows of equal cells; one pose per cell, read left-to-right, then top-to-bottom.${empty}`,
      "Every pose fully inside its own cell with generous padding, same character size in every cell, feet on the same ground line within each row.",
      `Style: ${STYLES[style] || STYLES.auto}.`,
      `Background: flat ${KEY_WORDS[key]} everywhere. No grid lines, no borders, no numbers, no text, no ground shadows, no motion lines, no effects detached from the body.`,
    ].join(" ");
  }

  // ---------- image helpers ----------
  async function decode(b64) {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return createImageBitmap(new Blob([bin]));
  }
  function pixels(bmp) {
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    return g.getImageData(0, 0, bmp.width, bmp.height);
  }
  async function canvasToB64(canvas) {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }
  /** Any image (b64 or Blob) → PNG b64, longest side ≤ maxSide (reference uploads). */
  async function toPngB64(src, maxSide = 1024) {
    const bmp = typeof src === "string" ? await decode(src) : await createImageBitmap(src);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return canvasToB64(c);
  }

  /** Pick the key colour the character uses least (ignoring the reference's own background). */
  function chooseKey(imageData, description = "") {
    if (!imageData) return /green|绿/i.test(description) ? "magenta" : "green";
    const d = imageData.data;
    const bg = estimateBackground(imageData);
    let green = 0, magenta = 0;
    for (let i = 0; i < d.length; i += 16) {
      const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
      if (a < 128) continue;
      if (!bg.transparent && Math.hypot(r - bg.rgb[0], g - bg.rgb[1], b - bg.rgb[2]) < 60) continue;
      if (g > r + 50 && g > b + 50) green++;
      if (r > g + 50 && b > g + 50) magenta++;
    }
    return green > magenta ? "magenta" : "green";
  }

  // ---------- matte ----------
  function estimateBackground(img) {
    const { data, width: w, height: h } = img;
    const rs = [], gs = [], bs = [];
    let transparent = 0, total = 0;
    const take = (x, y) => {
      const i = (y * w + x) * 4;
      total++;
      if (data[i + 3] < 32) { transparent++; return; }
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    };
    for (let x = 0; x < w; x += 4) { take(x, 0); take(x, 1); take(x, h - 1); take(x, h - 2); }
    for (let y = 0; y < h; y += 4) { take(0, y); take(1, y); take(w - 1, y); take(w - 2, y); }
    const med = (a) => (a.sort((x, y) => x - y), a[a.length >> 1] ?? 0);
    const rgb = [med(rs), med(gs), med(bs)];
    const kind = rgb[1] > rgb[0] + 80 && rgb[1] > rgb[2] + 80 ? "green"
      : rgb[0] > rgb[1] + 80 && rgb[2] > rgb[1] + 80 ? "magenta" : "other";
    return { rgb, kind, transparent: transparent > total * 0.5 };
  }

  /**
   * Alpha matte against the background colour. In place.
   *  1. Hard-ish key: distance to the background colour → alpha (T0..T1).
   *  2. Pixels mixed with the key colour (translucent hair / tulle / soft
   *     edges): estimate how much key is in them from the key channel's excess
   *     (green: g − max(r, b); magenta: min(r, b) − g, relative to the
   *     background's own excess), set alpha = 1 − that and un-mix the colour
   *     (fg = (c − (1−a)·key) / a). Applies anywhere — the key is the colour
   *     the character uses least, so key-tinted pixels are blends.
   *  3. Near the silhouette (≤ BAND px from background) clamp any remaining
   *     key tint.
   */
  function matte(img, bg) {
    const { data, width: w, height: h } = img;
    const [br, bgc, bb] = bg.rgb;
    const T0 = 48, T1 = 115, BAND = 14;
    const excess = bg.kind === "green" ? (r, g, b) => g - Math.max(r, b) : (r, g, b) => Math.min(r, b) - g;
    const keyExcess = Math.max(1, excess(br, bgc, bb));
    const dist = (i) => Math.hypot(data[i] - br, data[i + 1] - bgc, data[i + 2] - bb);
    if (!bg.transparent) {
      for (let i = 0; i < data.length; i += 4) {
        const d = dist(i);
        const a = d <= T0 ? 0 : d >= T1 ? 255 : Math.round(((d - T0) / (T1 - T0)) * 255);
        data[i + 3] = Math.min(data[i + 3], a);
      }
    }
    if (bg.kind === "other") return;
    // Distance (px, 8-neighbourhood) from transparent background, capped at BAND.
    const far = new Uint8Array(w * h).fill(255);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    for (let p = 0; p < w * h; p++) if (data[p * 4 + 3] === 0) { far[p] = 0; queue[tail++] = p; }
    while (head < tail) {
      const p = queue[head++], x = p % w, y = (p / w) | 0, nd = far[p] + 1;
      if (nd > BAND) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (far[n] > nd) { far[n] = nd; queue[tail++] = n; }
      }
    }
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (data[i + 3] === 0) continue;
      if (!bg.transparent) {
        const a = 1 - Math.min(1, Math.max(0, excess(data[i], data[i + 1], data[i + 2]) / keyExcess));
        if (a <= 0.05) { data[i + 3] = 0; continue; }
        if (a < 1) {
          data[i + 3] = Math.min(data[i + 3], Math.round(a * 255));
          data[i] = Math.max(0, Math.min(255, (data[i] - (1 - a) * br) / a));
          data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] - (1 - a) * bgc) / a));
          data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] - (1 - a) * bb) / a));
        }
      }
      if (far[p] > BAND) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (bg.kind === "green") { const m = Math.max(r, b); if (g > m) data[i + 1] = m; }
      else { const m = Math.min(r, b); if (m > g) { data[i] = r - (m - g); data[i + 2] = b - (m - g); } }
    }
  }

  /** 8-connected components of alpha ≥ 128. */
  function components(img) {
    const { data, width: w, height: h } = img;
    const labels = new Int32Array(w * h).fill(-1);
    const comps = [];
    const stack = new Int32Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (labels[p] !== -1 || data[p * 4 + 3] < 128) continue;
      const c = { id: comps.length, area: 0, minX: w, minY: h, maxX: 0, maxY: 0, sx: 0, sy: 0 };
      let top = 0; stack[top++] = p; labels[p] = c.id;
      while (top) {
        const q = stack[--top], x = q % w, y = (q / w) | 0;
        c.area++; c.sx += x; c.sy += y;
        if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x;
        if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (labels[n] === -1 && data[n * 4 + 3] >= 128) { labels[n] = c.id; stack[top++] = n; }
        }
      }
      comps.push(c);
    }
    return { labels, comps };
  }

  /**
   * Split a grid sheet into frames. Each component goes to the cell holding
   * its centroid; specks are dropped. Returns frames (bitmaps + geometry,
   * relative to their cell) and human-readable warnings.
   */
  function splitSheet(img, n, layout) {
    const { width: w, height: h, data } = img;
    const { cols, rows } = layout;
    const cw = w / cols, ch = h / rows;
    const { labels, comps } = components(img);
    const big = w * h * 0.0012, speck = Math.max(40, w * h * 0.00003);
    const cells = Array.from({ length: cols * rows }, () => ({ comps: [], main: false }));
    for (const c of comps) {
      if (c.area < speck) continue;
      const col = Math.min(cols - 1, Math.floor(c.sx / c.area / cw));
      const row = Math.min(rows - 1, Math.floor(c.sy / c.area / ch));
      const cell = cells[row * cols + col];
      cell.comps.push(c);
      if (c.area >= big) cell.main = true;
    }
    const warnings = [];
    const frames = [];
    for (let i = 0; i < cols * rows; i++) {
      const cell = cells[i];
      if (i >= n) { if (cell.main) warnings.push(`多出了第 ${i + 1} 个姿势，已忽略`); continue; }
      if (!cell.main) { warnings.push(`第 ${i + 1} 帧是空的`); frames.push(null); continue; }
      const parts = cell.comps;
      const box = parts.reduce((b, c) => ({
        minX: Math.min(b.minX, c.minX), minY: Math.min(b.minY, c.minY),
        maxX: Math.max(b.maxX, c.maxX), maxY: Math.max(b.maxY, c.maxY),
      }), { minX: w, minY: h, maxX: 0, maxY: 0 });
      const cx0 = (i % cols) * cw, cy0 = Math.floor(i / cols) * ch;
      if (box.minX <= 1 || box.minY <= 1 || box.maxX >= w - 2 || box.maxY >= h - 2) warnings.push(`第 ${i + 1} 帧碰到了图片边缘，可能被裁掉`);
      const spill = Math.max(cx0 - box.minX, box.maxX - (cx0 + cw), cy0 - box.minY, box.maxY - (cy0 + ch));
      if (spill > Math.min(cw, ch) * 0.08) warnings.push(`第 ${i + 1} 帧越出了自己的格子`);
      // Cut the frame out (only its own components).
      const fw = box.maxX - box.minX + 1, fh = box.maxY - box.minY + 1;
      const ids = new Set(parts.map((c) => c.id));
      const out = new ImageData(fw, fh);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const sx = box.minX + x, sy = box.minY + y, p = sy * w + sx;
        const lab = labels[p];
        // Keep soft edge pixels next to the frame's own components too.
        if (lab === -1 ? data[p * 4 + 3] === 0 : !ids.has(lab)) continue;
        out.data.set(data.subarray(p * 4, p * 4 + 4), (y * fw + x) * 4);
      }
      frames.push({ image: out, w: fw, h: fh, ch, bottom: box.maxY - cy0, centerX: (box.minX + box.maxX) / 2 - cx0 });
    }
    return { frames, warnings };
  }

  /** Median frame height as a fraction of its sheet cell's height. */
  function bodyFraction(frames) {
    const fr = frames.filter(Boolean).map((f) => f.h / f.ch).sort((a, b) => a - b);
    return fr.length ? fr[fr.length >> 1] : null;
  }

  /**
   * Scale a row into 192×208 cells and put every frame on one ground line.
   * `unit` (px per cell-height) makes all rows share one scale: every sheet
   * cell is drawn at the same height (512 px), so the idle row's body size
   * sizes the whole pet. Without it the row sizes itself (previews).
   */
  function placeRow(frames, { lift = true, unit = null } = {}) {
    const real = frames.filter(Boolean);
    if (!real.length) return [];
    const ground = Math.max(...real.map((f) => f.bottom));
    // Body size decides the scale; a jump that would leave the cell keeps the
    // body size and only gets its height compressed.
    let s = unit ? unit / real[0].ch : TARGET_H / (bodyFraction(frames) * real[0].ch);
    for (const f of real) s = Math.min(s, (CELL_W - 6) / f.w, (CELL_H - FOOT_PAD - 4) / f.h);
    return frames.map((f) => {
      if (!f) return null;
      const dw = f.w * s, dh = f.h * s;
      const room = Math.max(0, CELL_H - FOOT_PAD - 4 - dh);
      const up = lift ? Math.min((ground - f.bottom) * s, room) : 0;
      return { image: f.image, w: f.w, h: f.h, dx: CELL_W / 2 - dw / 2, dy: CELL_H - FOOT_PAD - up - dh, dw, dh };
    });
  }

  function cellCanvas(p, mirror = false) {
    const c = new OffscreenCanvas(CELL_W, CELL_H);
    if (!p) return c;
    const g = c.getContext("2d");
    const src = new OffscreenCanvas(p.w, p.h);
    src.getContext("2d").putImageData(p.image, 0, 0);
    g.imageSmoothingQuality = "high";
    if (mirror) { g.translate(CELL_W, 0); g.scale(-1, 1); }
    g.drawImage(src, p.dx, p.dy, p.dw, p.dh);
    return c;
  }

  /** Generated sheet (b64) → normalised cells for one state. */
  async function processSheet(b64, state) {
    const img = pixels(await decode(b64));
    const bg = estimateBackground(img);
    const warnings = [];
    if (!bg.transparent && bg.kind === "other") warnings.push("背景不是纯色抠像底，抠图可能不干净");
    matte(img, bg);
    const split = splitSheet(img, state.frames, layoutFor(state.frames));
    warnings.push(...split.warnings);
    const placed = placeRow(split.frames, { lift: !state.look && !state.cardinal });
    return { frames: split.frames, cells: placed.map((p) => cellCanvas(p)), warnings, ok: split.frames.every(Boolean) };
  }

  /** The base image as a single neutral cell (for previews). */
  async function processBase(b64) {
    const img = pixels(await decode(b64));
    const bg = estimateBackground(img);
    matte(img, bg);
    const split = splitSheet(img, 1, { cols: 1, rows: 1 });
    return { cell: cellCanvas(placeRow(split.frames)[0] || null), warnings: split.warnings, bgKind: bg.transparent ? "alpha" : bg.kind };
  }

  /**
   * Final layout of every row with one shared scale taken from the idle row.
   * rowsFrames: { stateId: frames[] }. Returns { stateId: OffscreenCanvas[] }.
   */
  function layoutAll(rowsFrames) {
    const idle = rowsFrames["idle"] && bodyFraction(rowsFrames["idle"]);
    const unit = idle ? TARGET_H / idle : null;
    const out = {};
    for (const st of STATES) {
      const src = st.mirrorOf ? rowsFrames[st.mirrorOf] : rowsFrames[st.id];
      if (!src) continue;
      out[st.id] = placeRow(src, { lift: !st.look && !st.cardinal, unit }).map((p) => cellCanvas(p, !!st.mirrorOf));
    }
    return out;
  }

  function mirrorCells(cells) {
    return cells.map((c) => {
      const m = new OffscreenCanvas(CELL_W, CELL_H);
      const g = m.getContext("2d");
      g.translate(CELL_W, 0); g.scale(-1, 1); g.drawImage(c, 0, 0);
      return m;
    });
  }

  /** rows: { [rowIndex]: OffscreenCanvas[] } → PNG b64 of the 1536×2288 atlas. */
  async function composeAtlas(rows) {
    const atlas = new OffscreenCanvas(CELL_W * COLS, CELL_H * ROWS);
    const g = atlas.getContext("2d");
    for (const [row, cells] of Object.entries(rows))
      cells.forEach((c, col) => c && g.drawImage(c, col * CELL_W, Number(row) * CELL_H));
    return { canvas: atlas, b64: await canvasToB64(atlas) };
  }

  return {
    CELL_W, CELL_H, STATES, STYLES, layoutFor, basePrompt, sheetPrompt,
    decode, pixels, toPngB64, canvasToB64, chooseKey,
    processSheet, processBase, mirrorCells, composeAtlas, layoutAll,
    // exposed for tests
    _internal: { estimateBackground, matte, splitSheet, placeRow, bodyFraction },
  };
})();

window.HATCH = HATCH;
