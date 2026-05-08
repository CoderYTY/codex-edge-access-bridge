'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const SERVER = process.env.EDGE_CODEX_SERVER || `http://127.0.0.1:${process.env.EDGE_CODEX_PORT || 18888}`;
const TOKEN = process.env.EDGE_CODEX_TOKEN || '';

function usage() {
  console.log(`Usage:
  node bridge/edge-client.js status
  node bridge/edge-client.js tabs
  node bridge/edge-client.js active
  node bridge/edge-client.js read [--tab <id>] [--max <chars>]
  node bridge/edge-client.js html [--tab <id>] [--max <chars>]
  node bridge/edge-client.js query <selector> [--tab <id>]
  node bridge/edge-client.js click <selector> [--tab <id>]
  node bridge/edge-client.js type <selector> <text> [--tab <id>] [--submit]
  node bridge/edge-client.js scroll <x> <y> [--tab <id>]
  node bridge/edge-client.js wait <selector> [--timeout <ms>] [--tab <id>]
  node bridge/edge-client.js navigate <url> [--tab <id>]
  node bridge/edge-client.js screenshot <path> [--tab <id>]
  node bridge/edge-client.js reload [--tab <id>]
  node bridge/edge-client.js newtab <url>
  node bridge/edge-client.js close --tab <id>
  node bridge/edge-client.js eval <javascript> [--tab <id>]

Options:
  --json               Print raw JSON.
  --timeout <ms>       Command timeout. Default: 60000.
  --tab <id>           Target tab id.
  --max <chars>        Max characters for read/html. Default: command-specific.
  --submit             Submit form after type.
`);
}

function parseArgs(argv) {
  const flags = {
    json: false,
    submit: false,
    tabId: undefined,
    timeoutMs: 60000,
    maxChars: undefined
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--json') {
      flags.json = true;
    } else if (item === '--submit') {
      flags.submit = true;
    } else if (item === '--tab') {
      flags.tabId = Number(argv[++index]);
    } else if (item === '--timeout') {
      flags.timeoutMs = Number(argv[++index]);
    } else if (item === '--max') {
      flags.maxChars = Number(argv[++index]);
    } else {
      positional.push(item);
    }
  }

  return { flags, positional };
}

function requestJson(method, route, payload, timeoutMs) {
  const target = new URL(route, SERVER);
  const body = payload ? JSON.stringify(payload) : '';

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        timeout: timeoutMs || 65000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (error) {
            reject(new Error(`Invalid JSON from server: ${error.message}\n${raw}`));
            return;
          }

          if (res.statusCode >= 400 || parsed.ok === false) {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
            return;
          }

          resolve(parsed);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs || 65000} ms`));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function sendCommand(name, args, timeoutMs) {
  const payload = {
    name,
    args: args || {},
    timeoutMs
  };
  const response = await requestJson('POST', '/command', payload, timeoutMs + 5000);
  return response.result;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printTabs(tabs) {
  for (const tab of tabs) {
    const marker = tab.active ? '*' : ' ';
    console.log(`${marker} ${String(tab.id).padStart(4)}  ${tab.title || '(untitled)'}`);
    console.log(`       ${tab.url || ''}`);
  }
}

function printPage(page) {
  console.log(`# ${page.title || '(untitled)'}`);
  console.log(page.url || '');
  if (page.selection) {
    console.log('\n## Selection\n');
    console.log(page.selection);
  }
  console.log('\n## Text\n');
  console.log(page.text || '');
  if (page.truncated) {
    console.log(`\n[truncated at ${page.maxChars} characters]`);
  }
}

function requireArg(value, name) {
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
}

function maybeTab(flags) {
  return Number.isFinite(flags.tabId) ? { tabId: flags.tabId } : {};
}

async function main() {
  const command = process.argv[2];
  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }

  const { flags, positional } = parseArgs(process.argv.slice(3));

  if (command === 'status') {
    const status = await requestJson('GET', '/health', null, flags.timeoutMs);
    printJson(status);
    return;
  }

  let result;
  if (command === 'tabs') {
    result = await sendCommand('tabs', {}, flags.timeoutMs);
    flags.json ? printJson(result) : printTabs(result);
    return;
  }

  if (command === 'active') {
    result = await sendCommand('activeTab', {}, flags.timeoutMs);
    printJson(result);
    return;
  }

  if (command === 'read') {
    result = await sendCommand(
      'pageText',
      { ...maybeTab(flags), maxChars: flags.maxChars },
      flags.timeoutMs
    );
    flags.json ? printJson(result) : printPage(result);
    return;
  }

  if (command === 'html') {
    result = await sendCommand(
      'pageHtml',
      { ...maybeTab(flags), maxChars: flags.maxChars },
      flags.timeoutMs
    );
    flags.json ? printJson(result) : console.log(result.html || '');
    return;
  }

  if (command === 'query') {
    requireArg(positional[0], 'selector');
    result = await sendCommand(
      'query',
      { ...maybeTab(flags), selector: positional[0] },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'click') {
    requireArg(positional[0], 'selector');
    result = await sendCommand(
      'click',
      { ...maybeTab(flags), selector: positional[0] },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'type') {
    requireArg(positional[0], 'selector');
    const text = positional.slice(1).join(' ');
    requireArg(text, 'text');
    result = await sendCommand(
      'type',
      {
        ...maybeTab(flags),
        selector: positional[0],
        text,
        submit: flags.submit
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'scroll') {
    const x = Number(positional[0] || 0);
    const y = Number(positional[1] || 0);
    result = await sendCommand('scroll', { ...maybeTab(flags), x, y }, flags.timeoutMs);
    printJson(result);
    return;
  }

  if (command === 'wait') {
    requireArg(positional[0], 'selector');
    result = await sendCommand(
      'waitForSelector',
      {
        ...maybeTab(flags),
        selector: positional[0],
        timeoutMs: flags.timeoutMs
      },
      flags.timeoutMs + 1000
    );
    printJson(result);
    return;
  }

  if (command === 'navigate') {
    requireArg(positional[0], 'url');
    result = await sendCommand(
      'navigate',
      { ...maybeTab(flags), url: positional[0] },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'screenshot') {
    requireArg(positional[0], 'path');
    result = await sendCommand('screenshot', maybeTab(flags), flags.timeoutMs);
    const match = /^data:image\/png;base64,(.+)$/.exec(result.dataUrl || '');
    if (!match) throw new Error('Screenshot result is not a PNG data URL');
    const outPath = path.resolve(process.cwd(), positional[0]);
    fs.writeFileSync(outPath, Buffer.from(match[1], 'base64'));
    console.log(outPath);
    return;
  }

  if (command === 'reload') {
    result = await sendCommand('reload', maybeTab(flags), flags.timeoutMs);
    printJson(result);
    return;
  }

  if (command === 'newtab') {
    requireArg(positional[0], 'url');
    result = await sendCommand('newTab', { url: positional[0] }, flags.timeoutMs);
    printJson(result);
    return;
  }

  if (command === 'close') {
    if (!Number.isFinite(flags.tabId)) throw new Error('close requires --tab <id>');
    result = await sendCommand('closeTab', { tabId: flags.tabId }, flags.timeoutMs);
    printJson(result);
    return;
  }

  if (command === 'eval') {
    const code = positional.join(' ');
    requireArg(code, 'javascript');
    result = await sendCommand('eval', { ...maybeTab(flags), code }, flags.timeoutMs);
    printJson(result);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
