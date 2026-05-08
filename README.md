# Codex Edge Access Bridge

Codex Edge Access Bridge lets Codex inspect and operate Microsoft Edge tabs through a local browser extension and Native Messaging host.

It is designed for local agent workflows where the browser stays under the user's control while Codex can read page content, list tabs, click elements, type into fields, navigate pages, and capture screenshots when asked.

## Companion Skill

This repository provides the Edge extension, Native Messaging host, and command-line bridge. For the best Codex experience, install the companion skill as well:

- Companion skill: [CoderYTY/edge-browser-control-skill](https://github.com/CoderYTY/edge-browser-control-skill)

Use them together:

- This repository makes Edge accessible from the local machine.
- The skill teaches Codex when and how to call the local Edge bridge.

## Features

- List open Edge tabs with titles and URLs.
- Read visible page text, selected text, headings, links, and HTML.
- Query page elements by CSS selector.
- Click, type, scroll, reload, navigate, open tabs, and close tabs.
- Capture the visible area of a tab as a PNG screenshot.
- Start the local bridge through Edge Native Messaging.
- Keep all browser automation on `127.0.0.1`.

## Project Layout

- `extension/`: Microsoft Edge / Chromium Manifest V3 extension.
- `bridge/native-host.js`: Native Messaging host that exposes the local HTTP API.
- `bridge/edge-client.js`: CLI used by Codex or a terminal.
- `bridge/server.js`: optional HTTP bridge for manual fallback workflows.
- `native/NativeHostLauncher.cs`: Windows launcher source for the native host.
- `scripts/install-native-host.ps1`: registers the Edge Native Messaging host.
- `scripts/uninstall-native-host.ps1`: removes the Native Messaging registration.

## Requirements

- Windows
- Microsoft Edge
- Node.js 18 or newer
- PowerShell
- .NET Framework compiler available through Windows `csc.exe`

## Installation

Clone the repository:

```powershell
git clone https://github.com/CoderYTY/codex-edge-access-bridge.git
cd codex-edge-access-bridge
```

Load the extension in Edge:

1. Open `edge://extensions`.
2. Enable Developer mode.
3. Select Load unpacked.
4. Choose the `extension` directory from this repository.
5. Copy the generated extension ID from Edge.

Register the Native Messaging host with that extension ID:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-native-host.ps1 -ExtensionId "<your-extension-id>"
```

Reload the extension in `edge://extensions`, then open the extension dashboard. The dashboard should show `connected`.

## CLI Usage

Check the bridge:

```powershell
node .\bridge\edge-client.js status
```

List tabs:

```powershell
node .\bridge\edge-client.js tabs
```

Read a page:

```powershell
node .\bridge\edge-client.js read --tab <tabId> --max 30000
```

Query and interact with elements:

```powershell
node .\bridge\edge-client.js query "button, a, input" --tab <tabId>
node .\bridge\edge-client.js click "button[type=submit]" --tab <tabId>
node .\bridge\edge-client.js type "input[name=q]" "hello from Codex" --tab <tabId>
```

Navigate and capture:

```powershell
node .\bridge\edge-client.js navigate https://example.com --tab <tabId>
node .\bridge\edge-client.js screenshot .\edge-shot.png --tab <tabId>
```

## Commands

- `status`: show bridge and extension connection status.
- `tabs`: list Edge tabs.
- `active`: show the active tab.
- `read`: read page title, URL, selected text, visible text, headings, and links.
- `html`: read page HTML.
- `query`: summarize matching DOM elements.
- `click`: click an element.
- `type`: type into an editable element.
- `scroll`: scroll the page.
- `wait`: wait for an element.
- `navigate`: navigate a tab to a URL.
- `screenshot`: save a PNG screenshot.
- `reload`: reload a tab.
- `newtab`: open a new tab.
- `close`: close a tab.
- `eval`: run JavaScript in the page context.

## Privacy Model

The bridge runs locally and listens on `127.0.0.1`. Browser actions happen through the loaded Edge extension and the Native Messaging host registered for that extension.

The extension is intended for user-directed automation: inspect the requested tabs, operate the requested pages, and leave account verification, payment confirmation, CAPTCHA, and other sensitive checkpoints under direct user control.

## Uninstall

Remove the Native Messaging registration:

```powershell
npm.cmd run native:uninstall
```

Then remove the unpacked extension from `edge://extensions`.
