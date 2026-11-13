# Coquou 宠物包格式 `coquou/1`

**原则：Coquou 宠物包 = Codex v2 宠物包 + 可选的 `coquou.json` 扩展。**

- 任何 Codex 宠物不做转换即可在 Coquou 中使用。
- 带扩展的 Coquou 宠物仍然是合法的 Codex 宠物（Codex 只读 `pet.json` + 主精灵图，忽略其余文件）。
- 扩展中缺失的状态自动降级到 Codex 标准动画。

## 目录结构

```
my-pet/
├── pet.json            必需 · Codex 原样
├── spritesheet.webp    必需 · Codex 原样
├── coquou.json         可选 · Coquou 扩展
└── extra/              可选 · 扩展用到的额外精灵图
    └── sleep.webp
```

宠物的标准形态是**目录**（与 Codex 一致，Codex 没有定义任何包扩展名）。

分享 / 下载用的单文件为 **`.pet`**：

- `.pet` 就是 zip，压缩包根目录即宠物目录的内容（`pet.json` 位于根部，不再嵌套一层文件夹）。
- 解压后得到的目录可直接放进 `~/.codex/pets/<id>/` 给 Codex 使用。
- Coquou 导入时同时接受 `.pet`、`.zip`（同样结构，或内含单个宠物目录）以及直接拖入的目录。
- 应用注册 `.pet` 文件关联，双击即导入。

安装方式：

| 方式 | 说明 |
|---|---|
| 拖到宠物身上 | 把 `.pet` / `.zip` / 文件夹拖到桌面宠物身上松手（只有宠物身上能接住拖放） |
| 双击 `.pet` | macOS 通过文件关联打开；Windows 第二次启动的参数会转给正在运行的实例 |
| 命令行 | `coquou my.pet other.zip` |
| 导入按钮 | 主窗口「宠物」页右上角「导入」，选 `.pet` / `.zip` |
| 拖进主窗口 | 把 `.pet` / `.zip` / 文件夹拖进主窗口 |
| 手动 | 主窗口「通用 → 宠物文件夹 → 打开」，把宠物目录放进去 |

安装到 Coquou 宠物目录下的 `<id>/`，同 id 覆盖更新。安装前校验（任一失败即拒绝并提示原因）：

- 压缩包内路径不得越界，跳过符号链接、`__MACOSX`、隐藏文件；
- 最多 256 个文件，单文件 ≤ 32 MB，总计 ≤ 96 MB（按实际解压大小计）；
- `id` 只能含字母、数字、`-`、`_`（≤ 64 字符）；
- 精灵图必须是 PNG/WebP 且尺寸符合 Codex v1/v2；
- `coquou.json` 必须是合法 JSON，引用的额外精灵图必须存在。

## 1. `pet.json`（Codex 兼容层）

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "One short sentence.",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

不要在 `pet.json` 中加自定义字段，扩展信息一律放 `coquou.json`，避免未来 Codex 校验变严时失效。

## 2. 主精灵图（Codex 图集）

| 版本 | 尺寸 | 网格 | 单元格 |
|---|---|---|---|
| v2 `spriteVersionNumber: 2` | 1536×2288 | 8 列 × 11 行 | 192×208 |
| v1（缺省） | 1536×1872 | 8 列 × 9 行 | 192×208 |

PNG 或 WebP，透明背景。行定义：

| 行 | 状态 | 帧数 | 帧时长 (ms) |
|---|---|---|---|
| 0 | `idle` | 6 | 280, 110, 110, 140, 140, 320 |
| 1 | `running-right` | 8 | 120 ×7, 220 |
| 2 | `running-left` | 8 | 120 ×7, 220 |
| 3 | `waving` | 4 | 140 ×3, 280 |
| 4 | `jumping` | 5 | 140 ×4, 280 |
| 5 | `failed` | 8 | 140 ×7, 240 |
| 6 | `waiting` | 6 | 150 ×5, 260 |
| 7 | `running`（干活中） | 6 | 120 ×5, 220 |
| 8 | `review` | 6 | 150 ×5, 280 |
| 9–10 | 16 个看向方向（仅 v2） | 8+8 | 0°=正上方，每格顺时针 22.5° |

