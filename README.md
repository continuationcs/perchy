# Perchy 栖栖 — PoC

桌面宠物运行器的技术验证：透明置顶全屏窗口 + 像素级点击穿透 + 状态机与物理。

## 运行

```bash
cd src-tauri
cargo run
```

退出：菜单栏托盘图标 →「退出 Perchy」。

## 可以试的互动

| 操作 | 反应 |
|---|---|
| 鼠标经过宠物以外的透明区域 | 点击穿透到下层窗口 |
| 单击 | 开心跳一下、冒爱心；睡着时会被吓醒 |
| 按住拖动 | 被拎起来（惊讶脸，身体随拖动摆动） |
| 拖动后甩出去 | 带速度飞出，重力、撞墙反弹、落地压扁 |
| 鼠标在它身上来回蹭 | 被撸 → 脸红 + 爱心 |
| 鼠标靠近 | 眼睛跟着鼠标 |
| 45 秒没理它 | 可能睡着（Zzz） |
| 托盘菜单 | 把它叫回来 / 哄它睡觉 / 大小（小～超大，按宠物记住） |

## 宠物

宠物包格式见 [docs/pet-format.md](docs/pet-format.md)：**Codex v2 宠物包 + 可选 `perchy.json` 扩展**。
启动时自动发现 `~/.codex/pets/` 下的 Codex 宠物和 Perchy 自己的 pets 目录，托盘「换宠物」切换，选择会被记住。

分享用单文件 `.pet`（即 zip）。安装：拖到宠物身上、双击 `.pet`（需打包后的 .app），或 `cargo run -- my.pet`。

打包（本机 tauri-cli 过旧时用 npx）：

```bash
npx @tauri-apps/cli@2 build --debug --bundles app
```

## AI 孵化新宠物

托盘「孵化新宠物（AI）…」打开孵化窗口：填 AI 接口 → 写描述或给一张参考图 → ① 生成形象 → ② 生成全部动作 → ③ 安装到桌面。

**接口**：用户自己填 API 地址、key、模型名，支持两种 OpenAI 协议（可接官方或兼容的中转）：

| 协议 | 请求 | 取图 |
|---|---|---|
| OpenAI Images | 无参考图 `POST {地址}/images/generations`（JSON）；有参考图 `POST {地址}/images/edits`（multipart，`image[]`），该路径 404/405 时（如 OpenRouter）自动改用 `POST {地址}/images` + `input_references` 并记住 | `data[0].b64_json` 或 `data[0].url` |
| OpenAI Chat 输出图片 | `POST {地址}/chat/completions`，`modalities: ["image","text"]`，参考图作 `image_url` data URL | `choices[0].message.images[].image_url.url`；兼容中转把图放在 `content` 里（图片段 / data URL / Markdown 链接） |

接口拒绝的可选参数（如 `gpt-image-2` 不支持透明背景）会自动去掉重试并关闭该选项；不发送 `n`。

API key 存系统钥匙串（服务名 `io.perchy.desktop.ai`），配置（不含 key）存 `<应用配置目录>/ai-profiles.json`。请求在 Rust 侧发出，key 不进 webview。

**流程**（`src/hatch-pipeline.js`）：

1. 形象：参考图或描述 → 一张标准形象（纯色抠像底：默认绿，角色偏绿时自动换品红）。
2. 每个动作生成一张网格图（8 帧 4×2、6/5 帧 3×2、4 帧 2×2），以标准形象为参考图；「向左走」由「向右走」镜像，不花调用。可选生成 16 个看向方向：先生成上右下左 4 个夸张的锚点姿势，再以锚点为参考生成两行 16 方向（共 3 次）。共 9–12 次调用。
3. 抠图：背景色距离给出硬边 alpha；混入背景色的像素（半透明发丝、纱裙、软边）按「抠像通道的超出量」估计混合比例并反混合还原颜色；轮廓附近再去一次溢色。选抠像底色时会排除参考图自己的背景。
4. 切帧与缩放：连通域按质心分到格子 → 所有行共用一个缩放比例（以待机行身高为准，站立身高 150 px，给举手、跳跃留空间）→ 统一地面线（跳跃超出格子时只压缩高度）→ 拼成 1536×2288 的 Codex v2 图集。
5. 自动检查：缺帧、多出姿势、碰到图片边缘、越出格子、背景不是纯色；每行可单独重新生成。
6. 安装：走与 `.pet` 相同的校验，生成的宠物同时也是合法的 Codex 宠物。

**离线自测**（不花钱）：

```bash
python3 tools/mock-image-api.py 8765
```

```bash
cd src-tauri && cargo run -- --hatch-selftest http://127.0.0.1:8765/v1 images
```

把最后的 `images` 换成 `chat` 测另一种协议；模拟接口加 `--openrouter` 模拟 OpenRouter（没有 `/images/edits`）。日志里出现 `selftest PASS` 即全流程通过。质量指标（色边比例、各行身体宽度是否一致）：

```bash
python3 tools/analyze-atlas.py <宠物目录>/spritesheet.png
```

## 结构

```
src/                 前端（纯静态，无打包器）
  main.js            状态机、物理、命中检测、渲染循环
  cat.js             内置程序化形象「团子猫」
  sprite.js          Codex 图集 + perchy.json 扩展的精灵图渲染器
src-tauri/src/main.rs  覆盖工作区的透明窗口、托盘、cursor_local / set_passthrough
src-tauri/src/pets.rs  宠物发现（list_pets）与限定在宠物目录内的文件读取（read_pet_file）
src-tauri/src/install.rs  .pet / .zip / 目录的校验与安装
src-tauri/src/ai.rs     AI 接口配置、钥匙串、两种 OpenAI 协议调用
src/hatch.html / hatch.js / hatch-pipeline.js  孵化窗口与图像流水线
tools/mock-image-api.py   离线测试用的模拟图像接口
```

## 点击穿透原理

窗口默认 `ignore_cursor_events = true`（收不到任何鼠标事件），前端每帧通过
`cursor_local` 拿到光标位置，在宠物精灵缓冲里读该点 alpha：不透明 → 关闭穿透接管鼠标，
透明 → 打开穿透。拖拽期间保持接管。

## 系统适配

| 能力 | macOS | Windows |
|---|---|---|
| 全屏应用时自动隐藏 | 前台普通窗口盖满所在显示器（含菜单栏）即判定全屏；不需要录屏权限 | `SHQueryUserNotificationState`（全屏、D3D 独占、演示模式） |
| 电池供电降到 30 fps | IOKit `IOPSGetProvidingPowerSourceType` | `GetSystemPowerStatus` |
| 多显示器 | 托盘「显示器」选择；把宠物拖到另一块屏松手即搬过去；拔掉显示器回到主屏，插回来再回去 | 同左 |
| 不抢焦点 | 窗口不可聚焦，点宠物不会打断正在输入的应用 | 同左 |

## 已知局限

- AI 孵化只用模拟接口跑通过全流程，未用真实模型测过；真实模型的网格排布、抠图质量需要实测调整提示词。
- Windows 只做过交叉编译类型检查（`cargo check --target x86_64-pc-windows-msvc`），未在真机运行。
- 跨屏拖拽、多显示器、不抢焦点后的点击/拖拽手感未实测（本机单屏、无法模拟鼠标）。
- 每帧一次 IPC 轮询光标，后续可改为 Rust 侧推送并在原生层直接做命中检测。
