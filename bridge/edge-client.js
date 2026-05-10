'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const SERVER = process.env.EDGE_CODEX_SERVER || `http://127.0.0.1:${process.env.EDGE_CODEX_PORT || 18888}`;
const TOKEN = process.env.EDGE_CODEX_TOKEN || '';
const TEMPLATE_DIR = path.resolve(__dirname, '..', 'templates');

function usage() {
  console.log(`Usage:
  node bridge/edge-client.js status
  node bridge/edge-client.js tabs
  node bridge/edge-client.js active
  node bridge/edge-client.js trace [--limit <count>] [--clear]
  node bridge/edge-client.js chain <steps.json|json> [--tab <id>] [--continue-on-error]
  node bridge/edge-client.js templates [name]
  node bridge/edge-client.js run-template <name> [text] [--input key=value] [--tab <id>]
  node bridge/edge-client.js smart <intent> [--input key=value] [--tab <id>]
  node bridge/edge-client.js assert [--tab <id>] [--title-contains <text>] [--url-contains <text>] [--text-contains <text>] [--selector <css>]
  node bridge/edge-client.js observe [--tab <id>] [--max <chars>] [--elements <count>] [--screenshot <path>]
  node bridge/edge-client.js snapshot [--tab <id>] [--max <chars>] [--elements <count>] [--screenshot <path>]
  node bridge/edge-client.js extract [--tab <id>] [--mode <auto|links|cards|article|search>] [--limit <count>]
  node bridge/edge-client.js target <query> [--tab <id>] [--elements <count>] [--action <name>] [--kind <hint>]
  node bridge/edge-client.js find <query> [--tab <id>] [--elements <count>] [--action <name>] [--kind <hint>]
  node bridge/edge-client.js open-target <query> [--tab <id>] [--wait]
  node bridge/edge-client.js fill-target <query> <value> [--tab <id>] [--submit]
  node bridge/edge-client.js search <text> [--tab <id>] [--target <query>] [--wait-ms <ms>]
  node bridge/edge-client.js search-extract <text> [--tab <id>] [--target <query>] [--limit <count>]
  node bridge/edge-client.js act <id> [value] [--tab <id>] [--action <click|fill|select|press>] [--wait] [--confirm]
  node bridge/edge-client.js read [--tab <id>] [--max <chars>]
  node bridge/edge-client.js html [--tab <id>] [--max <chars>]
  node bridge/edge-client.js query <selector> [--tab <id>]
  node bridge/edge-client.js click <selector> [--tab <id>]
  node bridge/edge-client.js clicktext <text> [--tab <id>] [--selector <css>] [--exact]
  node bridge/edge-client.js type <selector> <text> [--tab <id>] [--submit]
  node bridge/edge-client.js fill <field> <text> [--tab <id>] [--submit]
  node bridge/edge-client.js press <key> [--tab <id>] [--selector <css>] [--submit]
  node bridge/edge-client.js select <field> <option> [--tab <id>] [--exact]
  node bridge/edge-client.js scroll <x> <y> [--tab <id>]
  node bridge/edge-client.js wait <selector> [--timeout <ms>] [--tab <id>]
  node bridge/edge-client.js navigate <url> [--tab <id>]
  node bridge/edge-client.js screenshot <path> [--tab <id>]
  node bridge/edge-client.js reload [--tab <id>]
  node bridge/edge-client.js activate --tab <id>
  node bridge/edge-client.js newtab <url>
  node bridge/edge-client.js close --tab <id>
  node bridge/edge-client.js eval <javascript> [--tab <id>]

Options:
  --json               Print raw JSON.
  --timeout <ms>       Command timeout. Default: 60000.
  --tab <id>           Target tab id.
  --steps <json>       Inline JSON array/object for chain.
  --file <path>        JSON file for chain.
  --input key=value    Template or chain input value. Can be repeated.
  --set key=value      Alias for --input.
  --continue-on-error  Keep running a chain after a failed step.
  --continue-on-blocked Keep running a chain after a blocked step.
  --continue-on-unmatched Keep running a chain after no target matched.
  --continue-on-assertion Keep running a chain after an assertion fails.
  --no-inherit-tab     Do not pass the previous step tab to the next chain step.
  --limit <count>      Number of trace entries or target matches to return.
  --max <chars>        Max characters for read/html. Default: command-specific.
  --elements <count>   Max visible controls for observe/snapshot/target.
  --mode <mode>        Extract mode: auto, links, cards, article, or search.
  --selector <css>     CSS selector for semantic commands.
  --action <name>      Action for act: click, fill, select, or press.
  --kind <hint>        Target kind hint for target/find.
  --target <query>     Target field hint for search.
  --title-contains <text> Assert title contains text.
  --url-contains <text> Assert URL contains text.
  --text-contains <text> Assert page text contains text.
  --contains <text>    Assert a generic value contains text.
  --equals <text>      Assert a generic value equals text.
  --matches <regex>    Assert a generic value matches regex.
  --gte <number>       Assert a generic value is >= number.
  --lte <number>       Assert a generic value is <= number.
  --truthy             Assert a generic value is truthy.
  --wait               After act, wait for page load and DOM stability.
  --wait-for <css>     After act, wait for a selector to appear.
  --wait-until <mode>  Wait mode after act: stable, idle, or load.
  --wait-ms <ms>       Max post-act wait time. Default: 8000.
  --quiet <ms>         DOM quiet time for stable wait. Default: 500.
  --clear              Clear trace entries when used with trace.
  --exact              Require exact text/label match.
  --screenshot <path>  Save observe/snapshot screenshot to a PNG path.
  --risk               Return risk classification without executing the command.
  --confirm            Confirm a high-risk command after explicit user approval.
  --submit             Submit form after type/fill/act.
`);
}

