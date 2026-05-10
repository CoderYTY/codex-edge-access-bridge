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
- Observe a page in one call, including text, headings, links, fields, buttons, and other visible controls.
- Generate compact AI snapshots with stable action IDs for the current page state, then act by ID.
- Extract structured page data such as article text, links, cards, and search results with matching action IDs.
- Run auditable multi-step task chains with tab inheritance, waits, structured extraction, and template references between steps.
- Run reusable task templates for common AI browsing workflows such as page briefing, search summarization, and result comparison.
- Pick a reusable task template from a natural-language intent with `smart`.
- Find the most likely action ID from a natural-language target such as "search box" or "history".
- Review recent browser automation steps with a compact operation trace.
- Query page elements by CSS selector.
- Click by selector or visible text, fill fields by label, choose options, press keys, scroll, reload, navigate, open tabs, and close tabs.
- Capture the visible area of a tab as a PNG screenshot.
- Classify command risk and require explicit confirmation for high-risk actions.
- Start the local bridge through Edge Native Messaging.
- Keep all browser automation on `127.0.0.1`.

## Project Layout

- `extension/`: Microsoft Edge / Chromium Manifest V3 extension.
- `bridge/native-host.js`: Native Messaging host that exposes the local HTTP API.
- `bridge/edge-client.js`: CLI used by Codex or a terminal.
- `bridge/server.js`: optional HTTP bridge for manual workflows.
- `templates/`: reusable JSON task-chain templates for common AI browsing workflows.
- `examples/`: task-chain examples and failure demos.
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

For most agent workflows, start with these commands:

```powershell
node .\bridge\edge-client.js status
node .\bridge\edge-client.js tabs
node .\bridge\edge-client.js smart "总结当前页面" --tab <tabId>
node .\bridge\edge-client.js smart "搜索并整理 Codex Edge Bridge" --tab <tabId> --timeout 90000
node .\bridge\edge-client.js smart "搜索并打开第一个 Codex Edge Bridge 结果" --tab <tabId> --timeout 100000
node .\bridge\edge-client.js smart "对比 Codex Edge Bridge 的前两个结果" --tab <tabId> --timeout 120000
node .\bridge\edge-client.js smart "扫描当前页面可操作项" --tab <tabId>
node .\bridge\edge-client.js trace --limit 10
```

Use `smart` for natural-language browser tasks. Use the lower-level commands below when an agent needs direct control.

Check the bridge:

```powershell
node .\bridge\edge-client.js status
```

List tabs:

```powershell
node .\bridge\edge-client.js tabs
```

Review recent operations:

```powershell
node .\bridge\edge-client.js trace --limit 10
node .\bridge\edge-client.js trace --clear
```

Run a multi-step browser task chain:

```powershell
node .\bridge\edge-client.js chain .\examples\search-extract-open-second.json --tab <tabId> --timeout 90000
node .\bridge\edge-client.js chain .\examples\assertion-fail-demo.json --tab <tabId> --timeout 60000
```

List and run built-in task templates:

```powershell
node .\bridge\edge-client.js templates
node .\bridge\edge-client.js templates search-summary
node .\bridge\edge-client.js run-template page-brief --tab <tabId>
node .\bridge\edge-client.js run-template search-summary "Codex Edge Bridge" --tab <tabId> --timeout 90000
node .\bridge\edge-client.js run-template open-first-result --input query="Codex Edge Bridge" --tab <tabId> --timeout 100000
```

Let the CLI choose the template from an intent:

```powershell
node .\bridge\edge-client.js smart "总结当前页面" --tab <tabId>
node .\bridge\edge-client.js smart "搜索并整理 Codex Edge Bridge" --tab <tabId> --timeout 90000
node .\bridge\edge-client.js smart "搜索并打开第一个 Codex Edge Bridge 结果" --tab <tabId> --timeout 100000
node .\bridge\edge-client.js smart "对比 Codex Edge Bridge 的前两个结果" --tab <tabId> --timeout 120000
```

Read a page:

```powershell
node .\bridge\edge-client.js read --tab <tabId> --max 30000
```

Observe a page for agent planning:

```powershell
node .\bridge\edge-client.js observe --tab <tabId> --max 5000 --elements 40
node .\bridge\edge-client.js observe --tab <tabId> --screenshot .\observe.png
```