来源：OpenAI `hatch-pet` skill（Apache-2.0）中的 Codex V2 Pet Contract。

## 3. `coquou.json`（扩展层）

应用改名前这个文件叫 `perchy.json`（`"format": "perchy/1"`），内容相同，现在仍然可以读；两个都有时以 `coquou.json` 为准。

```json
{
  "format": "coquou/1",
  "author": "作者名",
  "license": "CC-BY-4.0",
  "tags": ["猫", "像素风"],
  "scale": 0.6,
  "anchor": [96, 200],
  "hd": "spritesheet@2x.webp",
  "states": {
    "sleep": { "sheet": "extra/sleep.webp", "cell": [192, 208], "frames": 6, "fps": 3 },
    "held":  { "row": 6, "frames": 6, "durations": [150, 150, 150, 150, 150, 260] },
    "land":  { "sheet": "extra/land.webp", "frames": 3, "fps": 12, "loop": false }
  },
  "lines": { "click": ["干嘛~", "嘿！"] },
  "sounds": { "click": "extra/meow.ogg" }
}
```

| 字段 | 说明 | 缺省 |
|---|---|---|
| `format` | 固定 `coquou/1` | — |
| `author` / `license` / `tags` | 工坊元数据；发布到工坊时 `license` 必填 | — |
| `scale` | 屏幕显示缩放 | 自动：可见身体高约 120px |
| `anchor` | 脚底锚点（单元格像素坐标） | 自动：idle 首帧不透明区域的水平中心 + 最低行 |
| `hd` | 主图集的高清版（布局相同，宽高都是 2–4 的整数倍），Coquou 在高分屏上用它绘制；Codex 忽略，仍用主图集 | — |
| `states.<name>` | 新增或覆盖一个动画状态 | — |
| `lines` / `sounds` | 台词气泡 / 音效（**预留，尚未实现**） | — |

`states.<name>` 字段：

| 字段 | 说明 | 缺省 |
|---|---|---|
| `sheet` | 额外精灵图路径（宠物目录内）；省略则使用主图集 | 主图集 |
| `cell` | 单元格尺寸 | `[192, 208]` |
| `row` / `column` | 起始行 / 起始列 | `0` / `0` |
| `frames` | 帧数（同一行横向排列） | 图宽 ÷ 单元格宽 |
| `durations` 或 `fps` | 每帧时长数组，或统一帧率 | `fps: 8` |
| `loop` | 是否循环；`false` 则停在最后一帧 | `true` |

## 4. 运行时状态 → 动画（降级规则）

| Coquou 行为 | 优先使用扩展状态 | 降级到 Codex |
|---|---|---|
| 待机 | `idle`（可覆盖） | `idle` |
| 看鼠标 | — | 第 9–10 行（v1 无此行则保持 `idle`） |
| 走路 | — | `running-right` / `running-left` |
| 被拎起 | `held` | `waiting` |
| 上升 / 下落 | `rise` / `fall` | `jumping` 第 2 / 3 帧 |
| 落地 | `land` | `jumping` 第 4 帧 + 程序压扁 |
| 睡觉 | `sleep` | `idle` 第 0 帧 + Zzz 粒子 |
| 被单击 | `happy` | `waving` |
| 被撸 | `loved` | `waving` |
| （预留）Agent 状态联动 | — | `running` / `review` / `waiting` / `failed` |

## 5. 宠物搜索路径

| 来源 | 路径 | 说明 |
|---|---|---|
| `coquou` | macOS `~/Library/Application Support/io.github.coquou/pets/`，Windows `%APPDATA%\io.github.coquou\pets\` | Coquou 自己的宠物 |
| `codex` | `${CODEX_HOME:-~/.codex}/pets/` | 原地只读，不修改 Codex 目录 |

## 6. 安全约束

- 宠物包只含数据与图片/音频，**不允许脚本**。
- 运行时只能读取宠物目录内的文件：拒绝绝对路径、`..`、以及通过符号链接逃逸目录的路径。
- 工坊发布前校验：图集尺寸、`coquou.json` 字段合法性、`license` 必填、文件大小上限。
