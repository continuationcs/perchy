// App icon concepts for Coquou, as plain SVG strings (1024×1024 artboard).
// Each concept has a full-colour app icon and a monochrome tray glyph
// (drawn black on transparent; macOS uses it as a template image).

const SQ = `M 512 100 C 836 100 924 188 924 512 C 924 836 836 924 512 924 C 188 924 100 836 100 512 C 100 188 188 100 512 100 Z`;

function frame(id, [c0, c1], body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="${id}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient>
    <radialGradient id="${id}gloss" cx="0.3" cy="0.2" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <filter id="${id}sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity=".22"/></filter>
    <filter id="${id}soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#5a2a00" flood-opacity=".22"/></filter>
  </defs>
  <path d="${SQ}" fill="url(#${id}bg)" filter="url(#${id}sh)"/>
  <path d="${SQ}" fill="url(#${id}gloss)"/>
  <g filter="url(#${id}soft)">${body}</g>
</svg>`;
}

const EGG = "M512 236 C 690 236 772 470 772 612 C 772 772 660 846 512 846 C 364 846 252 772 252 612 C 252 470 334 236 512 236 Z";
const eye = (x, y, r = 30) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#2b1d14"/><circle cx="${x - r * 0.32}" cy="${y - r * 0.35}" r="${r * 0.34}" fill="#fff"/>`;
const cheek = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="34" ry="20" fill="#ff7d8e" opacity=".45"/>`;

const CONCEPTS = [
  {
    id: "egg",
    name: "A · 破壳蛋",
    note: "一枚正在裂开的蛋，裂缝里有一双眼睛往外看。最好认，小尺寸也清楚。",
    icon: frame("a", ["#ffc46b", "#ff8a3d"], `
      <defs><linearGradient id="aegg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#f1dcbc"/></linearGradient></defs>
      <path d="${EGG}" fill="url(#aegg)"/>
      <path d="M266 520 L330 462 L388 522 L452 452 L512 516 L574 450 L636 520 L700 460 L760 516" fill="none" stroke="#8a5528" stroke-width="22" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="M430 492 L452 452 L512 516 L574 450 L598 494 C 600 560 424 560 430 492 Z" fill="#3b2516"/>
      ${eye(482, 506, 16)}${eye(548, 504, 16)}
      <ellipse cx="420" cy="350" rx="44" ry="70" fill="#fff" opacity=".7" transform="rotate(-22 420 350)"/>`),
    tray: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 6 C 45 6 51 23 51 34 C 51 47 43 58 32 58 C 21 58 13 47 13 34 C 13 23 19 6 32 6 Z M15 32 L21 27 L26 33 L32 27 L38 33 L43 27 L49 32 L49 36 C 49 46 42 54 32 54 C 22 54 15 46 15 36 Z" fill="#000" fill-rule="evenodd"/></svg>`,
  },
  {
    id: "chick",
    name: "B · Q 版小鸡",
    note: "圆滚滚的小黄鸡，头顶一撮呆毛。最可爱，蓝底黄鸡对比强。",
    icon: frame("b", ["#9fdcff", "#4fa8f0"], `
      <defs><radialGradient id="bbody" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#fff3a8"/><stop offset=".55" stop-color="#ffd23f"/><stop offset="1" stop-color="#f3a51c"/></radialGradient></defs>
      <path d="M500 268 C 470 210 520 190 528 236 C 550 196 600 214 560 262" fill="none" stroke="#f3a51c" stroke-width="26" stroke-linecap="round"/>
      <circle cx="512" cy="560" r="290" fill="url(#bbody)"/>
      <path d="M760 600 C 820 560 830 640 770 680 Z" fill="#f6b72a"/>
      <path d="M264 600 C 204 560 194 640 254 680 Z" fill="#f6b72a"/>
      ${eye(422, 520, 36)}${eye(602, 520, 36)}
      <path d="M512 566 L558 602 L512 640 L466 602 Z" fill="#ff8a2a" stroke="#d9611b" stroke-width="8" stroke-linejoin="round"/>
      ${cheek(368, 616)}${cheek(656, 616)}`),
    tray: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M30 13 C 28 8 33 6 34 10 C 36 6 41 8 37 13" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round"/><path d="M32 13 C 47 13 56 23 56 36 C 56 49 46 58 32 58 C 18 58 8 49 8 36 C 8 23 17 13 32 13 Z M24 31 a3.5 3.5 0 1 0 0.01 0 Z M40 31 a3.5 3.5 0 1 0 0.01 0 Z M32 35 L37 39 L32 43 L27 39 Z" fill="#000" fill-rule="evenodd"/></svg>`,
  },
  {
    id: "perch",
    name: "C · 枝头小鸟",
    note: "一只小鸟停在树枝上，对应「栖息」的意象（产品曾叫 Perchy）。安静、有格调。",
    icon: frame("c", ["#7fe0c0", "#22a07f"], `
      <defs><radialGradient id="cbird" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e7eef0"/></radialGradient></defs>
      <path d="M170 720 C 340 650 600 640 860 700" fill="none" stroke="#6b4426" stroke-width="40" stroke-linecap="round"/>
      <path d="M690 676 C 740 600 820 600 840 640 C 790 650 740 666 690 676 Z" fill="#9be38a"/>
      <path d="M330 560 L210 600 L262 520 Z" fill="#cfd9dc"/>
      <ellipse cx="470" cy="540" rx="200" ry="170" fill="url(#cbird)"/>
      <circle cx="610" cy="410" r="120" fill="url(#cbird)"/>
      <path d="M720 404 L800 430 L720 452 Z" fill="#ffa52e" stroke="#d6781a" stroke-width="8" stroke-linejoin="round"/>
      ${eye(640, 392, 24)}
      <path d="M380 520 C 440 470 520 500 540 560 C 480 600 400 590 380 520 Z" fill="#d4dde0"/>
      <path d="M440 700 L430 650 M520 700 L520 650" stroke="#ff9d2e" stroke-width="18" stroke-linecap="round"/>
      ${cheek(650, 470)}`),
    tray: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M6 50 C 22 45 42 44 58 48" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round"/><path d="M39 12 C 46 12 50 17 50 22 L56 24 L50 27 C 49 35 44 42 34 44 C 24 46 16 42 13 37 L6 38 L11 31 C 12 25 19 22 27 22 C 28 16 33 12 39 12 Z M41 19 a2.6 2.6 0 1 0 0.01 0 Z" fill="#000" fill-rule="evenodd"/></svg>`,
  },
  {
    id: "shellchick",
    name: "D · 蛋壳小鸡",
    note: "刚破壳的小鸡，坐在半个蛋壳里，头顶顶着另一半。把「孵化」和「宠物」都讲出来了。",
    icon: frame("d", ["#ffd9b0", "#ff9b62"], `
      <defs>
        <radialGradient id="dhead" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#fff3a8"/><stop offset=".6" stop-color="#ffd23f"/><stop offset="1" stop-color="#f3a51c"/></radialGradient>
        <linearGradient id="dshell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#ead2ae"/></linearGradient>
      </defs>
      <circle cx="512" cy="520" r="220" fill="url(#dhead)"/>
      ${eye(440, 500, 30)}${eye(584, 500, 30)}
      <path d="M512 540 L550 568 L512 598 L474 568 Z" fill="#ff8a2a" stroke="#d9611b" stroke-width="8" stroke-linejoin="round"/>
      ${cheek(400, 580)}${cheek(624, 580)}
      <path d="M250 600 L310 560 L370 620 L440 556 L512 620 L584 556 L654 620 L714 560 L774 600 C 790 760 680 850 512 850 C 344 850 234 760 250 600 Z" fill="url(#dshell)"/>
      <path d="M340 300 C 360 200 480 160 560 190 C 640 220 690 290 680 330 L636 304 L596 350 L556 300 L510 344 L470 296 L424 340 L384 296 Z" fill="url(#dshell)" transform="rotate(-10 512 300)"/>`),
    tray: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M20 15 C 22 8 32 6 38 8 C 44 10 47 15 46 18 L43 16 L40 19 L37 16 L34 19 L31 16 L28 19 L25 16 Z" fill="#000" transform="rotate(-10 32 15)"/><path d="M32 18 C 41 18 47 24 47 32 L47 34 L15 34 L15 32 C 15 24 23 18 32 18 Z M26 27 a2.6 2.6 0 1 0 0.01 0 Z M38 27 a2.6 2.6 0 1 0 0.01 0 Z" fill="#000" fill-rule="evenodd"/><path d="M12 36 L17 33 L21 37 L26 33 L32 37 L38 33 L43 37 L47 33 L52 36 C 53 49 44 57 32 57 C 20 57 11 49 12 36 Z" fill="#000"/></svg>`,
  },
  {
    id: "pbird",
    name: "E · P 字小鸟",
    note: "字母 P 的圆肚子就是一只小鸟，偏品牌感、更现代，但「宠物」感弱一些。",
    icon: frame("e", ["#7b8cff", "#4a3fd8"], `
      <path d="M380 300 L380 780" stroke="#fff" stroke-width="110" stroke-linecap="round"/>
      <circle cx="540" cy="430" r="190" fill="#fff"/>
      <path d="M716 410 L800 436 L716 462 Z" fill="#ffb02e"/>
      ${eye(600, 400, 28)}
      <path d="M520 236 C 500 190 548 176 556 214" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round"/>
      ${cheek(612, 480)}`),
    tray: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M14 18 L14 54" stroke="#000" stroke-width="8" stroke-linecap="round"/><path d="M33 13 C 42 13 48 19 48 26 L56 28 L48 31 C 47 38 41 42 33 42 L18 42 L18 13 Z M37 22 a2.6 2.6 0 1 0 0.01 0 Z" fill="#000" fill-rule="evenodd"/></svg>`,
  },
];


