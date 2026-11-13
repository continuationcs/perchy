# Coquou — 开源桌面宠物

可爱的小家伙在屏幕角落溜达，可以摸、拎、扔；兼容 Codex 宠物包，也能用 AI 孵化你自己的宠物。macOS / Windows，代码 MIT 开源。

> 曾用名 Perchy（应用标识 `io.perchy.desktop`）。新版本第一次启动时会把旧的宠物、设置和 AI 配置搬到 `io.github.coquou` 下，API key 在第一次用到时从旧的钥匙串条目搬过来。窗口里的偏好（当前宠物、大小、活动范围等）存在 WebView 里，改名后会恢复默认，重新选一次即可。

## 运行

```bash
cd src-tauri
cargo run
```

退出：菜单栏托盘图标 →「退出 Coquou」。

## 可以试的互动

| 操作 | 反应 |
|---|---|
| 鼠标经过宠物以外的透明区域 | 点击穿透到下层窗口 |
| 单击 | 开心跳一下、冒爱心；睡着时会被吓醒 |
| 按住拖动 | 被拎起来（惊讶脸，身体随拖动摆动） |
| 拖动后甩出去 | 带速度飞出，重力、撞墙反弹、落地压扁 |
| 鼠标在它身上来回蹭 | 被撸 → 脸红 + 爱心 |
| 鼠标靠近 | 眼睛跟着鼠标 |
| 一段时间没理它（默认 45 秒，可在主窗口「行为」里改） | 可能睡着（Zzz） |
| 托盘菜单 | 打开 Coquou / 换宠物 / 叫它回来 / 哄它睡觉 / 退出；其余设置都在主窗口里 |

## 主窗口

托盘「打开 Coquou」（Windows 上单击托盘图标；再次启动 Coquou 或在 macOS 访达里双击它也会打开；开发时 `cargo run -- --window`）：

| 页 | 内容 |
|---|---|
| 宠物 | 宠物库：搜索、按来源筛选（预设 / 我的 / Codex）、缩略图悬停时播放动画；右侧详情可预览各个动作，「让它上桌面」，调大小，导出 .pet，在访达 / 资源管理器中显示，删除自己安装的宠物。「导入」按钮或把 .pet / .zip 拖进窗口即安装 |
| 孵化 | AI 孵化：① AI 接口 → ② 描述宠物（可拖入参考图）→ ③ 形象 → ④ 动作 → ⑤ 安装，从上到下一页完成 |
| 行为 | 活动范围（图示四选一）、活跃程度、自动睡觉、大小 |
| 通用 | 显示器、全屏时自动隐藏、开机自启、用电池时省电、宠物文件夹和 Codex 宠物目录 |
| 关于与更新 | 版本、项目主页 / 反馈 / 发布记录链接、检查更新、更新说明、「更新并重启」、自动检查更新开关、授权 |

首次启动会打开主窗口并显示欢迎提示，宠物也会说一句 Coquou 住在哪里。托盘只保留常用操作：打开 Coquou、有新版本时的更新入口、换宠物、叫它回来、哄它睡觉、退出。macOS 上窗口打开时，应用菜单里有「设置…」（⌘,）。

宠物、大小、活动范围、活跃程度、睡觉时间由桌宠窗口保存（localStorage），主窗口和托盘只是发同样的指令、显示它上报的状态；
显示器、全屏隐藏、省电保存在 `<应用配置目录>/settings.json`；开机自启用系统机制（macOS LaunchAgent / Windows 注册表启动项）。

## 宠物

宠物包格式见 [docs/pet-format.md](docs/pet-format.md)：**Codex v2 宠物包 + 可选 `coquou.json` 扩展**。
启动时自动发现 `~/.codex/pets/` 下的 Codex 宠物、Coquou 自己的 pets 目录和随应用附带的预设宠物，在主窗口「宠物」页或托盘「换宠物」切换，选择会被记住。
首次启动时，有已安装的宠物（例如 Codex 宠物）就先用它，否则用看板娘栖栖。`cargo run -- --pet preset:qiqi` 可指定启动宠物。

### 预设宠物

