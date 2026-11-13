// Coquou app window: pet library, hatch entry, behaviour, general settings,
// about & updates.
//
// Overlay choices (pet, size, zone, activity, sleep) belong to the overlay
// (main.js); this page sends the same "tray" commands the tray uses and
// redraws from the `ui-state` the overlay reports back. App settings live in
// Rust (settings.rs).

const { invoke } = window.__TAURI__.core;
const { listen, emit } = window.__TAURI__.event;

// Errors go to the app log (stdout) — there are no devtools in release builds.
window.addEventListener("error", (e) => invoke("log", { level: "error", msg: `[app] ${e.message} @ ${e.filename}:${e.lineno}` }).catch(() => {}));
window.addEventListener("unhandledrejection", (e) => invoke("log", { level: "error", msg: `[app] unhandled: ${e.reason}` }).catch(() => {}));
const $ = (id) => document.getElementById(id);
const tell = (cmd) => emit("tray", cmd);

const SIZES = [["0.75", "小"], ["1", "标准"], ["1.3", "大"], ["1.6", "特大"], ["2", "超大"]];
const ACTIVITIES = [["quiet", "安静"], ["normal", "正常"], ["lively", "活泼"]];
const SLEEPS = [["20", "20 秒"], ["45", "45 秒"], ["120", "2 分钟"], ["300", "5 分钟"], ["0", "从不"]];
const ZONES = [
  ["corners", "两边角落", "默认，左右下角来回", [[0, 26], [94, 120]]],
  ["right", "右下角", "只在右边", [[94, 120]]],
  ["left", "左下角", "只在左边", [[0, 26]]],
  ["full", "整个底部", "可以走到中间", [[0, 120]]],
];
const SOURCE = { builtin: "内置", preset: "预设", coquou: "我的", codex: "Codex" };
const FILTERS = [["all", "全部"], ["preset", "预设"], ["coquou", "我的"], ["codex", "Codex"]];

// Codex rows: [row, frame durations]
const tail = (n, each, last) => [...Array(n - 1).fill(each), last];
const ROWS = {
  idle: [0, [280, 110, 110, 140, 140, 320]],
  walk: [1, tail(8, 120, 220)],
  wave: [3, tail(4, 140, 280)],
  jump: [4, tail(5, 140, 280)],
  failed: [5, tail(8, 140, 240)],
  waiting: [6, tail(6, 150, 260)],
  work: [7, tail(6, 120, 220)],
  review: [8, tail(6, 150, 280)],
};
const CHIPS = [["idle", "待机"], ["walk", "走路"], ["wave", "挥手"], ["jump", "跳跃"], ["work", "干活"], ["review", "思考"], ["failed", "难过"]];
const BUILTIN_CHIPS = [["idle", "待机"], ["walk", "走路"], ["wave", "开心"], ["sleep", "睡觉"]];

const platform = /Mac/.test(navigator.userAgent) ? "macos" : /Windows/.test(navigator.userAgent) ? "windows" : "linux";
document.documentElement.classList.add(platform === "macos" ? "mac" : platform);

let ui = { pet: "", size: "1", zone: "corners", activity: "normal", sleep: "45" };
let pets = [];          // [{ key, id, displayName, source, ... }]
let selected = null;    // key shown in the detail panel
let filter = "all";
let query = "";
let chip = "idle";
let settings = null;

// ---------- small helpers ----------
let toastTimer = 0;
function toast(text, bad = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = bad ? "on bad" : "on";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = bad ? "bad" : ""), bad ? 5000 : 2600);
}
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
function segmented(box, items, current, onPick) {
  box.replaceChildren(...items.map(([value, label]) => {
    const b = el("button", { textContent: label, type: "button" });
    b.classList.toggle("on", value === current);
    b.onclick = () => onPick(value);
    return b;
  }));
}
window.coquouConfirm = (...a) => confirmDialog(...a);
// The hatch page reports an unfinished run (dot on its nav item).
window.coquouHatchPending = (on) => { $("navHatchDot").hidden = !on; };
function confirmDialog(title, text, ok = "删除") {
  return new Promise((resolve) => {
    $("modalTitle").textContent = title;
    $("modalText").textContent = text;
    $("modalOk").textContent = ok;
    $("modal").hidden = false;
    const done = (v) => { $("modal").hidden = true; resolve(v); };
    $("modalOk").onclick = () => done(true);
    $("modalCancel").onclick = () => done(false);
    $("modalCancel").focus();
  });
}