// ---- 蛋壳小鸡 variants: both halves cut from one egg (matching zigzag and
// speckles); the top half never sits flat on the head, and a tuft shows. ----
function shellChick(id, o) {
  const cx = 512, top = o.top ?? 210, bot = o.bot ?? 860, rx = o.rx ?? 290;
  const egg = `M${cx} ${top} C ${cx + rx * 0.72} ${top} ${cx + rx} ${top + (bot - top) * 0.42} ${cx + rx} ${top + (bot - top) * 0.62} C ${cx + rx} ${bot - 70} ${cx + rx * 0.55} ${bot} ${cx} ${bot} C ${cx - rx * 0.55} ${bot} ${cx - rx} ${bot - 70} ${cx - rx} ${top + (bot - top) * 0.62} C ${cx - rx} ${top + (bot - top) * 0.42} ${cx - rx * 0.72} ${top} ${cx} ${top} Z`;
  const y = o.split, n = 8, w = rx * 2 + 80, x0 = cx - w / 2, amp = o.amp ?? 34;
  const zz = Array.from({ length: n + 1 }, (_, i) => `${x0 + (w * i) / n} ${y + (i % 2 ? -amp : amp) / 2}`);
  const below = `M${zz.join(" L")} L ${x0 + w} 1100 L ${x0} 1100 Z`;
  const above = `M${zz.join(" L")} L ${x0 + w} -100 L ${x0} -100 Z`;
  const speck = [[-.3, .14], [.25, .1], [.45, .3], [-.5, .62], [.45, .75], [-.15, .86], [.2, .55], [-.55, .38], [.05, .3]]
    .map(([u, v]) => [cx + u * rx, top + v * (bot - top)])
    .map(([a, b]) => `<ellipse cx="${a}" cy="${b}" rx="14" ry="10" fill="#e3c7a0" opacity=".75"/>`).join("");
  const shell = (clip) => `<g clip-path="url(#${id}${clip})"><path d="${egg}" fill="url(#${id}shell)"/>${speck}<path d="M${zz.join(" L")}" fill="none" stroke="#d9bb8f" stroke-width="12" stroke-linejoin="round"/></g>`;
  const h = o.head; // { x, y, r }
  const tx = h.x + (o.tuftX || 0);
  const tuft = `<path d="M${tx - 18} ${h.y - h.r + 12} C ${tx - 40} ${h.y - h.r - 50} ${tx + 10} ${h.y - h.r - 70} ${tx + 4} ${h.y - h.r - 20} M${tx + 6} ${h.y - h.r + 8} C ${tx + 30} ${h.y - h.r - 44} ${tx + 70} ${h.y - h.r - 30} ${tx + 40} ${h.y - h.r + 2}" fill="none" stroke="#f3a51c" stroke-width="20" stroke-linecap="round"/>`;
  const chick = `${o.tuft !== false ? tuft : ""}<circle cx="${h.x}" cy="${h.y}" r="${h.r}" fill="url(#${id}hd)"/>
    ${eye(h.x - h.r * 0.33, h.y - h.r * 0.05, h.r * 0.14)}${eye(h.x + h.r * 0.33, h.y - h.r * 0.05, h.r * 0.14)}
    <path d="M${h.x} ${h.y + h.r * 0.12} L${h.x + h.r * 0.17} ${h.y + h.r * 0.25} L${h.x} ${h.y + h.r * 0.38} L${h.x - h.r * 0.17} ${h.y + h.r * 0.25} Z" fill="#ff8a2a" stroke="#d9611b" stroke-width="7" stroke-linejoin="round"/>
    ${cheek(h.x - h.r * 0.52, h.y + h.r * 0.26)}${cheek(h.x + h.r * 0.52, h.y + h.r * 0.26)}`;
  const lid = `<g transform="${o.lid}">${shell("a")}</g>`;
  const body = `
    <defs>
      <radialGradient id="${id}hd" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#fff3a8"/><stop offset=".6" stop-color="#ffd23f"/><stop offset="1" stop-color="#f3a51c"/></radialGradient>
      <linearGradient id="${id}shell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#ecd6b4"/></linearGradient>
      <clipPath id="${id}b" clipPathUnits="userSpaceOnUse"><path d="${below}"/></clipPath>
      <clipPath id="${id}a" clipPathUnits="userSpaceOnUse"><path d="${above}"/></clipPath>
    </defs>
    ${o.lidBehind ? lid : ""}${chick}${shell("b")}${o.lidBehind ? "" : lid}${o.extra || ""}`;
  return frame(id, o.bg || ["#ffd9b0", "#ff9b62"], body);
}

