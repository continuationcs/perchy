// Settings window. Overlay choices (pet, size, zone, activity, sleep) are
// owned by the overlay (main.js): this page sends them as the same "tray"
// events the tray menu uses and redraws from the `ui-state` the overlay
// reports back. App settings (display, fullscreen, autostart, battery) live
// in Rust (settings.rs).

const { invoke } = window.__TAURI__.core;
const { listen, emit } = window.__TAURI__.event;
const $ = (id) => document.getElementById(id);

const SIZES = [["0.75", "小"], ["1", "标准"], ["1.3", "大"], ["1.6", "特大"], ["2", "超大"]];
const ZONES = [
  ["corners", "两边角落", "在屏幕左下角和右下角之间来回（默认）"],
  ["right", "只在右下角", ""],
  ["left", "只在左下角", ""],
  ["full", "整个屏幕底部", "可以走到屏幕中间"],
];
const ACTIVITIES = [["quiet", "安静"], ["normal", "正常"], ["lively", "活泼"]];
const SLEEPS = [["20", "20 秒"], ["45", "45 秒"], ["120", "2 分钟"], ["300", "5 分钟"], ["0", "从不"]];
const SOURCE_TAG = { builtin: "内置", preset: "预设", codex: "Codex", perchy: "已安装" };

let ui = { pet: "", size: "1", zone: "corners", activity: "normal", sleep: "45" };
const tell = (cmd) => emit("tray", cmd);

// ---------- toast ----------
let toastTimer = 0;
function toast(text, bad = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = bad ? "on bad" : "on";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = bad ? "bad" : ""), bad ? 5000 : 2600);
}

// ---------- navigation ----------
for (const b of document.querySelectorAll("nav button")) {
  b.onclick = () => {
    for (const o of document.querySelectorAll("nav button")) o.classList.toggle("on", o === b);
    for (const p of document.querySelectorAll("section.page")) p.hidden = p.id !== "page-" + b.dataset.page;
  };
}

// ---------- small controls ----------
function segmented(el, items, current, onPick) {
  el.replaceChildren(...items.map(([value, label]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.classList.toggle("on", value === current);
    b.onclick = () => onPick(value);
    return b;
  }));
}

function renderUi() {
  segmented($("size"), SIZES, String(Number(ui.size) || 1), (v) => tell("size:" + v));
  segmented($("activity"), ACTIVITIES, ui.activity || "normal", (v) => tell("activity:" + v));
  segmented($("sleep"), SLEEPS, ui.sleep || "45", (v) => tell("sleep:" + v));
  $("zone").replaceChildren(...ZONES.map(([value, label, hint]) => {
    const row = document.createElement("label");
    row.className = "choice";
    const input = Object.assign(document.createElement("input"), { type: "radio", name: "zone", checked: value === ui.zone });
    input.onchange = () => tell("zone:" + value);
    const text = document.createElement("div");
    text.textContent = label;
    if (hint) { const s = document.createElement("small"); s.textContent = hint; text.append(s); }
    row.append(input, text);
    return row;
  }));
  for (const card of document.querySelectorAll(".pet")) card.classList.toggle("on", card.dataset.key === ui.pet);
}

// ---------- pet thumbnails ----------
const thumbCache = new Map();

async function petBytes(key, path) {
  return invoke("read_pet_file", { key, path });
}
async function petJson(key, path) {
  try { return JSON.parse(new TextDecoder().decode(await petBytes(key, path))); } catch { return null; }
}

// Idle frame 0 of a sprite pet (HD atlas when the pet has one).
async function spriteThumb(key) {
  const manifest = await petJson(key, "pet.json");
  const ext = await petJson(key, "perchy.json");
  let sheet = manifest?.spritesheetPath || "spritesheet.webp", k = 1;
  if (ext?.hd) { sheet = ext.hd; k = 2; }
  let img;
  try { img = await createImageBitmap(new Blob([await petBytes(key, sheet)])); }
  catch { img = await createImageBitmap(new Blob([await petBytes(key, manifest?.spritesheetPath || "spritesheet.webp")])); k = 1; }
  k = img.width / 1536;
  // The body sits in the lower middle of a 192×208 cell; crop the margins.
  return (g, w, h) => g.drawImage(img, 16 * k, 28 * k, 160 * k, 176 * k, 0, 0, w, h);
}