// ---------- navigation ----------
function showPage(name) {
  if (!$("page-" + name)) return;
  for (const b of document.querySelectorAll("nav button")) b.classList.toggle("on", b.dataset.page === name);
  for (const p of document.querySelectorAll("section.page")) p.hidden = p.id !== "page-" + name;
}
for (const b of document.querySelectorAll("nav button")) b.onclick = () => showPage(b.dataset.page);
showPage(window.__COQUOU_PAGE__ || "pets");
listen("app-page", ({ payload }) => showPage(payload));
$("now").onclick = () => { showPage("pets"); select(ui.pet); };

// ---------- pet art ----------
const art = new Map();   // key → Promise<{ img, k, … } | { builtin: true }>
const ready = new Map(); // key → the resolved value, for the animation loop

async function petBytes(key, path) { return invoke("read_pet_file", { key, path }); }
async function petJson(key, path) {
  try { return JSON.parse(new TextDecoder().decode(await petBytes(key, path))); } catch { return null; }
}
function loadArt(key) {
  if (!art.has(key)) {
    art.set(key, (async () => {
      if (key === "builtin") return { builtin: true };
      const manifest = await petJson(key, "pet.json");
      const ext = (await petJson(key, "coquou.json")) ?? (await petJson(key, "perchy.json"));
      const sheet = manifest?.spritesheetPath || "spritesheet.webp";
      let img = null;
      if (ext?.hd) try { img = await createImageBitmap(new Blob([await petBytes(key, ext.hd)])); } catch {}
      if (!img) img = await createImageBitmap(new Blob([await petBytes(key, sheet)]));
      return { img, k: img.width / 1536, rows: img.height / img.width * 1536 / 208 >= 10.5 ? 11 : 9, ext, manifest };
    })().then((a) => { ready.set(key, a); return a; }));
  }
  return art.get(key);
}

const fakePet = (state, t) => ({
  state, facing: 1, stateT: t % 2, swing: 0, blinkUntil: (t % 3.2) < 0.15 ? t + 1 : 0, look: null,
  loved: state === "happy" ? t + 1 : 0, faceOverride: state === "happy" ? { face: "happy", until: t + 1 } : null, dropHover: false,
});

// Draw one frame of `anim` at time t (seconds) into canvas g (w×h).
function paint(g, a, anim, t, w, h, crop = true) {
  g.clearRect(0, 0, w, h);
  if (!a) return;
  if (a.builtin) {
    const state = anim === "walk" ? "walk" : anim === "sleep" ? "sleep" : anim === "wave" ? "happy" : "idle";
    g.save();
    g.translate(w / 2, h * 0.86);
    g.scale(w / 150, w / 150);
    window.builtinRenderer.draw(g, fakePet(state === "happy" ? "idle" : state, t), t);
    g.restore();
    return;
  }
  const [row, durs] = ROWS[anim] || ROWS.idle;
  const total = durs.reduce((x, y) => x + y, 0);
  let ms = (t * 1000) % total, f = 0;
  while (f < durs.length - 1 && ms >= durs[f]) { ms -= durs[f]; f++; }
  const k = a.k;
  // The body sits in the lower middle of a 192×208 cell; crop the margins.
  const [sx, sy, sw, sh] = crop ? [16, 26, 160, 176] : [0, 0, 192, 208];
  g.imageSmoothingQuality = "high";
  g.drawImage(a.img, (f * 192 + sx) * k, (row * 208 + sy) * k, sw * k, sh * k, 0, 0, w, h);
}

