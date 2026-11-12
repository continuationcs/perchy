// Hatch window: AI profiles, generation queue, previews, install.
const { invoke } = window.__TAURI__.core;

for (const level of ["info", "warn", "error"]) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    invoke("log", { level, msg: "[hatch] " + args.map((a) => (a instanceof Error ? a.message : typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ") }).catch(() => {});
  };
}
window.addEventListener("error", (e) => console.error("uncaught:", e.message, `${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => console.error("unhandled:", String(e.reason)));

const $ = (id) => document.getElementById(id);
const S = HATCH.STATES;
const CONCURRENCY = 3;

const st = {
  profiles: [],
  refB64: null, refData: null,
  key: "green",
  baseB64: null,
  rows: {},        // id → { status, cells, warnings, raw, error }
  atlasB64: null,
};

function setStatus(el, text, kind = "") {
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

// ---------- AI profiles ----------
function currentProfile() {
  return st.profiles.find((p) => p.id === $("profile").value) || null;
}
function fillForm(p) {
  $("pName").value = p?.name || "";
  $("pProtocol").value = p?.protocol || "images";
  $("pUrl").value = p?.baseUrl || "";
  $("pModel").value = p?.model || "";
  $("pKey").value = "";
  $("pKey").placeholder = p?.hasKey ? "已保存在钥匙串（留空不修改）" : "sk-…";
  $("pQuality").value = p?.quality || "";
  $("pTransparent").checked = !!p?.transparent;
  $("deleteProfile").disabled = !p;
  $("imagesOpts").hidden = $("pProtocol").value !== "images";
}
async function loadProfiles(selectId) {
  st.profiles = await invoke("ai_profiles");
  const sel = $("profile");
  sel.innerHTML = "";
  for (const p of st.profiles) sel.add(new Option(`${p.name}${p.hasKey ? "" : "（未填 key）"}`, p.id));
  sel.add(new Option("＋ 新建配置…", ""));
  sel.value = selectId ?? (st.profiles[0]?.id || "");
  fillForm(currentProfile());
}
async function saveProfile() {
  const cur = currentProfile();
  const profile = {
    id: cur?.id || "",
    name: $("pName").value.trim() || "未命名",
    protocol: $("pProtocol").value,
    baseUrl: $("pUrl").value.trim(),
    model: $("pModel").value.trim(),
    quality: $("pQuality").value || null,
    transparent: $("pTransparent").checked,
    edits: cur?.edits ?? null,
  };
  const saved = await invoke("ai_save_profile", { profile, apiKey: $("pKey").value || null });
  await loadProfiles(saved.id);
  return saved;
}
$("profile").addEventListener("change", () => fillForm(currentProfile()));
$("newProfile").addEventListener("click", () => { $("profile").value = ""; fillForm(null); $("pName").focus(); });
$("pProtocol").addEventListener("change", () => { $("imagesOpts").hidden = $("pProtocol").value !== "images"; });
$("saveProfile").addEventListener("click", async () => {
  try { await saveProfile(); setStatus($("profileStatus"), "已保存", "ok"); }
  catch (e) { setStatus($("profileStatus"), String(e), "bad"); }
});
$("testProfile").title = "会真的生成 1 张小图，产生一次调用费用";
$("testProfile").addEventListener("click", async () => {
  const el = $("profileStatus");
  try {
    const p = await saveProfile();
    setStatus(el, "测试中…（生成 1 张图）");
    const t0 = performance.now();
    const b64 = await invoke("ai_generate", { profileId: p.id, prompt: "A small red heart sticker on a plain white background.", images: [], size: "1024x1024" });
    const bmp = await HATCH.decode(b64);
    await loadProfiles(p.id); // the backend may have switched off unsupported options
    const dropped = p.transparent && !currentProfile()?.transparent ? "（这个模型不支持透明背景，已自动关闭该选项）" : "";
    setStatus(el, `连接正常：${bmp.width}×${bmp.height}，用时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒${dropped}`, "ok");
  } catch (e) { setStatus(el, String(e), "bad"); }
});
$("deleteProfile").addEventListener("click", async () => {
  const p = currentProfile();
  if (!p || !confirm(`删除配置「${p.name}」和它保存的 API key？`)) return;
  await invoke("ai_delete_profile", { id: p.id });
  await loadProfiles();
});

// ---------- reference image ----------
async function setReference(file) {
  if (!file || !file.type.startsWith("image/")) return;
  st.refB64 = await HATCH.toPngB64(file, 1024);
  st.refData = HATCH.pixels(await HATCH.decode(st.refB64));
  showReference();
}
function showReference() {
  const drop = $("drop");
  drop.classList.add("has");
  drop.innerHTML = "";
  const img = new Image(); img.src = "data:image/png;base64," + st.refB64; drop.append(img);
  const clear = document.createElement("button"); clear.className = "small"; clear.textContent = "移除"; clear.style.marginTop = "6px";
  clear.onclick = (e) => { e.stopPropagation(); st.refB64 = st.refData = null; drop.classList.remove("has"); drop.textContent = "点击选择或拖入一张图片"; };
  drop.append(clear);
}
$("drop").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => setReference(e.target.files[0]));
$("drop").addEventListener("dragover", (e) => { e.preventDefault(); });
$("drop").addEventListener("drop", (e) => { e.preventDefault(); setReference(e.dataTransfer.files[0]); });

// ---------- estimate ----------
function plannedStates() {
  return S.filter((s) => !s.mirrorOf && (!(s.look || s.cardinal) || $("withLook").checked));
}
function updateEstimate() {
  const n = 1 + plannedStates().length;
  $("estimate").innerHTML = `预计 <b>${n}</b> 次图像生成（形象 1 次 + 动作 ${n - 1} 次；向左走由向右走镜像得到${$("withLook").checked ? "；看向方向含 1 次上右下左锚点" : ""}）。失败重试另计，费用以你的接口计费为准。`;
}
$("withLook").addEventListener("change", updateEstimate);

// ---------- saved run (resume after closing the window) ----------
// Self-tests don't touch a real saved run unless asked to (`persist`).
const persist = !window.__PERCHY_SELFTEST__ || !!window.__PERCHY_SELFTEST__.persist;
function saveMeta() {
  if (!persist || !st.baseB64) return;
  const rows = {};
  for (const [id, r] of Object.entries(st.rows))
    if (r.raw || r.status === "bad") rows[id] = { status: r.status, warnings: r.warnings || [], error: r.error || "" };
  invoke("hatch_put_meta", { meta: {
    version: 1, savedAt: new Date().toISOString(),
    name: $("petName").value, desc: $("petDesc").value, style: $("style").value,
    withLook: $("withLook").checked, key: st.key, profileId: $("profile").value, petId: $("petId").value, rows,
  } }).catch((e) => console.warn("save meta failed", String(e)));
}
function saveImage(name, b64) {
  if (persist) invoke("hatch_put_image", { name, png: b64 }).catch((e) => console.warn("save image failed", name, String(e)));
}

async function offerResume() {
  if (!persist) return;
  const run = await invoke("hatch_load").catch(() => null);
  if (!run?.images?.base) return;
  const m = run.meta || {};
  const planned = S.filter((s) => !s.mirrorOf && (!(s.look || s.cardinal) || m.withLook)).length;
  const done = Object.keys(run.images).filter((k) => k.startsWith("row-")).length;
  const area = $("baseArea");
  area.className = "box";
  area.innerHTML = "";
  const p = document.createElement("p");
  p.style.margin = "0 0 10px";
  p.textContent = `上次的孵化还没完成：「${m.name || "未命名"}」，动作已完成 ${done}/${planned} 行（${new Date(m.savedAt).toLocaleString()}）。继续的话已生成的图不会重新收费。`;
  const go = document.createElement("button"); go.className = "primary"; go.textContent = "继续上次";
  const drop = document.createElement("button"); drop.textContent = "丢弃"; drop.style.marginLeft = "8px";
  go.onclick = () => restoreRun(run);
  drop.onclick = async () => {
    if (!confirm("丢弃上次孵化的所有图片？")) return;
    await invoke("hatch_clear");
    area.className = "empty"; area.textContent = "先在左边填好 AI 接口和宠物信息，然后点「生成形象」。";
  };
  area.append(p, go, drop);
}

async function restoreRun(run) {
  const m = run.meta || {};
  $("petName").value = m.name || ""; $("petDesc").value = m.desc || "";
  $("style").value = m.style || "auto"; $("withLook").checked = !!m.withLook; updateEstimate();
  if (m.profileId && st.profiles.some((p) => p.id === m.profileId)) { $("profile").value = m.profileId; fillForm(currentProfile()); }
  if (m.petId) $("petId").value = m.petId;
  if (run.images.ref) {
    st.refB64 = run.images.ref;
    st.refData = HATCH.pixels(await HATCH.decode(st.refB64));
    showReference();
  }
  st.key = m.key || "green";
  st.baseB64 = run.images.base;
  renderBase(await HATCH.processBase(st.baseB64));
  for (const s of S) {
    const raw = run.images["row-" + s.id];
    if (raw) await applySheet(s, raw, false);
    else if (m.rows?.[s.id]?.status === "bad") st.rows[s.id] = { status: "bad", error: m.rows[s.id].error };
  }
  relayout();
  renderCards();
  setStatus($("mainStatus"), "已恢复上次的进度。点「生成全部动作」只会补上还没完成的行。", "ok");
  afterRows();
}

// ---------- generation ----------
async function generate(prompt, images, size) {
  const p = currentProfile();
  if (!p) throw new Error("请先保存一个 AI 接口配置");
  if (!p.hasKey) throw new Error("这个配置还没有填 API key");
  const out = await invoke("ai_generate", { profileId: p.id, prompt, images, size });
  return HATCH.toPngB64(out, 1536);
}

function previewCanvas(cell) {
  const c = document.createElement("canvas");
  c.width = HATCH.CELL_W; c.height = HATCH.CELL_H; c.className = "checker";
  c.getContext("2d").drawImage(cell, 0, 0);
  return c;
}

async function genBase() {
  const desc = $("petDesc").value.trim();
  const el = $("mainStatus");
  if (!st.refB64 && !desc) { setStatus(el, "请填写描述或选择一张参考图", "bad"); return false; }
  $("genBase").disabled = true;
  setStatus(el, "正在生成形象…（通常 10–60 秒）");
  try {
    st.key = HATCH.chooseKey(st.refData, desc);
    const prompt = HATCH.basePrompt({ description: desc, style: $("style").value, key: st.key, hasReference: !!st.refB64 });
    st.baseB64 = await generate(prompt, st.refB64 ? [st.refB64] : [], "1024x1024");
    const base = await HATCH.processBase(st.baseB64);
    renderBase(base);
    // A new base starts a new run: old sheets no longer match it.
    if (persist) await invoke("hatch_clear").catch(() => {});
    if (st.refB64) saveImage("ref", st.refB64);
    saveImage("base", st.baseB64);
    saveMeta();
    setStatus(el, "形象好了。满意的话点「生成全部动作」，不满意可以改描述后重新生成。", "ok");
    console.info("base ok", base.bgKind, base.warnings.join("; "));
    return true;
  } catch (e) {
    setStatus(el, "生成失败：" + e, "bad");
    console.error("base failed", String(e));
    return false;
  } finally {
    $("genBase").disabled = false;
    $("genBase").textContent = "① 重新生成形象";
  }
}

function renderBase(base) {
  const area = $("baseArea");
  area.className = "";
  area.innerHTML = "<h2>形象</h2>";
  const wrap = document.createElement("div"); wrap.className = "base";
  const raw = new Image(); raw.className = "raw"; raw.src = "data:image/png;base64," + st.baseB64; raw.title = "模型原图";
  const cut = previewCanvas(base.cell); cut.style.width = "192px"; cut.title = "抠图后";
  const info = document.createElement("div");
  info.innerHTML = `<p class="hint">左：模型原图　右：抠图并缩放到 192×208 后的效果</p>`
    + (base.warnings.length ? `<p class="hint" style="color:var(--warn)">${base.warnings.join("；")}</p>` : "");
  wrap.append(raw, cut, info);
  area.append(wrap);
  st.rows = {};
  renderCards();
  $("rowsArea").hidden = false;
  $("finalArea").hidden = true;
}

function renderCards() {
  const box = $("cards");
  box.innerHTML = "";
  for (const s of S) {
    if ((s.look || s.cardinal) && !$("withLook").checked) continue;
    const r = st.rows[s.id] || { status: "idle" };
    const card = document.createElement("div"); card.className = "card"; card.id = "card-" + s.id;
    const pill = { idle: ["等待", ""], run: ["生成中…", "run"], ok: ["完成", "ok"], warn: ["有提醒", "warn"], bad: ["失败", "bad"] }[r.status];
    card.innerHTML = `<header><b>${s.label}</b><span class="pill ${pill[1]}">${s.mirrorOf ? "镜像 · " : ""}${pill[0]}</span></header>`;
    const anim = document.createElement("canvas"); anim.className = "anim checker";
    anim.width = HATCH.CELL_W; anim.height = HATCH.CELL_H; anim.dataset.state = s.id;
    card.append(anim);
    const warn = document.createElement("div");
    warn.className = r.status === "bad" ? "bad" : "warn";
    warn.textContent = r.status === "bad" ? r.error : (r.warnings || []).join("；");
    card.append(warn);
    if (r.raw) {
      const d = document.createElement("details");
      d.innerHTML = "<summary>模型原图</summary>";
      const img = new Image(); img.src = "data:image/png;base64," + r.raw; d.append(img);
      card.append(d);
    }
    if (!s.mirrorOf) {
      const btn = document.createElement("button"); btn.className = "small";
      btn.textContent = r.status === "idle" ? "只生成这一行" : "重新生成";
      btn.disabled = r.status === "run" || !st.baseB64;
      btn.onclick = () => genRow(s).then(afterRows);
      card.append(btn);
    }
    box.append(card);
  }
}

/** Re-layout every finished row with the shared (idle-based) scale. */
function relayout() {
  const frames = {};
  for (const [id, r] of Object.entries(st.rows)) if (r.frames) frames[id] = r.frames;
  const cells = HATCH.layoutAll(frames);
  for (const [id, c] of Object.entries(cells)) if (st.rows[id]) st.rows[id].cells = c;
}

const ready = (id) => ["ok", "warn"].includes(st.rows[id]?.status);
const depsOf = (s) => (s.look ? ["look-cardinals"] : []);

/** Turn a generated sheet into frames for state `s` (and its mirror). */
async function applySheet(s, raw, save = true) {
  const out = await HATCH.processSheet(raw, s);
  st.rows[s.id] = { status: out.ok && !out.warnings.length ? "ok" : out.ok ? "warn" : "bad", frames: out.frames, cells: out.cells, warnings: out.warnings, raw,
    error: out.ok ? "" : "帧数不够：" + out.warnings.join("；") };
  for (const m of S.filter((x) => x.mirrorOf === s.id))
    st.rows[m.id] = { status: st.rows[s.id].status === "bad" ? "bad" : "ok", frames: out.frames, cells: HATCH.mirrorCells(out.cells), warnings: [], error: st.rows[s.id].error };
  if (save) { saveImage("row-" + s.id, raw); saveMeta(); }
  relayout();
  return st.rows[s.id].status;
}

// Errors not worth an automatic retry (bad key, bad request, wrong model…).
const permanent = (e) => /^HTTP 4(0[0-4]|1\d|2[0-8])/.test(String(e));

async function genRow(s, attempt = 1) {
  const missing = depsOf(s).filter((d) => !ready(d));
  if (missing.length) {
    st.rows[s.id] = { status: "bad", error: "需要先生成：" + missing.map((d) => S.find((x) => x.id === d).label).join("、") };
    renderCards();
    return;
  }
  st.rows[s.id] = { status: "run" };
  renderCards();
  let retry = false;
  try {
    const prompt = HATCH.sheetPrompt(s, st.key, $("style").value);
    const refs = [st.baseB64, ...depsOf(s).map((d) => st.rows[d].raw)];
    const raw = await generate(prompt, refs, HATCH.layoutFor(s.frames).size);
    const status = await applySheet(s, raw);
    console.info("row", s.id, status, (st.rows[s.id].warnings || []).join("; "));
    retry = status === "bad";
  } catch (e) {
    st.rows[s.id] = { status: "bad", error: String(e) };
    console.error("row failed", s.id, String(e));
    retry = !permanent(e);
    saveMeta();
  }
  // One automatic retry for frames that came out unusable or a flaky request.
  if (retry && attempt < 2) {
    console.info("row", s.id, "retrying once");
    await new Promise((r) => setTimeout(r, window.__PERCHY_SELFTEST__ ? 200 : 3000));
    return genRow(s, attempt + 1);
  }
  renderCards();
}

async function genAll() {
  $("genAll").disabled = $("genBase").disabled = true;
  const queue = plannedStates().filter((s) => !ready(s.id));
  const total = queue.length;
  let done = 0;
  const tick = () => setStatus($("rowsStatus"), `进度 ${done}/${total}`);
  tick();
  const running = new Set();
  // Take the next row whose dependencies are done (or can no longer finish).
  const next = () => {
    const i = queue.findIndex((s) => depsOf(s).every((d) => ready(d) || (!running.has(d) && !queue.some((q) => q.id === d))));
    return i < 0 ? null : queue.splice(i, 1)[0];
  };
  const worker = async () => {
    while (queue.length) {
      const s = next();
      if (!s) { await new Promise((r) => setTimeout(r, 300)); continue; }
      running.add(s.id);
      await genRow(s);
      running.delete(s.id); done++; tick();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
  $("genAll").disabled = $("genBase").disabled = false;
  afterRows();
}
$("genBase").addEventListener("click", genBase);
$("genAll").addEventListener("click", genAll);

function afterRows() {
  const needed = S.filter((s) => !(s.look || s.cardinal) || $("withLook").checked);
  const bad = needed.filter((s) => !["ok", "warn"].includes(st.rows[s.id]?.status));
  if (bad.length) {
    setStatus($("rowsStatus"), `还差：${bad.map((s) => s.label).join("、")}`, bad.some((s) => st.rows[s.id]?.status === "bad") ? "bad" : "");
    $("finalArea").hidden = true;
    return false;
  }
  setStatus($("rowsStatus"), "全部动作完成", "ok");
  buildFinal();
  return true;
}

// Several callers may ask for the atlas at once; only the newest result counts.
let buildSeq = 0;
async function buildFinal() {
  const seq = ++buildSeq;
  relayout();
  const rows = {};
  for (const s of S) if (s.row != null) rows[s.row] = st.rows[s.id]?.cells;
  // Without generated look rows, every direction shows the first idle frame.
  if (!$("withLook").checked) {
    const idle = st.rows["idle"].cells[0];
    rows[9] = Array(8).fill(idle); rows[10] = Array(8).fill(idle);
  }
  const { canvas, b64 } = await HATCH.composeAtlas(rows);
  if (seq !== buildSeq) return; // a newer build superseded this one
  st.atlasB64 = b64;
  const view = $("atlas").getContext("2d");
  view.clearRect(0, 0, 1536, 2288); view.drawImage(canvas, 0, 0);
  if (!$("petId").value) $("petId").value = slug($("petName").value);
  $("finalArea").hidden = false;
}

function slug(name) {
  const s = name.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").toLowerCase().slice(0, 40);
  return s || "pet-" + Date.now().toString(36);
}

async function install() {
  const el = $("installStatus");
  try {
    const p = currentProfile();
    const done = await invoke("install_generated", {
      id: $("petId").value.trim(),
      displayName: $("petName").value.trim() || $("petId").value.trim(),
      description: $("petDesc").value.trim() || "AI hatched pet",
      spritesheetPng: st.atlasB64,
      perchyJson: JSON.stringify({ format: "perchy/1", tags: ["ai-hatched"], generator: { tool: "perchy-hatch", protocol: p?.protocol, model: p?.model } }, null, 2),
    });
    setStatus(el, `${done.replaced ? "已更新" : "已安装"}「${done.displayName}」，桌宠已经换成它了。`, "ok");
    if (persist) invoke("hatch_clear").catch(() => {});
    console.info("installed", done.key);
    return done;
  } catch (e) {
    setStatus(el, "安装失败：" + e, "bad");
    console.error("install failed", String(e));
    return null;
  }
}
$("install").addEventListener("click", install);

// ---------- card animations ----------
let frameNo = 0;
setInterval(() => {
  frameNo++;
  for (const c of document.querySelectorAll("canvas.anim")) {
    const cells = st.rows[c.dataset.state]?.cells;
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    if (cells?.length) g.drawImage(cells[frameNo % cells.length], 0, 0);
  }
}, 140);

// ---------- start ----------
updateEstimate();
loadProfiles().then(() => (window.__PERCHY_SELFTEST__ ? selftest() : offerResume()));

// Dev self-test (`perchy --hatch-selftest <base url> <images|chat>`) runs the
// whole flow against a mock server (see tools/mock-image-api.py).
async function selftest() {
  const cfg = window.__PERCHY_SELFTEST__;
  if (!cfg) return;
  const q = { get: (k) => cfg[k] };
  console.info("selftest start", q.get("protocol"));
  let saved = { id: "" };
  try {
    saved = await invoke("ai_save_profile", {
      profile: { id: "", name: "selftest-" + q.get("protocol"), protocol: q.get("protocol") || "images", baseUrl: q.get("selftest"), model: "mock-image", quality: null, transparent: !!q.get("transparent") },
      apiKey: "test-key",
    });
    await loadProfiles(saved.id);
    $("petName").value = "自测团子"; $("petDesc").value = "a round orange blob mascot";
    if (!(await genBase())) throw new Error("base failed");
    await genAll();
    if (!afterRows()) throw new Error("rows incomplete: " + JSON.stringify(Object.fromEntries(Object.entries(st.rows).map(([k, v]) => [k, v.status + (v.error ? ":" + v.error : "")]))));
    await buildFinal();
    if (persist) {
      // Save/restore round trip: rebuild everything from the stored run and
      // expect a byte-identical atlas.
      const before = st.atlasB64;
      const beforeRaw = Object.fromEntries(Object.entries(st.rows).map(([k, v]) => [k, v.raw]));
      const run = await invoke("hatch_load");
      for (const [k, raw] of Object.entries(beforeRaw))
        if (raw && run.images["row-" + k] !== raw) console.warn("selftest stored sheet differs:", k);
      if (run.images.base !== st.baseB64) console.warn("selftest stored base differs");
      const rows = Object.keys(run?.images || {}).filter((k) => k.startsWith("row-")).length;
      st.rows = {}; st.baseB64 = null; st.atlasB64 = null;
      await restoreRun(run);
      await buildFinal();
      console.info("selftest resume", st.atlasB64 === before ? "OK" : "MISMATCH", `stored rows=${rows}`);
      if (st.atlasB64 !== before) throw new Error("resume produced a different atlas");
    }
    $("petId").value = "selftest-" + q.get("protocol");
    const done = await install();
    console.info("selftest", done ? "PASS " + done.key : "FAIL install");
  } catch (e) {
    console.error("selftest FAIL", String(e));
  } finally {
    await invoke("ai_delete_profile", { id: saved.id }).catch(() => {});
    if (persist) await invoke("hatch_clear").catch(() => {});
  }
}