function builtinThumb() {
  const p = { state: "idle", facing: 1, stateT: 0, swing: 0, blinkUntil: 0, look: null, loved: 0, faceOverride: null, dropHover: false };
  return (g, w, h) => {
    g.save();
    g.translate(w / 2, h - h * 0.12);
    g.scale(w / 140, w / 140);
    window.builtinRenderer.draw(g, p, 0);
    g.restore();
  };
}

async function drawThumb(canvas, key) {
  if (!thumbCache.has(key)) thumbCache.set(key, key === "builtin" ? Promise.resolve(builtinThumb()) : spriteThumb(key));
  try {
    const paint = await thumbCache.get(key);
    const g = canvas.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.clearRect(0, 0, canvas.width, canvas.height);
    paint(g, canvas.width, canvas.height);
  } catch (e) {
    console.warn("thumbnail", key, e);
  }
}

async function loadPets() {
  const pets = await invoke("list_pets").catch(() => []);
  const all = [{ key: "builtin", displayName: "团团", source: "builtin" }, ...pets];
  // Presets first, then installed, then Codex, then the built-in cat.
  const order = { preset: 0, perchy: 1, codex: 2, builtin: 3 };
  all.sort((a, b) => order[a.source] - order[b.source]);
  $("pets").replaceChildren(...all.map((p) => {
    const card = document.createElement("div");
    card.className = "pet";
    card.dataset.key = p.key;
    card.title = p.key;
    const canvas = Object.assign(document.createElement("canvas"), { width: 192, height: 208 });
    const name = document.createElement("b");
    name.textContent = p.displayName;
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = SOURCE_TAG[p.source] || p.source;
    const check = document.createElement("div");
    check.className = "check";
    check.textContent = "✓";
    card.append(canvas, name, tag, check);
    if (p.key !== "builtin") {
      const exp = document.createElement("button");
      exp.className = "export";
      exp.textContent = "导出";
      exp.title = "导出为 .pet 到「下载」";
      exp.onclick = (e) => {
        e.stopPropagation();
        invoke("export_pet", { key: p.key })
          .then((file) => toast(`已导出到「下载」：${file}`))
          .catch((err) => toast("导出失败：" + err, true));
      };
      card.append(exp);
    }
    card.onclick = () => tell("pet:" + p.key);
    drawThumb(canvas, p.key);
    return card;
  }));
  renderUi();
  // About icon: the mascot if present.
  drawThumb($("aboutPet"), pets.some((p) => p.key === "preset:qiqi") ? "preset:qiqi" : "builtin");
}

// ---------- system settings ----------
async function loadSettings() {
  const s = await invoke("get_settings");
  $("version").textContent = "v" + s.version;
  $("hideFullscreen").checked = s.hideFullscreen;
  $("batterySaver").checked = s.batterySaver;
  $("autostart").checked = s.autostart;
  const sel = $("display");
  sel.replaceChildren(...s.displays.map((d) => Object.assign(document.createElement("option"), { value: d.key, textContent: d.label })));
  sel.value = s.currentDisplay ?? "";
  sel.disabled = s.displays.length < 2;
}

for (const id of ["hideFullscreen", "batterySaver", "autostart"]) {
  $(id).onchange = (e) => {
    invoke("set_setting", { name: id, value: e.target.checked }).catch((err) => {
      toast("设置失败：" + err, true);
      loadSettings();
    });
  };
}
$("display").onchange = (e) => invoke("set_setting", { name: "display", value: e.target.value }).then(loadSettings);
$("hatch").onclick = () => invoke("open_window", { name: "hatch" });
$("openDir").onclick = () => invoke("open_window", { name: "pets-dir" });

// ---------- live updates ----------
listen("ui-state", ({ payload }) => { ui = payload; renderUi(); });
listen("settings-changed", loadSettings);
listen("pet-installed", ({ payload }) => {
  thumbCache.delete(payload.key);
  toast(`${payload.replaced ? "更新" : "安装"}好了：${payload.displayName}`);
  loadPets();
});
listen("pet-install-failed", ({ payload }) => toast(`装不上${payload.file ? " " + payload.file : ""}：${payload.error}`, true));

// Highlight while files are dragged over the window (Rust installs on drop).
window.__TAURI__.webviewWindow.getCurrentWebviewWindow().onDragDropEvent(({ payload }) => {
  $("drop").classList.toggle("on", payload.type === "enter" || payload.type === "over");
});

(async () => {
  ui = { ...ui, ...(await invoke("ui_state").catch(() => ({}))) };
  if (!ui.pet) ui.pet = "builtin";
  await Promise.all([loadPets(), loadSettings()]);
})();