// ---------- library ----------
function visible() {
  const q = query.trim().toLowerCase();
  return pets.filter((p) => (filter === "all" || p.source === filter)
    && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
}

function renderFilters() {
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === "all" ? pets.length : pets.filter((p) => p.source === k).length]));
  segmented($("filters"), FILTERS.filter(([k]) => k === "all" || counts[k]).map(([k, l]) => [k, `${l} ${counts[k]}`]), filter, (v) => {
    filter = v; renderFilters(); renderGrid();
  });
}

const cardCanvases = new Map(); // key → canvas
let hovered = null;

function renderGrid() {
  const list = visible();
  cardCanvases.clear();
  const cards = list.map((p) => {
    const c = el("canvas", { width: 256, height: 282 });
    cardCanvases.set(p.key, c);
    const card = el("div", { className: "pet", tabIndex: 0 },
      c,
      el("b", { textContent: p.displayName }),
      el("div", { className: "tag", textContent: SOURCE[p.source] || p.source }));
    card.dataset.key = p.key;
    if (p.key === ui.pet) card.append(el("span", { className: "badge", textContent: "使用中" }));
    card.classList.toggle("sel", p.key === selected);
    card.onclick = () => select(p.key);
    card.ondblclick = () => tell("pet:" + p.key);
    card.onkeydown = (e) => { if (e.key === "Enter") tell("pet:" + p.key); if (e.key === " ") { e.preventDefault(); select(p.key); } };
    card.onmouseenter = () => (hovered = p.key);
    card.onmouseleave = () => {
      if (hovered === p.key) hovered = null;
      if (ready.has(p.key)) paint(c.getContext("2d"), ready.get(p.key), "idle", 0, c.width, c.height);
    };
    loadArt(p.key).then((a) => paint(c.getContext("2d"), a, "idle", 0, c.width, c.height)).catch(() => {});
    return card;
  });
  $("grid").replaceChildren(...(cards.length ? cards : [el("div", { className: "empty", textContent: query ? "没有找到这个名字的宠物" : "这里还没有宠物" })]));
}

let stage = null;
async function renderDetail() {
  const p = pets.find((x) => x.key === selected);
  const box = $("detail");
  if (!p) { box.hidden = true; return; }
  box.hidden = false;
  const a = await loadArt(p.key).catch(() => null);
  if (p.key !== selected) return;
  const chips = p.key === "builtin" ? BUILTIN_CHIPS : CHIPS.filter(([k]) => ROWS[k][0] < (a?.rows || 9));
  if (!chips.some(([k]) => k === chip)) chip = "idle";
  stage = el("canvas", { width: 460, height: 500 });
  const chipBox = el("div", { className: "chips" });
  chips.forEach(([k, label]) => {
    const b = el("button", { textContent: label, type: "button" });
    b.classList.toggle("on", k === chip);
    b.onclick = () => { chip = k; for (const o of chipBox.children) o.classList.toggle("on", o === b); };
    chipBox.append(b);
  });
  const current = p.key === ui.pet;
  const use = el("button", { className: "btn primary use" + (current ? " current" : ""), textContent: current ? "✓ 正在桌面上" : "让它上桌面", type: "button" });
  use.disabled = false;
  use.onclick = () => { if (!current) tell("pet:" + p.key); };

  const ext = a?.ext || {};
  const desc = a?.manifest?.description || (p.key === "builtin" ? "Coquou 自带的程序绘制小猫，不需要任何素材文件。" : "");
  const meta = el("dl", { className: "meta" });
  const add = (k, v) => { if (v) meta.append(el("dt", { textContent: k }), el("dd", { textContent: v })); };
  add("来源", { builtin: "内置", preset: "Coquou 预设", coquou: "安装在 Coquou", codex: "Codex 宠物（只读）" }[p.source]);
  add("作者", ext.author);
  add("授权", ext.license);
  add("ID", p.id);

  const more = el("div", { className: "more" });
  if (p.key !== "builtin") {
    const exp = el("button", { className: "btn ghost", type: "button", textContent: "导出 .pet" });
    exp.onclick = () => invoke("export_pet", { key: p.key }).then((f) => toast(`已导出到「下载」：${f}`)).catch((e) => toast("导出失败：" + e, true));
    const reveal = el("button", { className: "btn ghost", type: "button", textContent: platform === "macos" ? "在访达中显示" : "打开所在文件夹" });
    reveal.onclick = () => invoke("reveal_pet", { key: p.key }).catch((e) => toast(String(e), true));
    more.append(exp, reveal);
  }
  if (p.source === "coquou") {
    const del = el("button", { className: "btn ghost danger", type: "button", textContent: "删除" });
    del.onclick = async () => {
      if (!(await confirmDialog(`删除「${p.displayName}」？`, "宠物文件会从 Coquou 的宠物文件夹里删掉，无法恢复。可以先导出一份 .pet 备份。"))) return;
      invoke("delete_pet", { key: p.key }).then(() => toast(`已删除「${p.displayName}」`)).catch((e) => toast(String(e), true));
    };
    more.append(del);
  }

  const children = [
    el("div", { className: "stage" }, stage),
    chipBox,
    el("h2", { textContent: p.displayName }),
    el("div", { className: "src", textContent: SOURCE[p.source] || p.source }),
    desc ? el("p", { className: "desc", textContent: desc }) : null,
    use,
  ];
  if (current) {
    const sizes = el("div", { className: "seg" });
    segmented(sizes, SIZES, String(Number(ui.size) || 1), (v) => tell("size:" + v));
    children.push(el("div", { className: "sizes" }, el("span", { textContent: "大小" }), sizes));
  }
  children.push(meta, more);
  box.replaceChildren(...children.filter(Boolean));
}