const SHELL_TRAY = CONCEPTS_TRAY_D();
function CONCEPTS_TRAY_D() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M18 17 C 20 10 30 8 36 10 C 42 12 45 17 44 20 L41 18 L38 21 L35 18 L32 21 L29 18 L26 21 L23 18 Z" fill="#000" transform="rotate(-18 31 15) translate(-2 -4)"/><path d="M30 20 C 27 13 33 12 32 17" fill="none" stroke="#000" stroke-width="2.6" stroke-linecap="round"/><path d="M32 20 C 41 20 47 26 47 33 L47 35 L15 35 L15 33 C 15 26 23 20 32 20 Z M26 29 a2.6 2.6 0 1 0 0.01 0 Z M38 29 a2.6 2.6 0 1 0 0.01 0 Z" fill="#000" fill-rule="evenodd"/><path d="M12 37 L17 34 L21 38 L26 34 L32 38 L38 34 L43 38 L47 34 L52 37 C 53 50 44 58 32 58 C 20 58 11 50 12 37 Z" fill="#000"/></svg>`;
}

CONCEPTS.push(
  {
    id: "shell-big", name: "D1 · 大蛋壳",
    note: "下半壳又高又大，小鸡只露出脑袋；上半壳是同一枚蛋的顶，歪扣在头上一侧，另一侧露出呆毛。",
    icon: shellChick("d1", { top: 300, bot: 860, rx: 255, split: 540, head: { x: 500, y: 470, r: 165 }, tuftX: -70,
      lid: "translate(120 -120) rotate(26 512 420) scale(.9)" }),
    tray: SHELL_TRAY,
  },
  {
    id: "shell-small", name: "D2 · 小蛋壳 · 掀盖",
    note: "下半壳矮，小鸡露出大半个身子；上半壳像盖子一样往后掀开，靠在脑袋后面。",
    icon: shellChick("d2", { top: 330, bot: 860, rx: 250, split: 650, head: { x: 512, y: 520, r: 190 },
      lid: "translate(-40 10) rotate(-38 512 650) scale(.72)", lidBehind: true }),
    tray: SHELL_TRAY,
  },
  {
    id: "shell-float", name: "D3 · 悬空壳盖",
    note: "上半壳刚弹开、悬在头顶，锯齿和下半壳正好对上；中间露出呆毛。",
    icon: shellChick("d3", { top: 330, bot: 860, rx: 250, split: 570, head: { x: 512, y: 525, r: 152 },
      lid: "translate(10 -215) rotate(-7 512 450)",
      extra: `<path d="M318 330 l-34 -18 M706 330 l34 -18" stroke="#fff" stroke-width="16" stroke-linecap="round" opacity=".9"/>` }),
    tray: SHELL_TRAY,
  },
  {
    id: "shell-tilt", name: "D4 · 斜戴壳帽",
    note: "上半壳小一号，像帽子一样歪戴在一侧；另一侧呆毛翘着，更俏皮。",
    icon: shellChick("d4", { top: 320, bot: 860, rx: 255, split: 590, head: { x: 500, y: 500, r: 185 }, tuftX: -60,
      lid: "translate(150 -130) rotate(28 512 450) scale(.72)" }),
    tray: SHELL_TRAY,
  },
  {
    id: "shell-peek", name: "D5 · 探头",
    note: "整枚蛋还在，只裂开一道口；小鸡顶着壳盖探出眼睛，最像「刚破壳」的那一刻。",
    icon: shellChick("d5", { top: 270, bot: 870, rx: 270, split: 510, head: { x: 512, y: 478, r: 150 },
      lid: "translate(40 -120) rotate(-16 512 390)", tuft: false }),
    tray: SHELL_TRAY,
  },
);

