# 发版与自动更新

Perchy 用 Tauri 官方的 `tauri-plugin-updater` 自动更新：

- 应用启动 20 秒后检查一次，之后每 6 小时检查一次（设置 → 关于与更新 →「自动检查更新」可关）。
- 检查地址：`https://github.com/continuationcs/perchy/releases/latest/download/latest.json`，即 GitHub 上最新一个正式 Release 里的 `latest.json`。
- 发现新版本时，宠物冒气泡提示，托盘第一项变成「有新版本 x.y.z，查看更新…」，设置窗口显示更新说明。用户点「更新并重启」才会安装，**不会静默安装**。
- 下载的更新包要用 `tauri.conf.json` 里的公钥验签，签名不对就拒绝安装。

## 密钥

| 文件 | 说明 |
|---|---|
| `~/.tauri/perchy-updater.key` | **更新签名私钥**，只在发版用的 Mac 上，不进仓库。**一定要备份**：丢了它，已经装好的 Perchy 就再也收不到更新（只能让用户手动重装带新公钥的版本） |
| `~/.tauri/perchy-updater.key.pub` | 公钥，已写进 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` |

私钥目前没有密码。也可以设一个密码（`npx @tauri-apps/cli@2 signer generate -w <路径> -p <密码>` 重新生成，同时更新公钥），发版时通过 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 传入。

## 发版步骤

前提：Mac 上有私钥；两台机器都装好 GitHub CLI（`gh`），并能写 `continuationcs/perchy`。上传和发布命令用对应账号的令牌运行，例如：

```bash
export GH_TOKEN=$(gh auth token -u continuationcs)
```

1. **Mac：改版本号**，提交并推送。

   ```bash
   python3 tools/release.py bump 0.1.1
   git commit -am "Release 0.1.1" && git push
   ```

2. **Mac：打包并上传。** 产物是 macOS 更新包（`.app.tar.gz` 和签名）和首次安装用的 DMG。上传后先是草稿 Release，用户还看不到。

   ```bash
   python3 tools/release.py build            # 加 --universal 同时支持 Intel Mac
   python3 tools/release.py upload --notes-file notes.md
   ```

3. **Windows：拉取、打包、上传 NSIS 安装包。** 不需要私钥。

   ```powershell
   git pull
   py tools\release.py build
   py tools\release.py upload
   ```

4. **Mac：签名并发布。** 给还没签名的安装包（Windows 的 setup.exe）签名，生成 `latest.json`，再把草稿改成正式的最新 Release。缺某个平台时默认不发布，确认只发部分平台时加 `--force`。

   ```bash
   python3 tools/release.py publish
   ```

产物都在 `dist/<版本号>/`（不进仓库）。更新说明来自 Release 正文（`--notes` / `--notes-file`），会显示在用户的设置窗口里。

## macOS：让钥匙串在更新后不再弹框

AI 接口的 key 存在钥匙串里。没有固定签名身份时，每次更新后应用的签名都会变，macOS 会把它当成别的应用，读 key 时又弹一次授权框。用一个固定的自签名证书签名就能解决（免费；也不需要 Apple 开发者账号）：

1. 打开「钥匙串访问」→ 菜单「钥匙串访问」→「证书助理」→「创建证书…」。
2. 名称填 `Perchy Self-Signed`，身份类型「自签名根证书」，证书类型选「**代码签名**」，创建。
3. 发版前设置环境变量，`release.py build` 会用它给应用签名：

   ```bash
   export PERCHY_SIGN_IDENTITY="Perchy Self-Signed"
   ```

这个证书只解决钥匙串问题。首次安装时 Gatekeeper 仍会拦（要右键 →「打开」）；要彻底解决，需要 Apple 开发者账号签名并公证。

## Windows 注意事项

- 没有代码签名证书时，首次安装会弹 SmartScreen「Windows 已保护你的电脑」，要点「更多信息 →仍要运行」。之后的自动更新走应用内安装（`installMode: passive`，只显示进度条）。
- 安装包是按当前用户安装的 NSIS，不需要管理员权限。

## 本地测试更新流程

不用发 Release，也能在本机模拟一次完整更新（只在调试版可用：允许 http 地址，并能自动安装）：

```bash
cd src-tauri
# 1) 打一个 0.1.0 调试包，复制到别处当「已安装」的版本
npx @tauri-apps/cli@2 build --debug --bundles app
cp -R target/debug/bundle/macos/Perchy.app /tmp/perchy-e2e/
# 2) 打一个带签名的 0.1.1 更新包
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/perchy-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npx @tauri-apps/cli@2 build --debug --bundles app --config '{"version":"0.1.1","bundle":{"createUpdaterArtifacts":true}}'
# 3) 用 Perchy.app.tar.gz 和 .sig 写一个 latest.json，用 python3 -m http.server 提供出来，然后：
PERCHY_UPDATE_URL=http://127.0.0.1:8899/latest.json PERCHY_UPDATE_AUTOINSTALL=1 \
  /tmp/perchy-e2e/Perchy.app/Contents/MacOS/perchy
```

日志里依次出现 `update available: 0.1.0 → 0.1.1`、`update installed, restarting`，`/tmp/perchy-e2e/Perchy.app` 的版本变成 0.1.1。把更新包改坏后再试，应当出现 `signature verification failed`，并且不会安装。