function select(key) {
  if (!pets.some((p) => p.key === key)) key = pets[0]?.key ?? null;
  selected = key;
  for (const c of document.querySelectorAll(".pet")) c.classList.toggle("sel", c.dataset.key === key);
  chip = "idle";
  renderDetail();
}

async function loadPets() {
  const list = await invoke("list_pets").catch(() => []);
  const order = { preset: 0, coquou: 1, codex: 2, builtin: 3 };
  pets = [...list, { key: "builtin", id: "builtin", displayName: "团团", source: "builtin" }]
    .sort((a, b) => order[a.source] - order[b.source]);
  if (!pets.some((p) => p.key === selected)) selected = pets.some((p) => p.key === ui.pet) ? ui.pet : pets[0]?.key;
  renderFilters();
  renderGrid();
  renderDetail();
  renderNow();
}

function renderNow() {
  const p = pets.find((x) => x.key === ui.pet);
  $("nowName").textContent = p ? p.displayName : "—";
}

// Animation: the detail stage, the hovered card and the sidebar thumbnail.
function tick(now) {
  const t = now / 1000;
  if (!document.hidden) {
    if (stage && ready.has(selected)) paint(stage.getContext("2d"), ready.get(selected), chip, t, stage.width, stage.height);
    if (hovered && cardCanvases.has(hovered) && ready.has(hovered)) {
      const c = cardCanvases.get(hovered);
      paint(c.getContext("2d"), ready.get(hovered), hovered === "builtin" ? "walk" : "wave", t, c.width, c.height);
    }
    const nc = $("nowThumb");
    if (ready.has(ui.pet)) paint(nc.getContext("2d"), ready.get(ui.pet), "idle", t, nc.width, nc.height);
    else if (ui.pet) loadArt(ui.pet).catch(() => {});
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

$("search").oninput = (e) => { query = e.target.value; renderGrid(); };
$("hatchBtn").onclick = () => showPage("hatch");
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async (e) => {
  for (const file of e.target.files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const done = await invoke("install_bytes", bytes, { headers: { "x-name": encodeURIComponent(file.name) } });
      selected = done.key;
    } catch (err) { toast("装不上：" + err, true); }
  }
  e.target.value = "";
};

// ---------- welcome (first run) ----------
const WELCOME = "coquou.welcome.dismissed";
function renderWelcome() {
  let dismissed = false;
  try { dismissed = !!localStorage.getItem(WELCOME); } catch {}
  $("welcome").hidden = dismissed;
  $("welcomeText").textContent = platform === "macos"
    ? "宠物会在屏幕底部的角落里溜达。Coquou 住在屏幕右上角的菜单栏里，点那里的图标可以换宠物、叫它回来，或者再打开这个窗口。"
    : "宠物会在屏幕底部的角落里溜达。Coquou 住在屏幕右下角的通知区域（可能在「^」里），单击图标打开这个窗口，右键可以换宠物、叫它回来。";
}
$("welcomeOk").onclick = () => { try { localStorage.setItem(WELCOME, "1"); } catch {} renderWelcome(); };
$("dropHint").textContent = "把 .pet / .zip 宠物包拖进这个窗口，或拖到桌面上的宠物身上，都能安装。";

// ---------- behaviour ----------
function zoneSvg(spans) {
  const bars = spans.map(([a, b]) => `<rect x="${a}" y="58" width="${b - a}" height="12" rx="3" fill="var(--accent)"/>`).join("");
  return `<svg viewBox="0 0 120 76"><rect x="1" y="1" width="118" height="74" rx="8" fill="var(--hover)" stroke="var(--line-2)"/><rect x="30" y="14" width="60" height="30" rx="4" fill="var(--panel)" stroke="var(--line-2)"/>${bars}</svg>`;
}
function renderBehaviour() {
  $("zones").replaceChildren(...ZONES.map(([v, label, hint, spans]) => {
    const b = el("button", { className: "zone", type: "button" });
    b.innerHTML = `${zoneSvg(spans)}<b></b><small></small>`;
    b.querySelector("b").textContent = label;
    b.querySelector("small").textContent = hint;
    b.classList.toggle("on", ui.zone === v);
    b.onclick = () => tell("zone:" + v);
    return b;
  }));
  segmented($("activity"), ACTIVITIES, ui.activity || "normal", (v) => tell("activity:" + v));
  segmented($("sleep"), SLEEPS, ui.sleep || "45", (v) => tell("sleep:" + v));
  segmented($("size"), SIZES, String(Number(ui.size) || 1), (v) => tell("size:" + v));
}

// ---------- general ----------
async function loadSettings() {
  settings = await invoke("get_settings");
  $("version").textContent = "v" + settings.version;
  for (const id of ["hideFullscreen", "batterySaver", "autostart", "autoUpdate"]) $(id).checked = settings[id];
  const sel = $("display");
  sel.replaceChildren(...settings.displays.map((d) => el("option", { value: d.key, textContent: d.label })));
  sel.value = settings.currentDisplay ?? "";
  sel.disabled = settings.displays.length < 2;
  $("petsDir").textContent = settings.petsDir || "";
  $("codexDir").textContent = settings.codexDir || "";
  for (const k of document.querySelectorAll(".keystore")) k.textContent = settings.platform === "windows" ? "凭据管理器" : "钥匙串";
}
for (const id of ["hideFullscreen", "batterySaver", "autostart", "autoUpdate"]) {
  $(id).onchange = (e) => invoke("set_setting", { name: id, value: e.target.checked }).catch((err) => { toast("设置失败：" + err, true); loadSettings(); });
}
$("display").onchange = (e) => invoke("set_setting", { name: "display", value: e.target.value }).then(loadSettings);
$("openDir").onclick = () => invoke("open_window", { name: "pets-dir" });
for (const b of document.querySelectorAll("[data-link]")) b.onclick = () => invoke("open_link", { which: b.dataset.link });

// ---------- updates ----------
function ago(sec) {
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return "刚刚";
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
  return `${Math.floor(d / 86400)} 天前`;
}
// Release notes are Markdown on GitHub: render headings, lists, bold, code.
function notesHtml(md) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  let html = "", list = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const item = line.match(/^[-*+]\s+(.*)/);
    if (item) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(item[1])}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) html += `<h4>${inline(h[1])}</h4>`;
    else if (line) html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? "</ul>" : "");
}
function renderUpdate(s) {
  const a = s.available;
  $("navUpdateDot").hidden = !a;
  $("updState").textContent = s.installing ? "正在下载更新…" : s.checking ? "正在检查更新…"
    : a ? `发现新版本 v${a.version}` : s.lastChecked ? `已是最新版本 v${s.current}` : `当前版本 v${s.current}`;
  $("updDetail").textContent = s.lastError || (s.lastChecked ? `上次检查：${ago(s.lastChecked)}` : "");
  $("updDetail").style.color = s.lastError ? "var(--bad)" : "";
  $("updCheck").disabled = s.checking || s.installing;
  $("updAvail").hidden = !a;
  if (a) {
    $("updVersion").textContent = `v${s.current} → v${a.version}`;
    $("updDate").textContent = a.date ? `发布于 ${a.date}` : "";
    $("updNotes").innerHTML = notesHtml(a.notes || "");
    $("updInstall").disabled = s.installing;
    $("updInstall").textContent = s.installing ? "正在更新…" : "更新并重启";
  }
  $("updProgress").hidden = !s.installing;
}
$("updCheck").onclick = () => invoke("update_check").then(renderUpdate).catch((e) => toast(String(e), true));
$("updInstall").onclick = () => invoke("update_install").catch((e) => toast("更新失败：" + e, true));
listen("update-status", ({ payload }) => renderUpdate(payload));
listen("update-progress", ({ payload }) => {
  const { downloaded, total } = payload;
  $("updProgress").hidden = false;
  $("updProgress").firstElementChild.style.width = total ? `${Math.min(100, (downloaded / total) * 100)}%` : "50%";
});