Use compact AI snapshots when an agent needs to plan and act with less context:

```powershell
node .\bridge\edge-client.js snapshot --tab <tabId> --max 3000 --elements 40
node .\bridge\edge-client.js target "搜索框" --tab <tabId> --action fill
node .\bridge\edge-client.js find "历史" --tab <tabId>
node .\bridge\edge-client.js act b1 --tab <tabId>
node .\bridge\edge-client.js act f1 "hello from Codex" --tab <tabId>
node .\bridge\edge-client.js act b1 --tab <tabId> --wait
node .\bridge\edge-client.js act b1 --tab <tabId> --wait-for "main"
node .\bridge\edge-client.js act b2 --tab <tabId> --risk
node .\bridge\edge-client.js act b2 --tab <tabId> --confirm
```

Use high-level semantic actions for common workflows:

```powershell
node .\bridge\edge-client.js open-target "历史" --tab <tabId> --wait
node .\bridge\edge-client.js fill-target "搜索框" "Codex Edge Bridge" --tab <tabId>
node .\bridge\edge-client.js search "Codex Edge Bridge" --tab <tabId> --wait-ms 12000
```

Extract structured data when an agent needs machine-readable page content:

```powershell
node .\bridge\edge-client.js extract --tab <tabId> --mode auto --limit 20
node .\bridge\edge-client.js extract --tab <tabId> --mode links --limit 30
node .\bridge\edge-client.js extract --tab <tabId> --mode search --limit 10
node .\bridge\edge-client.js search-extract "Codex Edge Bridge" --tab <tabId> --limit 10 --wait-ms 12000
```

Task chains accept a JSON array or an object with a `steps` array. Each step has `name`, optional `label`, `saveAs`, and `args`. Later steps can reference earlier results and CLI inputs with templates:

```json
{
  "steps": [
    {
      "name": "searchExtract",
      "saveAs": "search",
      "retry": {
        "attempts": 2,
        "delayMs": 1000
      },
      "args": {
        "searchText": "{{inputs.query}}",
        "limit": 5,
        "waitMs": 12000
      }
    },
    {
      "name": "assert",
      "args": {
        "value": "{{vars.search.extraction.results.length}}",
        "gte": 2
      }
    },
    {
      "name": "act",
      "retry": {
        "attempts": 2,
        "delayMs": 1000
      },
      "args": {
        "id": "{{vars.search.extraction.results.1.actionId}}",
        "wait": true,
        "followNewTab": true
      }
    },
    {
      "name": "extract",
      "saveAs": "openedPage",
      "args": {
        "mode": "article",
        "maxChars": 2500
      }
    }
  ],
  "inputs": {
    "query": "Codex Edge Bridge"
  },
  "output": {
    "query": "{{inputs.query}}",
    "openedTitle": "{{vars.openedPage.article.title}}",
    "openedAuthor": "{{vars.openedPage.article.author}}",
    "openedUrl": "{{vars.openedPage.url}}"
  }
}
```

Use `assert` / `expect` as a standalone read-only check or as a chain step:

```powershell
node .\bridge\edge-client.js assert --tab <tabId> --title-contains "bilibili"
node .\bridge\edge-client.js assert --tab <tabId> --text-contains "Codex" --max 60000
```

By default, `chain` passes the current result tab to the next step. Use `--no-inherit-tab` to disable this, or `--continue-on-error`, `--continue-on-blocked`, `--continue-on-unmatched`, and `--continue-on-assertion` to keep running after a non-OK step. Steps can retry transient failures with `retry: { "attempts": 3, "delayMs": 1000 }`. Use `--input key=value` or top-level `inputs` with `{{inputs.key}}` placeholders. Use top-level `output` to return a concise final object while keeping full per-step records available for trace/debugging.

Query and interact with elements:

```powershell
node .\bridge\edge-client.js query "button, a, input" --tab <tabId>
node .\bridge\edge-client.js click "button[type=submit]" --tab <tabId>
node .\bridge\edge-client.js clicktext "登录" --tab <tabId>
node .\bridge\edge-client.js type "input[name=q]" "hello from Codex" --tab <tabId>
node .\bridge\edge-client.js fill "搜索" "hello from Codex" --tab <tabId> --submit
node .\bridge\edge-client.js press Enter --tab <tabId>
node .\bridge\edge-client.js select "城市" "上海" --tab <tabId>
```