function parseArgs(argv) {
  const flags = {
    json: false,
    submit: false,
    exact: false,
    risk: false,
    confirm: false,
    wait: false,
    clear: false,
    tabId: undefined,
    limit: undefined,
    timeoutMs: 60000,
    maxChars: undefined,
    maxElements: undefined,
    selector: undefined,
    action: undefined,
    kind: undefined,
    target: undefined,
    waitFor: undefined,
    waitUntil: undefined,
    waitMs: undefined,
    quietMs: undefined,
    mode: undefined,
    stepsJson: undefined,
    filePath: undefined,
    continueOnError: false,
    continueOnBlocked: false,
    continueOnUnmatched: false,
    continueOnAssertion: false,
    noInheritTab: false,
    titleContains: undefined,
    urlContains: undefined,
    textContains: undefined,
    contains: undefined,
    equals: undefined,
    matches: undefined,
    gte: undefined,
    lte: undefined,
    truthy: false,
    screenshotPath: undefined,
    inputs: {}
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--json') {
      flags.json = true;
    } else if (item === '--submit') {
      flags.submit = true;
    } else if (item === '--exact') {
      flags.exact = true;
    } else if (item === '--risk') {
      flags.risk = true;
    } else if (item === '--confirm') {
      flags.confirm = true;
    } else if (item === '--wait') {
      flags.wait = true;
    } else if (item === '--clear') {
      flags.clear = true;
    } else if (item === '--tab') {
      flags.tabId = Number(argv[++index]);
    } else if (item === '--limit') {
      flags.limit = Number(argv[++index]);
    } else if (item === '--timeout') {
      flags.timeoutMs = Number(argv[++index]);
    } else if (item === '--max') {
      flags.maxChars = Number(argv[++index]);
    } else if (item === '--elements') {
      flags.maxElements = Number(argv[++index]);
    } else if (item === '--selector') {
      flags.selector = argv[++index];
    } else if (item === '--action') {
      flags.action = argv[++index];
    } else if (item === '--kind') {
      flags.kind = argv[++index];
    } else if (item === '--target') {
      flags.target = argv[++index];
    } else if (item === '--wait-for') {
      flags.waitFor = argv[++index];
    } else if (item === '--wait-until') {
      flags.waitUntil = argv[++index];
    } else if (item === '--wait-ms') {
      flags.waitMs = Number(argv[++index]);
    } else if (item === '--quiet') {
      flags.quietMs = Number(argv[++index]);
    } else if (item === '--mode') {
      flags.mode = argv[++index];
    } else if (item === '--steps') {
      flags.stepsJson = argv[++index];
    } else if (item === '--file') {
      flags.filePath = argv[++index];
    } else if (item === '--input' || item === '--set') {
      const [key, value] = parseInputPair(argv[++index]);
      flags.inputs[key] = value;
    } else if (item === '--continue-on-error') {
      flags.continueOnError = true;
    } else if (item === '--continue-on-blocked') {
      flags.continueOnBlocked = true;
    } else if (item === '--continue-on-unmatched') {
      flags.continueOnUnmatched = true;
    } else if (item === '--continue-on-assertion') {
      flags.continueOnAssertion = true;
    } else if (item === '--no-inherit-tab') {
      flags.noInheritTab = true;
    } else if (item === '--title-contains') {
      flags.titleContains = argv[++index];
    } else if (item === '--url-contains') {
      flags.urlContains = argv[++index];
    } else if (item === '--text-contains') {
      flags.textContains = argv[++index];
    } else if (item === '--contains') {
      flags.contains = argv[++index];
    } else if (item === '--equals') {
      flags.equals = argv[++index];
    } else if (item === '--matches') {
      flags.matches = argv[++index];
    } else if (item === '--gte') {
      flags.gte = Number(argv[++index]);
    } else if (item === '--lte') {
      flags.lte = Number(argv[++index]);
    } else if (item === '--truthy') {
      flags.truthy = true;
    } else if (item === '--screenshot') {
      flags.screenshotPath = argv[++index];
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

function savePngDataUrl(dataUrl, outputPath) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Screenshot result is not a PNG data URL');
  const outPath = path.resolve(process.cwd(), outputPath);
  fs.writeFileSync(outPath, Buffer.from(match[1], 'base64'));
  return outPath;
}

function requireArg(value, name) {
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
}

function parseInputValue(value) {
  const text = String(value ?? '');
  const trimmed = text.trim();
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return text;
    }
  }
  return text;
}