// ---------- live updates ----------
function applyUi(next) {
  const petChanged = next.pet !== ui.pet;
  ui = { ...ui, ...next };
  renderBehaviour();
  renderNow();
  if (petChanged) renderGrid();
  renderDetail();
}
listen("ui-state", ({ payload }) => applyUi(payload));
listen("settings-changed", loadSettings);
listen("pet-installed", ({ payload }) => {
  art.delete(payload.key); ready.delete(payload.key);
  toast(`${payload.replaced ? "更新" : "安装"}好了：${payload.displayName}`);
  selected = payload.key;
  showPage("pets");
  loadPets();
});
listen("pet-install-failed", ({ payload }) => toast(`装不上${payload.file ? " " + payload.file : ""}：${payload.error}`, true));
listen("pets-changed", ({ payload }) => { if (payload?.removed) { art.delete(payload.removed); ready.delete(payload.removed); } loadPets(); });

// Drag & drop: on the hatch page a single image becomes the reference image;
// anything else (.pet / .zip / folders) is installed.
const IMAGE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const onHatch = () => !$("page-hatch").hidden;
const asReference = (paths) => onHatch() && paths?.length === 1 && IMAGE.test(paths[0]);
window.__TAURI__.webviewWindow.getCurrentWebviewWindow().onDragDropEvent(({ payload }) => {
  if (payload.type === "enter") $("dropText").textContent = asReference(payload.paths) ? "松手设为参考图" : "松手安装宠物";
  $("dropOverlay").classList.toggle("on", payload.type === "enter" || payload.type === "over");
});
listen("app-drop", async ({ payload: paths }) => {
  $("dropOverlay").classList.remove("on");
  if (asReference(paths)) {
    try {
      const bytes = await invoke("read_dropped", { path: paths[0] });
      const name = paths[0].split(/[\\/]/).pop();
      const ext = name.split(".").pop().toLowerCase();
      window.hatchSetReference?.(new File([bytes], name, { type: "image/" + (ext === "jpg" ? "jpeg" : ext) }));
    } catch (e) { toast("读不了这张图：" + e, true); }
  } else invoke("install_dropped");
});

(async () => {
  ui = { ...ui, ...(await invoke("ui_state").catch(() => ({}))) };
  if (!ui.pet) ui.pet = "builtin";
  renderWelcome();
  renderBehaviour();
  await Promise.all([loadPets(), loadSettings()]);
  invoke("update_status").then(renderUpdate).catch(() => {});
})();