| id | 名字 | 形象 |
|---|---|---|
| `qiqi` | 栖栖 | Q 版二次元少女，看板娘，头上停着一只小黄鸟 |
| `mianmian` | 棉棉 | 蓝眼睛的布偶猫 |

都是原创形象，用代码程序化绘制（[tools/presets/](tools/presets/)），渲染成标准 Codex v2 图集，另附 2× 高清图集（`coquou.json` 的 `hd`），所以既能在 Codex 里用，也能在 Coquou 里高清显示。
改了绘制代码后重新生成（需要本机装有 Chrome / Edge，用无头模式渲染）：

```bash
python3 tools/build-presets.py
```

输出到 `src-tauri/presets/<id>/`，随应用打包为资源；只读，不会被安装或覆盖。

分享用单文件 `.pet`（即 zip）。安装：拖到宠物身上、双击 `.pet`（需打包后的 .app），或 `cargo run -- my.pet`。

打包（本机 tauri-cli 过旧时用 npx）：

```bash
npx @tauri-apps/cli@2 build --debug --bundles app
```

## AI 孵化新宠物

主窗口「孵化」页（或「宠物」页的「孵化新宠物」）：填 AI 接口 → 写描述或把参考图拖进窗口 → 生成形象 → 生成全部动作 → 安装到桌面。在孵化页拖入一张图片会设为参考图，拖入 .pet / .zip 仍然是安装。

**接口**：用户自己填 API 地址、key、模型名，支持两种 OpenAI 协议（可接官方或兼容的中转）：

| 协议 | 请求 | 取图 |
|---|---|---|
| OpenAI Images | 无参考图 `POST {地址}/images/generations`（JSON）；有参考图 `POST {地址}/images/edits`（multipart，`image[]`），该路径 404/405 时（如 OpenRouter）自动改用 `POST {地址}/images` + `input_references` 并记住 | `data[0].b64_json` 或 `data[0].url` |
| OpenAI Chat 输出图片 | `POST {地址}/chat/completions`，`modalities: ["image","text"]`，参考图作 `image_url` data URL | `choices[0].message.images[].image_url.url`；兼容中转把图放在 `content` 里（图片段 / data URL / Markdown 链接） |

接口拒绝的可选参数（如 `gpt-image-2` 不支持透明背景）会自动去掉重试并关闭该选项；不发送 `n`。

API key 存系统钥匙串（服务名 `io.github.coquou.ai`），读到后在内存里缓存，一次运行最多访问一次钥匙串；列出配置时不读钥匙串。macOS 弹授权框时选「始终允许」；开发版每次重新编译签名都会变，会再问一次，正式签名的发布版不会，配置（不含 key）存 `<应用配置目录>/ai-profiles.json`。请求在 Rust 侧发出，key 不进 webview。

**流程**（`src/hatch-pipeline.js`）：

1. 形象：参考图或描述 → 一张标准形象（纯色抠像底：默认绿，角色偏绿时自动换品红）。
2. 每个动作生成一张网格图（8 帧 4×2、6/5 帧 3×2、4 帧 2×2），以标准形象为参考图；「向左走」由「向右走」镜像，不花调用。可选生成 16 个看向方向：先生成上右下左 4 个夸张的锚点姿势，再以锚点为参考生成两行 16 方向（共 3 次）。共 9–12 次调用。
3. 抠图：背景色距离给出硬边 alpha；混入背景色的像素（半透明发丝、纱裙、软边）按「抠像通道的超出量」估计混合比例并反混合还原颜色；轮廓附近再去一次溢色。选抠像底色时会排除参考图自己的背景。
4. 切帧与缩放：连通域按质心分到格子 → 所有行共用一个缩放比例（以待机行身高为准，站立身高 150 px，给举手、跳跃留空间）→ 统一地面线（跳跃超出格子时只压缩高度）→ 拼成 1536×2288 的 Codex v2 图集。
5. 自动检查：缺帧、多出姿势、碰到图片边缘、越出格子、背景不是纯色；每行可单独重新生成。
6. 可靠性：失败或帧数不够的行自动重试一次（API key 错误这类 4xx 不重试）；生成过程存盘在 `<应用数据目录>/hatch-run/`，关掉窗口或崩溃后再打开可「继续上次」，已生成的图不再收费，安装成功后自动清除。
7. 安装：走与 `.pet` 相同的校验，生成的宠物同时也是合法的 Codex 宠物。