function parseInputPair(pair) {
  const text = String(pair || '');
  const index = text.indexOf('=');
  if (index < 1) {
    throw new Error('Expected input in key=value format');
  }
  const key = text.slice(0, index).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
    throw new Error(`Invalid input name: ${key}`);
  }
  return [key, parseInputValue(text.slice(index + 1))];
}

function maybeTab(flags) {
  return Number.isFinite(flags.tabId) ? { tabId: flags.tabId } : {};
}

function commonArgs(flags) {
  return {
    ...maybeTab(flags),
    riskOnly: flags.risk,
    confirm: flags.confirm
  };
}

function readJsonSource(source) {
  const text = String(source || '').trim();
  if (!text) throw new Error('Missing chain JSON source');
  if (text.startsWith('{') || text.startsWith('[')) return JSON.parse(text);
  const filePath = path.resolve(process.cwd(), text);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function templateNameFromPath(filePath) {
  return path.basename(filePath, '.json');
}

function isInputSpecValue(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ['default', 'required', 'label', 'description', 'type'].some((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isInputSpecMap(inputs) {
  return Boolean(
    inputs &&
    typeof inputs === 'object' &&
    !Array.isArray(inputs) &&
    Object.values(inputs).some(isInputSpecValue)
  );
}

function loadTemplateDefinition(name) {
  const rawName = String(name || '').trim();
  requireArg(rawName, 'template name');
  if (rawName.includes('/') || rawName.includes('\\') || rawName.includes('..')) {
    throw new Error(`Invalid template name: ${rawName}`);
  }

  const fileName = rawName.endsWith('.json') ? rawName : `${rawName}.json`;
  const filePath = path.resolve(TEMPLATE_DIR, fileName);
  if (!filePath.startsWith(TEMPLATE_DIR + path.sep)) {
    throw new Error(`Invalid template path: ${rawName}`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Template not found: ${rawName}`);
  }

  const definition = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!definition || typeof definition !== 'object' || !Array.isArray(definition.steps)) {
    throw new Error(`Template must be a JSON object with a steps array: ${rawName}`);
  }
  return {
    ...definition,
    name: definition.name || templateNameFromPath(filePath),
    templateFile: path.relative(process.cwd(), filePath)
  };
}

function listTemplateDefinitions() {
  if (!fs.existsSync(TEMPLATE_DIR)) return [];
  return fs.readdirSync(TEMPLATE_DIR)
    .filter((fileName) => fileName.toLowerCase().endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => loadTemplateDefinition(templateNameFromPath(fileName)));
}

function summarizeTemplate(definition) {
  const inputs = definition.inputs && typeof definition.inputs === 'object' && !Array.isArray(definition.inputs)
    ? Object.entries(definition.inputs).map(([name, spec]) => ({
        name,
        label: spec && typeof spec === 'object' ? spec.label || '' : '',
        required: Boolean(spec && typeof spec === 'object' && spec.required),
        default: spec && typeof spec === 'object' && Object.prototype.hasOwnProperty.call(spec, 'default')
          ? spec.default
          : undefined
      }))
    : [];

  return {
    name: definition.name,
    title: definition.title || definition.name,
    description: definition.description || '',
    stepCount: definition.steps.length,
    inputs,
    outputKeys: definition.output && typeof definition.output === 'object' && !Array.isArray(definition.output)
      ? Object.keys(definition.output)
      : []
  };
}

function printTemplateList(templates) {
  if (!templates.length) {
    console.log('No templates found.');
    return;
  }
  for (const template of templates) {
    const required = template.inputs.filter((input) => input.required).map((input) => input.name);
    const suffix = required.length ? ` required: ${required.join(', ')}` : '';
    console.log(`${template.name.padEnd(28)} ${template.title}${suffix}`);
    if (template.description) console.log(`  ${template.description}`);
  }
}

function compactCliValue(value, depth = 0) {
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, ' ').trim();
    return text.length > 900
      ? { value: text.slice(0, 900), length: text.length, truncated: true }
      : text;
  }
  if (value === null || value === undefined || typeof value !== 'object') return value ?? null;
  if (depth >= 3) return Array.isArray(value) ? { count: value.length } : '[object]';
  if (Array.isArray(value)) {
    return {
      count: value.length,
      items: value.slice(0, 12).map((item) => compactCliValue(item, depth + 1))
    };
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 24)
      .map(([key, item]) => [key, compactCliValue(item, depth + 1)])
  );
}

function printTemplateRunResult(result) {
  printJson({
    status: result.status,
    ok: Boolean(result.ok),
    stepCount: result.stepCount,
    completed: result.completed,
    stoppedAt: result.stoppedAt,
    stoppedReason: result.stoppedReason,
    currentTabId: result.currentTabId,
    variables: result.variables || [],
    output: compactCliValue(result.output)
  });
}

function printSmartRunResult(selection, result) {
  printJson({
    selectedTemplate: selection.template,
    confidence: selection.confidence,
    reasons: selection.reasons,
    inferredInputs: selection.inputs,
    status: result.status,
    ok: Boolean(result.ok),
    stepCount: result.stepCount,
    completed: result.completed,
    stoppedAt: result.stoppedAt,
    stoppedReason: result.stoppedReason,
    currentTabId: result.currentTabId,
    variables: result.variables || [],
    output: compactCliValue(result.output)
  });
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function stripIntentNoise(text) {
  return String(text || '')
    .replace(/[“”"‘']/g, ' ')
    .replace(/\b(browser|tab|tabs)\b/gi, ' ')
    .replace(/(浏览器|标签页|当前页|页面|帮我|请|一下|一下子|看看|看一下|看下|里面|内容)/gi, ' ')
    .replace(/(搜索并整理|搜索并总结|搜索并打开|搜索并对比|搜索一下|搜索|搜一下|搜|查找|查询|检索|整理结果|总结结果|整理|总结|摘要|对比前两个结果|对比前两条结果|对比两个结果|对比|比较|打开第一个结果|打开首个结果|打开第一个|打开首个|打开|读取|抽取|扫描|生成|列出|可操作项|动作地图|快照|结果|前两个|前两条|第一个|首个|并|然后|再)/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*的\s*$/g, '')
    .trim();
}

function inferQueryFromIntent(intent) {
  const text = String(intent || '').trim();
  if (!text) return '';

  const quoted = [...text.matchAll(/[“"‘']([^”"’']{2,})[”"’']/g)]
    .map((match) => match[1].trim())
    .sort((left, right) => right.length - left.length)[0];
  if (quoted) return quoted;

  const patterns = [
    /(?:搜索|搜一下|搜|查找|查询|检索)\s*(?:一下|下|关于|关键词|内容|结果|：|:)?\s*(.+)$/i,
    /(?:search(?:\s+for)?|query|find)\s+(.+)$/i,
    /(?:关于|关键词|query|keyword)\s*[:：]?\s*(.+)$/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = stripIntentNoise(match[1]);
      if (candidate) return candidate;
    }
  }

  return stripIntentNoise(text);
}

function selectTemplateForIntent(intent, providedInputs) {
  const raw = String(intent || '').trim();
  const lower = raw.toLowerCase();
  const compact = raw.replace(/\s+/g, '');
  const reasons = [];
  let template = '';
  let confidence = 0.5;

  const wantsCompare = includesAny(lower, ['compare', 'versus', ' vs ']) || includesAny(compact, ['对比', '比较', '前两个', '前两条', '两个结果', '两条结果', '前2个', '前2条']);
  const wantsOpen = includesAny(lower, ['open first', 'open result']) || includesAny(compact, ['打开第一个', '打开首个', '点开第一个', '进入第一个', '打开结果']);
  const wantsSearch = includesAny(lower, ['search', 'query', 'find']) || includesAny(compact, ['搜索', '搜', '查找', '查询', '检索', '结果']);
  const wantsActionMap = includesAny(lower, ['snapshot', 'action map', 'actions', 'controls', 'buttons']) || includesAny(compact, ['快照', '动作地图', '可操作', '按钮', '输入框', '控件', '编号', '定位']);
  const wantsBrief = includesAny(lower, ['brief', 'summarize page', 'read page', 'extract page']) || includesAny(compact, ['当前页', '这个页面', '这页', '页面摘要', '读取页面', '抽取页面', '总结页面', '看看内容']);

  if (wantsCompare) {
    template = 'compare-top-results';
    confidence = 0.93;
    reasons.push('intent asks to compare multiple search results');
  } else if (wantsOpen && wantsSearch) {
    template = 'open-first-result';
    confidence = 0.9;
    reasons.push('intent asks to search and open a result');
  } else if (wantsActionMap) {
    template = 'action-map';
    confidence = 0.86;
    reasons.push('intent asks for actionable controls or a snapshot');
  } else if (wantsSearch) {
    template = 'search-summary';
    confidence = 0.86;
    reasons.push('intent asks to search or inspect results');
  } else if (wantsBrief) {
    template = 'page-brief';
    confidence = 0.82;
    reasons.push('intent asks to read or summarize the current page');
  } else {
    template = providedInputs && providedInputs.query ? 'search-summary' : 'page-brief';
    confidence = providedInputs && providedInputs.query ? 0.62 : 0.55;
    reasons.push('fallback based on available inputs');
  }

  const inputs = { ...(providedInputs || {}) };
  if (!inputs.query && ['search-summary', 'open-first-result', 'compare-top-results'].includes(template)) {
    const query = inferQueryFromIntent(raw);
    if (query) inputs.query = query;
  }

  return {
    template,
    confidence,
    reasons,
    inputs
  };
}

function buildInputs(definition, providedInputs, positionalInputs) {
  const rawInputs = definition.inputs && typeof definition.inputs === 'object' && !Array.isArray(definition.inputs)
    ? definition.inputs
    : {};
  const specs = isInputSpecMap(rawInputs) ? rawInputs : {};
  const baseValues = isInputSpecMap(rawInputs) ? {} : rawInputs;
  const inputs = { ...baseValues };

  for (const [name, spec] of Object.entries(specs)) {
    if (spec && typeof spec === 'object' && Object.prototype.hasOwnProperty.call(spec, 'default')) {
      inputs[name] = spec.default;
    }
  }

  Object.assign(inputs, providedInputs || {});

  const rest = positionalInputs.filter((item) => item !== undefined && item !== '');
  if (rest.length) {
    const names = Object.keys(specs);
    const firstRequired = names.find((name) => specs[name] && specs[name].required && inputs[name] === undefined);
    const firstNamed = firstRequired || names[0];
    if (firstNamed && inputs[firstNamed] === undefined) {
      inputs[firstNamed] = rest.join(' ');
    }
  }

  const missing = Object.entries(specs)
    .filter(([name, spec]) => spec && spec.required && (inputs[name] === undefined || inputs[name] === ''))
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Missing required template input(s): ${missing.join(', ')}`);
  }

  return inputs;
}

function loadChainDefinition(flags, positional) {
  const source = flags.stepsJson || flags.filePath || positional[0];
  const definition = readJsonSource(source);
  if (Array.isArray(definition)) return { steps: definition };
  if (definition && typeof definition === 'object' && Array.isArray(definition.steps)) return definition;
  throw new Error('Chain JSON must be an array or an object with a steps array');
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
    result = await sendCommand('tabs', { riskOnly: flags.risk, confirm: flags.confirm }, flags.timeoutMs);
    flags.json ? printJson(result) : printTabs(result);
    return;
  }

  if (command === 'active') {
    result = await sendCommand('activeTab', commonArgs(flags), flags.timeoutMs);
    printJson(result);
    return;
  }

  if (command === 'trace') {
    result = await sendCommand(
      'trace',
      {
        limit: flags.limit,
        clear: flags.clear
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'templates' || command === 'template-list') {
    if (positional[0]) {
      const definition = loadTemplateDefinition(positional[0]);
      flags.json ? printJson(definition) : printJson(summarizeTemplate(definition));
      return;
    }
    const templates = listTemplateDefinitions().map(summarizeTemplate);
    flags.json ? printJson(templates) : printTemplateList(templates);
    return;
  }

  if (command === 'run-template' || command === 'preset') {
    const templateName = positional[0];
    requireArg(templateName, 'template name');
    const definition = loadTemplateDefinition(templateName);
    const inputs = buildInputs(definition, flags.inputs, positional.slice(1));
    result = await sendCommand(
      'chain',
      {
        ...commonArgs(flags),
        name: definition.name,
        template: definition.name,
        inputs,
        steps: definition.steps,
        output: definition.output,
        inheritTab: !flags.noInheritTab && definition.inheritTab !== false,
        stopOnError: !flags.continueOnError && definition.stopOnError !== false,
        stopOnBlocked: !flags.continueOnBlocked && definition.stopOnBlocked !== false,
        stopOnUnmatched: !flags.continueOnUnmatched && definition.stopOnUnmatched !== false,
        stopOnAssertion: !flags.continueOnAssertion && definition.stopOnAssertion !== false
      },
      Number(definition.timeoutMs || flags.timeoutMs)
    );
    flags.json ? printJson(result) : printTemplateRunResult(result);
    return;
  }

  if (command === 'smart' || command === 'auto' || command === 'intent' || command === 'run-intent') {
    const intent = positional.join(' ').trim();
    requireArg(intent || Object.keys(flags.inputs).length, 'intent');
    const selection = selectTemplateForIntent(intent, flags.inputs);
    const definition = loadTemplateDefinition(selection.template);
    const inputs = buildInputs(definition, selection.inputs, []);
    result = await sendCommand(
      'chain',
      {
        ...commonArgs(flags),
        name: definition.name,
        template: definition.name,
        intent,
        inputs,
        steps: definition.steps,
        output: definition.output,
        inheritTab: !flags.noInheritTab && definition.inheritTab !== false,
        stopOnError: !flags.continueOnError && definition.stopOnError !== false,
        stopOnBlocked: !flags.continueOnBlocked && definition.stopOnBlocked !== false,
        stopOnUnmatched: !flags.continueOnUnmatched && definition.stopOnUnmatched !== false,
        stopOnAssertion: !flags.continueOnAssertion && definition.stopOnAssertion !== false
      },
      Number(definition.timeoutMs || flags.timeoutMs)
    );
    flags.json
      ? printJson({ selection, result })
      : printSmartRunResult({ ...selection, inputs }, result);
    return;
  }

  if (command === 'chain' || command === 'task') {
    const definition = loadChainDefinition(flags, positional);
    const inputs = buildInputs(definition, flags.inputs, []);
    result = await sendCommand(
      'chain',
      {
        ...commonArgs(flags),
        name: definition.name,
        inputs,
        steps: definition.steps,
        output: definition.output,
        inheritTab: !flags.noInheritTab && definition.inheritTab !== false,
        stopOnError: !flags.continueOnError && definition.stopOnError !== false,
        stopOnBlocked: !flags.continueOnBlocked && definition.stopOnBlocked !== false,
        stopOnUnmatched: !flags.continueOnUnmatched && definition.stopOnUnmatched !== false,
        stopOnAssertion: !flags.continueOnAssertion && definition.stopOnAssertion !== false
      },
      Number(definition.timeoutMs || flags.timeoutMs)
    );
    printJson(result);
    return;
  }

  if (command === 'assert' || command === 'expect') {
    const value = positional.join(' ') || undefined;
    result = await sendCommand(
      'assert',
      {
        ...commonArgs(flags),
        value,
        titleContains: flags.titleContains,
        urlContains: flags.urlContains,
        textContains: flags.textContains,
        selector: flags.selector,
        contains: flags.contains,
        equals: flags.equals,
        matches: flags.matches,
        gte: flags.gte,
        lte: flags.lte,
        truthy: flags.truthy,
        maxChars: flags.maxChars,
        wait: flags.wait,
        waitMs: flags.waitMs,
        timeoutMs: flags.timeoutMs
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'observe') {
    result = await sendCommand(
      'observe',
      {
        ...maybeTab(flags),
        maxChars: flags.maxChars,
        maxElements: flags.maxElements,
        screenshot: Boolean(flags.screenshotPath),
        riskOnly: flags.risk,
        confirm: flags.confirm
      },
      flags.timeoutMs
    );
    if (flags.screenshotPath && result.screenshot && result.screenshot.dataUrl) {
      result.screenshot = { path: savePngDataUrl(result.screenshot.dataUrl, flags.screenshotPath) };
    }
    printJson(result);
    return;
  }

  if (command === 'snapshot') {
    result = await sendCommand(
      'snapshot',
      {
        ...maybeTab(flags),
        maxChars: flags.maxChars,
        maxElements: flags.maxElements,
        screenshot: Boolean(flags.screenshotPath),
        riskOnly: flags.risk,
        confirm: flags.confirm
      },
      flags.timeoutMs
    );
    if (flags.screenshotPath && result.screenshot && result.screenshot.dataUrl) {
      result.screenshot = { path: savePngDataUrl(result.screenshot.dataUrl, flags.screenshotPath) };
    }
    printJson(result);
    return;
  }

  if (command === 'extract') {
    result = await sendCommand(
      'extract',
      {
        ...commonArgs(flags),
        mode: flags.mode,
        limit: flags.limit,
        maxChars: flags.maxChars,
        maxElements: flags.maxElements
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'target' || command === 'find') {
    const query = positional.join(' ');
    requireArg(query, 'query');
    result = await sendCommand(
      'target',
      {
        ...commonArgs(flags),
        query,
        maxElements: flags.maxElements,
        action: flags.action,
        kind: flags.kind,
        exact: flags.exact,
        limit: flags.limit
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'open-target') {
    const query = positional.join(' ');
    requireArg(query, 'query');
    result = await sendCommand(
      'openTarget',
      {
        ...commonArgs(flags),
        query,
        maxElements: flags.maxElements,
        limit: flags.limit,
        exact: flags.exact,
        wait: flags.wait || Boolean(flags.waitFor || flags.waitUntil || flags.waitMs),
        waitFor: flags.waitFor,
        waitUntil: flags.waitUntil,
        waitMs: flags.waitMs,
        quietMs: flags.quietMs
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'fill-target') {
    requireArg(positional[0], 'query');
    const value = positional.slice(1).join(' ');
    requireArg(value, 'value');
    result = await sendCommand(
      'fillTarget',
      {
        ...commonArgs(flags),
        query: positional[0],
        value,
        text: value,
        maxElements: flags.maxElements,
        limit: flags.limit,
        exact: flags.exact,
        submit: flags.submit,
        wait: flags.wait || Boolean(flags.waitFor || flags.waitUntil || flags.waitMs),
        waitFor: flags.waitFor,
        waitUntil: flags.waitUntil,
        waitMs: flags.waitMs,
        quietMs: flags.quietMs
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'search') {
    const searchText = positional.join(' ');
    requireArg(searchText, 'text');
    result = await sendCommand(
      'search',
      {
        ...commonArgs(flags),
        target: flags.target,
        searchText,
        value: searchText,
        text: searchText,
        maxElements: flags.maxElements,
        limit: flags.limit,
        exact: flags.exact,
        wait: true,
        waitFor: flags.waitFor,
        waitUntil: flags.waitUntil,
        waitMs: flags.waitMs,
        quietMs: flags.quietMs
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'search-extract') {
    const searchText = positional.join(' ');
    requireArg(searchText, 'text');
    result = await sendCommand(
      'searchExtract',
      {
        ...commonArgs(flags),
        target: flags.target,
        searchText,
        value: searchText,
        text: searchText,
        maxElements: flags.maxElements,
        maxChars: flags.maxChars,
        limit: flags.limit,
        exact: flags.exact,
        mode: flags.mode,
        wait: true,
        waitFor: flags.waitFor,
        waitUntil: flags.waitUntil,
        waitMs: flags.waitMs,
        quietMs: flags.quietMs
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'act') {
    requireArg(positional[0], 'action id');
    const value = positional.slice(1).join(' ');
    result = await sendCommand(
      'act',
      {
        ...commonArgs(flags),
        id: positional[0],
        action: flags.action,
        value: value || undefined,
        text: value || undefined,
        option: value || undefined,
        key: value || undefined,
        exact: flags.exact,
        submit: flags.submit,
        wait: flags.wait || Boolean(flags.waitFor || flags.waitUntil || flags.waitMs),
        waitFor: flags.waitFor,
        waitUntil: flags.waitUntil,
        waitMs: flags.waitMs,
        quietMs: flags.quietMs
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'read') {
    result = await sendCommand(
      'pageText',
      { ...commonArgs(flags), maxChars: flags.maxChars },
      flags.timeoutMs
    );
    flags.json ? printJson(result) : printPage(result);
    return;
  }

  if (command === 'html') {
    result = await sendCommand(
      'pageHtml',
      { ...commonArgs(flags), maxChars: flags.maxChars },
      flags.timeoutMs
    );
    flags.json ? printJson(result) : console.log(result.html || '');
    return;
  }

  if (command === 'query') {
    requireArg(positional[0], 'selector');
    result = await sendCommand(
      'query',
      { ...commonArgs(flags), selector: positional[0] },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'click') {
    requireArg(positional[0], 'selector');
    result = await sendCommand(
      'click',
      { ...commonArgs(flags), selector: positional[0] },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'clicktext') {
    const text = positional.join(' ');
    requireArg(text, 'text');
    result = await sendCommand(
      'clickText',
      {
        ...commonArgs(flags),
        text,
        selector: flags.selector,
        exact: flags.exact
      },
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
        ...commonArgs(flags),
        selector: positional[0],
        text,
        submit: flags.submit
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'fill') {
    requireArg(positional[0], 'field');
    const text = positional.slice(1).join(' ');
    requireArg(text, 'text');
    result = await sendCommand(
      'fillForm',
      {
        ...commonArgs(flags),
        field: positional[0],
        value: text,
        selector: flags.selector,
        exact: flags.exact,
        submit: flags.submit
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'press') {
    requireArg(positional[0], 'key');
    result = await sendCommand(
      'pressKey',
      {
        ...commonArgs(flags),
        key: positional[0],
        selector: flags.selector,
        submit: flags.submit
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'select') {
    requireArg(positional[0], 'field');
    const option = positional.slice(1).join(' ');
    requireArg(option, 'option');
    result = await sendCommand(
      'selectOption',
      {
        ...commonArgs(flags),
        field: positional[0],
        value: option,
        selector: flags.selector,
        exact: flags.exact
      },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'scroll') {
    const x = Number(positional[0] || 0);
    const y = Number(positional[1] || 0);
    result = await sendCommand('scroll', { ...commonArgs(flags), x, y }, flags.timeoutMs);
    printJson(result);
    return;
  }

  if (command === 'wait') {
    requireArg(positional[0], 'selector');
    result = await sendCommand(
      'waitForSelector',
      {
        ...commonArgs(flags),
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
      { ...commonArgs(flags), url: positional[0] },
      flags.timeoutMs
    );
    printJson(result);
    return;
  }

  if (command === 'screenshot') {
    if (!flags.risk) requireArg(positional[0], 'path');
    result = await sendCommand('screenshot', commonArgs(flags), flags.timeoutMs);
    if (flags.risk) {
      printJson(result);
      return;
    }
    console.log(savePngDataUrl(result.dataUrl, positional[0]));
    return;
  }

  if (command === 'reload') {
    result = await sendCommand('reload', commonArgs(flags), flags.timeoutMs);
    printJson(result);
    return;
  }

  if (command === 'activate') {
    if (!Number.isFinite(flags.tabId)) throw new Error('activate requires --tab <id>');
    result = await sendCommand('activateTab', { ...commonArgs(flags), tabId: flags.tabId }, flags.timeoutMs);
    printJson(result);
    return;
  }

  if (command === 'newtab') {
    requireArg(positional[0], 'url');
    result = await sendCommand('newTab', { riskOnly: flags.risk, confirm: flags.confirm, url: positional[0] }, flags.timeoutMs);
    printJson(result);
    return;
  }

  if (command === 'close') {
    if (!Number.isFinite(flags.tabId)) throw new Error('close requires --tab <id>');
    result = await sendCommand('closeTab', { ...commonArgs(flags), tabId: flags.tabId }, flags.timeoutMs);
    printJson(result);
    return;
  }

  if (command === 'eval') {
    const code = positional.join(' ');
    requireArg(code, 'javascript');
    result = await sendCommand('eval', { ...commonArgs(flags), code }, flags.timeoutMs);
    printJson(result);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
