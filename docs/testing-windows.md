# Windows 测试清单

Perchy 目前只在 macOS 上实际运行过，Windows 只做过交叉编译类型检查。以下功能在 Windows 上走的是另一套代码，需要在真机上逐项验证。

## 1. 环境准备

| 需要 | 说明 |
|---|---|
| Windows 10 / 11 | WebView2 运行时 Win11 自带；Win10 若没有，到微软官网装 Evergreen 版 |
| Visual Studio Build Tools | 勾选「使用 C++ 的桌面开发」（提供 MSVC 编译器和 Windows SDK） |
| Rust | <https://rustup.rs>，默认工具链 `stable-x86_64-pc-windows-msvc` |
| Node.js | 只用来通过 `npx` 调用 Tauri CLI 打包 |
| Python 3 | 只在跑离线自测时需要；Windows 上命令一般是 `py` |
| Git + GitHub 访问权限 | 仓库是私有的，需要能拉取 `continuationcs/perchy` |

```powershell
git clone https://github.com/continuationcs/perchy.git
```

## 2. 构建与运行

开发运行（debug 版会带一个控制台窗口，日志都打印在里面，测试时用这个）：

```powershell
cd perchy\src-tauri
cargo run
```

单元测试：

```powershell
cargo test
```

打安装包（文件关联只在安装后生效）：

```powershell
npx @tauri-apps/cli@2 build --debug --bundles nsis
```

安装包在 `src-tauri\target\debug\bundle\nsis\`。

退出：托盘图标（任务栏右下角，可能在「^」折叠区里）→「退出 Perchy」。

## 3. 数据位置

| 内容 | 位置 |
|---|---|
| Perchy 宠物 | `%APPDATA%\io.perchy.desktop\pets\` |
| Codex 宠物（只读） | `%USERPROFILE%\.codex\pets\` 或 `%CODEX_HOME%\pets\` |
| AI 配置（不含 key） | `%APPDATA%\io.perchy.desktop\ai-profiles.json` |
| API key | 凭据管理器 →「Windows 凭据」，服务名 `io.perchy.desktop.ai` |
| 未完成的孵化 | `%APPDATA%\io.perchy.desktop\hatch-run\` |
| 显示器选择 | `%APPDATA%\io.perchy.desktop\settings.json` |

## 4. 测试项

每项记下「通过 / 不通过 + 现象」。不通过时把控制台日志一起贴回来。

### 窗口与穿透

| # | 操作 | 预期 |
|---|---|---|
| W1 | 启动 | 宠物从上方掉到**任务栏上方**，背景完全透明，没有黑框、白框或窗口阴影 |
| W2 | 在宠物以外的地方点击、拖动、滚动其他窗口 | 全部正常作用到下层窗口，像宠物不存在一样 |
| W3 | 点宠物 | 宠物有反应（跳、冒爱心）；**正在输入的应用不丢焦点**（例如记事本里继续打字） |
| W4 | 拖起宠物再甩出去 | 跟手；松手后有速度、重力、撞墙反弹 |
| W5 | 鼠标在宠物身上来回蹭 | 脸红 + 爱心 |
| W6 | 任务栏 | 没有 Perchy 的任务栏按钮，只有托盘图标 |
| W7 | 任务栏放在左/右/上，或设成自动隐藏 | 宠物始终站在可用区域底边上，不被任务栏挡住 |
| W8 | 系统缩放 125% / 150% | 宠物清晰不模糊；点击位置准确（能点中，不会点到旁边） |

### 系统适配

| # | 操作 | 预期 |
|---|---|---|
| S1 | 全屏看视频（浏览器 F11 或播放器全屏）、全屏游戏、PPT 放映 | 1 秒内宠物隐藏；退出全屏后重新出现 |
| S2 | 拔掉电源（笔记本） | 30 秒内控制台出现 `power source: battery → 30 fps` |
| S3 | 多显示器：托盘「显示器」切换 | 宠物移到选中的显示器；重启后还在那块 |
| S4 | 多显示器：把宠物拖到另一块屏幕松手 | 宠物搬到那块屏幕 |
| S5 | 多显示器：拔掉宠物所在的显示器 | 回到主显示器；插回后自动回去 |
| S6 | 托盘「活动范围」「大小」 | 生效，当前项打勾；重启后保持 |

### 宠物包

| # | 操作 | 预期 |
|---|---|---|
| P1 | 托盘「打开宠物文件夹」 | 资源管理器打开 `%APPDATA%\io.perchy.desktop\pets\` |
| P2 | 把 `.pet` 文件拖到宠物身上 | 宠物张嘴；松手后安装成功，气泡提示，宠物切换 |
| P3 | 用安装包装好后，双击 `.pet` 文件（Perchy 未运行） | Perchy 启动并安装该宠物 |
| P4 | Perchy 运行中再双击另一个 `.pet` | 不会开第二个 Perchy；正在运行的那个装上新宠物 |
| P5 | 托盘「导出当前宠物为 .pet」 | 文件出现在「下载」文件夹，资源管理器打开并选中它 |
| P6 | 有 Codex 宠物时（`%USERPROFILE%\.codex\pets\`） | 托盘「换宠物」里列出，标「· Codex」 |

### AI 孵化

| # | 操作 | 预期 |
|---|---|---|
| A1 | 托盘「孵化新宠物（AI）…」 | 打开孵化窗口，能正常输入、粘贴（Ctrl+V） |
| A2 | 新建配置、保存 key | 凭据管理器里出现 `io.perchy.desktop.ai`；不会反复弹授权 |
| A3 | 把参考图拖进孵化窗口 | 显示预览（Windows 上 HTML 拖放与 macOS 走不同路径） |
| A4 | 离线自测（不花钱，见下） | 控制台出现 `selftest PASS` |
| A5 | 真实孵化一只 | 全流程完成并安装 |
| A6 | 孵化到一半关掉窗口，重新打开 | 提示「继续上次」，能接着完成 |

离线自测（两个 PowerShell 窗口）：

```powershell
py tools\mock-image-api.py 8765
```

```powershell
cd src-tauri
cargo run -- --hatch-selftest http://127.0.0.1:8765/v1 images persist
```

把 `images` 换成 `chat` 再跑一遍。注意 `persist` 会清掉未完成的孵化。

## 5. 已知的 Windows 风险点

按可能出问题的程度排序，测试时多留意：

1. **按像素穿透点击**（W2/W3）：靠前端每帧查询光标后切换窗口的鼠标穿透；Windows 上切换的延迟、以及窗口不可聚焦对点击的影响都没验证过。
2. **高 DPI**（W8）：光标坐标和窗口坐标的换算在不同缩放下可能偏移。
3. **全屏检测**（S1）：用的是系统「勿扰」判定，部分无边框窗口化全屏的游戏可能检测不到。
4. **文件关联与单实例**（P3/P4）：只在安装包安装后生效，`cargo run` 下测不了。
