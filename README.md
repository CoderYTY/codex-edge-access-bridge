# Codex Edge Access Bridge

这是一个给 Microsoft Edge 用的本地访问插件：Edge 扩展通过 Native Messaging 自动拉起本机 host，Codex 或命令行再通过 `http://127.0.0.1:18888` 访问 Edge 标签页。

我没有找到 OpenAI 官方公开发布的 “Codex Chrome 插件”源码，所以这里参考的是浏览器原生消息 + 本机代理的实现方式。所有读取和操作都发生在你的本机。

## 目录

- `extension/`：Edge / Chromium Manifest V3 扩展。
- `bridge/native-host.js`：由 Edge 自动拉起的 Native Messaging host，内部提供本机 HTTP API。
- `bridge/edge-client.js`：给 Codex 或终端调用的命令行工具。
- `bridge/server.js`：旧版手动桥接服务，作为备用方案保留。
- `native/NativeHostLauncher.cs`：Windows launcher 源码。
- `scripts/install-native-host.ps1`：注册 Edge Native Messaging host。
- `scripts/uninstall-native-host.ps1`：卸载注册项。

## 安装 Native Host

先确认 Edge 扩展 ID。你当前加载出来的 ID 是：

```text
hoknjjaaoakpcokjenclbkbemconlmnn
```

注册 Native Host：

```powershell
cd E:\Learn\Edge浏览器插件
npm.cmd run native:install
```

如果你的扩展 ID 变了，就手动传入：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1 -ExtensionId "<你的扩展ID>"
```

注册脚本会做三件事：

1. 编译 `native/edge-codex-native-host.exe`。
2. 生成 `native/com.codex.edge_bridge.json`。
3. 写入 `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.codex.edge_bridge`。

## 加载扩展

1. 打开：

   ```text
   edge://extensions
   ```

2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择本项目里的 `extension` 目录。
4. 如果已经加载过，点击扩展卡片上的“重新加载”。
5. 点击工具栏扩展图标，打开 `Codex Edge Bridge` 控制台页。

控制台页显示 `connected` 后，本机 host 已由 Edge 自动启动。现在不需要手动运行 `npm run bridge`。

## 使用

```powershell
npm.cmd run edge -- status
npm.cmd run edge -- tabs
npm.cmd run edge -- active
npm.cmd run edge -- read
npm.cmd run edge -- navigate https://example.com
npm.cmd run edge -- click "a"
npm.cmd run edge -- type "input[name=q]" "hello from Codex"
npm.cmd run edge -- screenshot .\edge-shot.png
```

也可以直接调用：

```powershell
node .\bridge\edge-client.js read --tab 123
node .\bridge\edge-client.js html --max 50000
node .\bridge\edge-client.js query "button, a"
node .\bridge\edge-client.js eval "return { title: document.title, links: [...document.links].length }"
```

## 可用命令

- `status`：查看桥接服务和扩展连接状态。
- `tabs`：列出 Edge 标签页。
- `active`：获取当前活动标签页。
- `read [--tab <id>] [--max <chars>]`：读取页面标题、URL、选中文本、正文和部分链接。
- `html [--tab <id>] [--max <chars>]`：读取页面 HTML。
- `query <selector> [--tab <id>]`：查询页面元素摘要。
- `click <selector> [--tab <id>]`：点击元素。
- `type <selector> <text> [--tab <id>] [--submit]`：输入文本，可选择提交表单。
- `scroll <x> <y> [--tab <id>]`：滚动页面。
- `wait <selector> [--timeout <ms>] [--tab <id>]`：等待元素出现。
- `navigate <url> [--tab <id>]`：导航当前标签页或指定标签页。
- `screenshot <path> [--tab <id>]`：保存当前可见区域截图。
- `reload [--tab <id>]`：刷新标签页。
- `newtab <url>`：新建标签页。
- `close --tab <id>`：关闭指定标签页。
- `eval <javascript> [--tab <id>]`：在页面上下文执行 JavaScript。

## 卸载

```powershell
npm.cmd run native:uninstall
```

这只删除 Edge Native Messaging 注册项，不会删除项目文件。

## 备用手动模式

如果 Native Messaging 暂时不可用，还可以手动启动旧桥接服务：

```powershell
npm.cmd run bridge
```

旧模式需要控制台页用 HTTP 轮询；当前扩展默认使用 Native Messaging。

## 限制

- Edge 内部页面，例如 `edge://extensions`，浏览器不允许普通扩展注入脚本。
- 某些商店、银行或高安全页面可能限制内容脚本或页面操作。
- `screenshot` 只能截取当前窗口可见区域；如果指定了非活动标签页，扩展会先激活它再截图。
- 为了让本机 host 保持运行，需要保持 `Codex Edge Bridge` 控制台页打开。