**离线自测**（不花钱）：

```bash
python3 tools/mock-image-api.py 8765
```

```bash
cd src-tauri && cargo run -- --hatch-selftest http://127.0.0.1:8765/v1 images
```

把最后的 `images` 换成 `chat` 测另一种协议；末尾加 `persist` 额外验证存盘恢复（会清掉未完成的孵化）；模拟接口加 `--openrouter` 模拟 OpenRouter（没有 `/images/edits`）。日志里出现 `selftest PASS` 即全流程通过。质量指标（色边比例、各行身体宽度是否一致）：

```bash
python3 tools/analyze-atlas.py <宠物目录>/spritesheet.png
```

## 自动更新

从 GitHub Releases 自动检查新版本，发现后提示，点「更新并重启」才安装；更新包有签名校验。发版流程、密钥和本地测试见 [docs/releasing.md](docs/releasing.md)。

## 结构

```
src/                 前端（纯静态，无打包器）
  main.js            状态机、物理、命中检测、渲染循环
  cat.js             内置程序化形象「团团」
  sprite.js          Codex 图集 + coquou.json 扩展的精灵图渲染器
src-tauri/src/main.rs  覆盖工作区的透明窗口、托盘、cursor_local / set_passthrough
src-tauri/src/pets.rs  宠物发现（list_pets）与限定在宠物目录内的文件读取（read_pet_file）
src-tauri/src/install.rs  .pet / .zip / 目录的校验与安装
src-tauri/src/ai.rs     AI 接口配置、钥匙串、两种 OpenAI 协议调用
src-tauri/src/hatch_run.rs  未完成孵化的存盘与恢复
src/hatch.js / hatch-pipeline.js  主窗口孵化页的逻辑与图像流水线
src-tauri/src/migrate.rs  从旧名 Perchy（io.perchy.desktop）迁移数据
src/app.html / app.css / app.js  主窗口（宠物库、孵化入口、行为、通用、关于与更新）
src-tauri/src/settings.rs  应用级设置（显示器、全屏隐藏、省电、开机自启、自动检查更新）
src-tauri/src/update.rs    自动更新（检查、下载校验、安装重启）
tools/release.py          发版脚本（改版本号、打包、上传、签名、发布 latest.json）
tools/mock-image-api.py   离线测试用的模拟图像接口
tools/presets/            预设宠物的绘制代码（rig.js 动作系统 + characters.js 角色）
tools/build-presets.py    把预设渲染成 src-tauri/presets/ 下的宠物目录
tools/icons/              应用图标方案（icons.js；preview.html 对比各方案）
tools/build-icons.py      按选定方案生成全部应用图标和托盘图标
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
| 多显示器 | 主窗口「通用 → 显示器」选择；把宠物拖到另一块屏松手即搬过去；拔掉显示器回到主屏，插回来再回去 | 同左 |
| 不抢焦点 | 窗口不可聚焦，点宠物不会打断正在输入的应用 | 同左 |

## 已知局限

- AI 孵化在 macOS 上用真实模型（OpenRouter + gpt-image-2）跑通过一次；之后改进的抠图、统一缩放和看向方向只在模拟接口上验证过。
- Windows 真机已验证窗口、穿透和系统适配（W1–W8、S1–S6）；宠物包安装导出和 AI 孵化（P、A 两组）还没在真机测过。测试步骤见 [docs/testing-windows.md](docs/testing-windows.md)。
- 每帧一次 IPC 轮询光标，后续可改为 Rust 侧推送并在原生层直接做命中检测。

## 授权

- 代码：[MIT](LICENSE)
- 预设宠物素材（`src-tauri/presets/` 下的图片，以及生成它们的 `tools/presets/` 绘制代码所画出的形象）：[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，署名「Coquou contributors」
- 参与开发见 [CONTRIBUTING.md](CONTRIBUTING.md)
