# 参与贡献

欢迎提 issue 和 PR！

## 开发环境

- Rust（stable）与 Node.js（只用来通过 `npx` 调用 Tauri CLI 打包）
- macOS 或 Windows

```bash
cd src-tauri
cargo run
```

打包：

```bash
npx @tauri-apps/cli@2 build --debug --bundles app
```

## 提交前请确认

```bash
cd src-tauri && cargo test
```

改了 AI 孵化相关代码时，再跑一遍离线自测（不需要 API key，不花钱）：

```bash
python3 tools/mock-image-api.py 8765
```

```bash
cd src-tauri && cargo run -- --hatch-selftest http://127.0.0.1:8765/v1 images
```

日志里出现 `selftest PASS` 即通过。详见 README「离线自测」。

## 约定

- 前端是纯静态文件（`src/`），没有打包器；保持零依赖。
- 宠物包格式改动要同步更新 [docs/pet-format.md](docs/pet-format.md)，并保持与 Codex 宠物包兼容。
- 宠物包只能包含数据和图片/音频，不接受任何形式的脚本。

## 授权

- 提交的代码以 [MIT](LICENSE) 授权。
- 提交的宠物素材（预设宠物的图片、音效）以 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 授权，请确认你有权以此协议发布；不接受未经授权的他人角色或作品。