// ---- Final icon: the colour version of the tray glyph (chick in a big
// eggshell, a little lid perched on its tuft). ----
CONCEPTS.push({
  id: "final",
  name: "正式图标",
  note: "菜单栏单色图标的彩色版：小鸡坐在大蛋壳里，呆毛顶着一片歪戴的小壳盖。",
  icon: frame("f", ["#ffd6a8", "#ff935a"], `
    <defs>
      <radialGradient id="fhd" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#fff3a8"/><stop offset=".6" stop-color="#ffd23f"/><stop offset="1" stop-color="#f0a01a"/></radialGradient>
      <linearGradient id="fshell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#ead2ae"/></linearGradient>
    </defs>
    <path d="M498 340 C 466 276 520 232 548 282" fill="none" stroke="#f0a01a" stroke-width="24" stroke-linecap="round"/>
    <circle cx="512" cy="540" r="205" fill="url(#fhd)"/>
    ${eye(438, 506, 31)}${eye(586, 506, 31)}
    <path d="M512 538 L548 562 L512 586 L476 562 Z" fill="#ff8a2a" stroke="#d9611b" stroke-width="7" stroke-linejoin="round"/>
    ${cheek(392, 560)}${cheek(632, 560)}
    <g>
      <path d="M226 600 L288 552 L348 610 L410 552 L470 610 L512 560 L554 610 L614 552 L676 610 L736 552 L798 600 C 806 772 684 866 512 866 C 340 866 218 772 226 600 Z" fill="url(#fshell)"/>
      <path d="M226 600 L288 552 L348 610 L410 552 L470 610 L512 560 L554 610 L614 552 L676 610 L736 552 L798 600" fill="none" stroke="#d9bb8f" stroke-width="12" stroke-linejoin="round"/>
      <ellipse cx="330" cy="700" rx="15" ry="11" fill="#e3c7a0" opacity=".75"/><ellipse cx="460" cy="780" rx="13" ry="10" fill="#e3c7a0" opacity=".75"/>
      <ellipse cx="640" cy="720" rx="15" ry="11" fill="#e3c7a0" opacity=".75"/><ellipse cx="560" cy="660" rx="11" ry="8" fill="#e3c7a0" opacity=".75"/>
      <ellipse cx="720" cy="660" rx="10" ry="8" fill="#e3c7a0" opacity=".75"/>
    </g>
    <g transform="rotate(22 590 250)">
      <path d="M468 306 C 468 200 540 148 592 148 C 644 148 716 200 716 306 L686 284 L656 310 L624 284 L592 310 L560 284 L528 310 L498 284 Z" fill="url(#fshell)"/>
      <path d="M716 306 L686 284 L656 310 L624 284 L592 310 L560 284 L528 310 L498 284 L468 306" fill="none" stroke="#d9bb8f" stroke-width="10" stroke-linejoin="round"/>
      <ellipse cx="560" cy="200" rx="12" ry="9" fill="#e3c7a0" opacity=".75"/><ellipse cx="640" cy="236" rx="13" ry="10" fill="#e3c7a0" opacity=".75"/>
      <ellipse cx="520" cy="250" rx="9" ry="7" fill="#e3c7a0" opacity=".75"/>
    </g>`),
  tray: SHELL_TRAY,
});