Check risk before acting:

```powershell
node .\bridge\edge-client.js clicktext "删除" --tab <tabId> --risk
node .\bridge\edge-client.js close --tab <tabId> --risk
```

Run a high-risk command only after explicit user confirmation:

```powershell
node .\bridge\edge-client.js close --tab <tabId> --confirm
```

Navigate and capture:

```powershell
node .\bridge\edge-client.js navigate https://example.com --tab <tabId>
node .\bridge\edge-client.js screenshot .\edge-shot.png --tab <tabId>
node .\bridge\edge-client.js activate --tab <tabId>
```

## Commands

- `status`: show bridge and extension connection status.
- `tabs`: list Edge tabs.
- `active`: show the active tab.
- `trace`: return recent command summaries, risks, waits, and compact results.
- `chain`: run a JSON-defined sequence of browser commands and return per-step results.
- `templates`: list built-in task-chain templates, or show one template summary by name.
- `run-template` / `preset`: run a built-in task-chain template with `--input key=value` values.
- `smart` / `auto` / `intent`: choose and run a built-in template from a natural-language intent.
- `assert` / `expect`: check title, URL, page text, selector count, or a templated value.
- `observe`: return page text, headings, links, visible controls, form fields, viewport data, and optional screenshot.
- `snapshot`: return a compact page snapshot with numbered action IDs such as `l1`, `b1`, and `f1`.
- `target` / `find`: locate the best action ID for a natural-language target and return ranked candidates.
- `extract`: return structured article, links, cards, or search results with matching action IDs when possible.
- `act`: execute a numbered action from the latest snapshot, with optional value, action override, and post-action wait.
- `open-target`: locate a semantic target, click it, and optionally wait.
- `fill-target`: locate a semantic field and fill it.
- `search`: locate the page search box, fill the query, submit, and wait for results, including result pages opened in a new tab.
- `search-extract`: run `search`, follow the result tab, then return structured search results.
- `read`: read page title, URL, selected text, visible text, headings, and links.
- `html`: read page HTML.
- `query`: summarize matching DOM elements.
- `click`: click an element.
- `clicktext`: click a visible control by text, accessible label, placeholder, or similar page text.
- `type`: type into an editable element.
- `fill`: fill a field by label, placeholder, name, aria label, or selector.
- `press`: dispatch a keyboard action to the focused element or selector.
- `select`: choose an option in a `<select>` element by label/value text.
- `scroll`: scroll the page.
- `wait`: wait for an element.
- `navigate`: navigate a tab to a URL.
- `screenshot`: save a PNG screenshot.
- `reload`: reload a tab.
- `activate`: bring a tab to the front.
- `newtab`: open a new tab.
- `close`: close a tab.
- `eval`: run JavaScript in the page context.

## Safety Gates

The bridge is built for user-directed automation. Read-only commands are allowed by default, while high-risk actions return `requiresConfirmation: true` instead of executing unless the request includes `confirm: true` or the CLI uses `--confirm`.

Risk levels:

- `low`: observe, snapshot, extract, assert, read, query, screenshot, list tabs, activate a tab, wait, scroll.
- `medium`: chain, navigate, open tabs, reload, act, semantic search, search-extract, click, type, fill, press keys, select options.
- `high`: close tabs, execute page JavaScript, submit-like actions, and actions whose visible text or labels look like delete, pay, publish, login, authorize, follow/unfollow, report, or similar account-changing operations.

Use `--risk` to inspect the risk classification without executing the command.

## Privacy Model

The bridge runs locally and listens on `127.0.0.1`. Browser actions happen through the loaded Edge extension and the Native Messaging host registered for that extension.

The extension is intended for user-directed automation: inspect the requested tabs, operate the requested pages, and leave account verification, payment confirmation, CAPTCHA, and other sensitive checkpoints under direct user control.

## Uninstall

Remove the Native Messaging registration:

```powershell
npm.cmd run native:uninstall
```

Then remove the unpacked extension from `edge://extensions`.