// ---- Closer to the tray glyph: low dome head (eyes right at the rim),
// the lid perched like a little umbrella on the tuft. ----
CONCEPTS.push({
  id: "final2",
  name: "正式图标 · 贴近单色版",
  note: "完全照单色剪影来：脑袋只露出半圆和眼睛，呆毛像伞柄撑着小壳盖。",
  icon: frame("g", ["#ffd6a8", "#ff935a"], `
    <defs>
      <radialGradient id="ghd" cx=".4" cy=".3" r=".85"><stop offset="0" stop-color="#fff3a8"/><stop offset=".6" stop-color="#ffd23f"/><stop offset="1" stop-color="#f0a01a"/></radialGradient>
      <linearGradient id="gshell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#ead2ae"/></linearGradient>
    </defs>
    <path d="M512 400 C 498 350 512 312 548 296" fill="none" stroke="#f0a01a" stroke-width="22" stroke-linecap="round"/>
    <ellipse cx="512" cy="600" rx="250" ry="210" fill="url(#ghd)"/>
    ${eye(430, 548, 34)}${eye(594, 548, 34)}
    ${cheek(372, 594)}${cheek(652, 594)}
    <path d="M220 610 L280 566 L340 622 L404 566 L466 622 L512 576 L558 622 L620 566 L684 622 L744 566 L804 610 C 812 780 690 872 512 872 C 334 872 212 780 220 610 Z" fill="url(#gshell)"/>
    <path d="M220 610 L280 566 L340 622 L404 566 L466 622 L512 576 L558 622 L620 566 L684 622 L744 566 L804 610" fill="none" stroke="#d9bb8f" stroke-width="12" stroke-linejoin="round"/>
    <ellipse cx="330" cy="716" rx="15" ry="11" fill="#e3c7a0" opacity=".75"/><ellipse cx="470" cy="800" rx="13" ry="10" fill="#e3c7a0" opacity=".75"/>
    <ellipse cx="650" cy="736" rx="15" ry="11" fill="#e3c7a0" opacity=".75"/><ellipse cx="740" cy="670" rx="10" ry="8" fill="#e3c7a0" opacity=".75"/>
    <g transform="rotate(20 566 236)">
      <path d="M436 306 C 436 196 508 140 566 140 C 624 140 696 196 696 306 L664 284 L632 310 L598 284 L566 310 L534 284 L500 310 L468 284 Z" fill="url(#gshell)"/>
      <path d="M696 306 L664 284 L632 310 L598 284 L566 310 L534 284 L500 310 L468 284 L436 306" fill="none" stroke="#d9bb8f" stroke-width="10" stroke-linejoin="round"/>
      <ellipse cx="530" cy="196" rx="12" ry="9" fill="#e3c7a0" opacity=".75"/><ellipse cx="616" cy="232" rx="13" ry="10" fill="#e3c7a0" opacity=".75"/>
    </g>`),
  tray: SHELL_TRAY,
});

// ---- The tray glyph, coloured: same paths scaled ×13 around the centre,
// each part filled on its own. ----
CONCEPTS.push({
  id: "final3",
  name: "正式图标 · 单色版上色",
  note: "直接用菜单栏单色图的路径放大上色：形状、位置、角度和单色版完全一致。",
  icon: frame("h", ["#ffd6a8", "#ff935a"], `
    <defs>
      <radialGradient id="hhd" cx=".4" cy=".25" r=".9"><stop offset="0" stop-color="#fff3a8"/><stop offset=".6" stop-color="#ffd23f"/><stop offset="1" stop-color="#f0a01a"/></radialGradient>
      <linearGradient id="hshell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#e8cfa8"/></linearGradient>
    </defs>
    <g transform="translate(512 506) scale(13) translate(-32 -32)">
      <path d="M15 33.5 L47 33.5 L47 39 L15 39 Z" fill="#a8774c"/>
      <path d="M30 20 C 27 13 33 12 32 17" fill="none" stroke="#f0a01a" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M32 20 C 41 20 47 26 47 33 L47 35 L15 35 L15 33 C 15 26 23 20 32 20 Z" fill="url(#hhd)"/>
      <circle cx="26" cy="30.9" r="2.7" fill="#2b1d14"/><circle cx="25.1" cy="29.9" r=".9" fill="#fff"/>
      <circle cx="38" cy="30.9" r="2.7" fill="#2b1d14"/><circle cx="37.1" cy="29.9" r=".9" fill="#fff"/>
      <path d="M12 37 L17 34 L21 38 L26 34 L32 38 L38 34 L43 38 L47 34 L52 37 C 53 50 44 58 32 58 C 20 58 11 50 12 37 Z" fill="url(#hshell)"/>
      <path d="M12 37 L17 34 L21 38 L26 34 L32 38 L38 34 L43 38 L47 34 L52 37" fill="none" stroke="#d6b68a" stroke-width=".8" stroke-linejoin="round"/>
      <ellipse cx="20" cy="45" rx="1.1" ry=".8" fill="#e0c39a"/><ellipse cx="29" cy="52" rx="1" ry=".75" fill="#e0c39a"/>
      <ellipse cx="42" cy="47" rx="1.1" ry=".8" fill="#e0c39a"/><ellipse cx="36" cy="42" rx=".8" ry=".6" fill="#e0c39a"/>
      <g transform="rotate(-18 31 15) translate(-2 -4)">
        <path d="M18 17 C 20 10 30 8 36 10 C 42 12 45 17 44 20 L41 18 L38 21 L35 18 L32 21 L29 18 L26 21 L23 18 Z" fill="url(#hshell)"/>
        <path d="M44 20 L41 18 L38 21 L35 18 L32 21 L29 18 L26 21 L23 18 L18 17" fill="none" stroke="#d6b68a" stroke-width=".8" stroke-linejoin="round"/>
        <ellipse cx="27" cy="13" rx=".9" ry=".7" fill="#e0c39a"/><ellipse cx="36" cy="14" rx="1" ry=".75" fill="#e0c39a"/>
      </g>
    </g>`),
  tray: SHELL_TRAY,
});

if (typeof module !== "undefined") module.exports = CONCEPTS;
else window.ICONS = CONCEPTS;
