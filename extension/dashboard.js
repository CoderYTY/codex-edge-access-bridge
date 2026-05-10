(function initDashboard() {
  const DEFAULT_HOST_NAME = 'com.codex.edge_bridge';
  const DEFAULT_SERVER_URL = 'http://127.0.0.1:18888';
  const MAX_LOG_ITEMS = 120;
  const MAX_TRACE_ITEMS = 80;

  const statusText = {
    starting: '启动中',
    connecting: '连接中',
    connected: '已连接',
    paused: '已暂停',
    error: '异常'
  };

  const commandNames = {
    tabs: '列出标签页',
    activeTab: '读取当前标签页',
    activateTab: '切换标签页',
    chain: '任务链',
    smart: '智能模板',
    assert: '断言检查',
    expect: '断言检查',
    observe: '观察页面',
    snapshot: 'AI 快照',
    target: '语义定位',
    extract: '结构化抽取',
    act: 'AI 编号动作',
    openTarget: '打开语义目标',
    fillTarget: '填写语义目标',
    search: '语义搜索',
    searchExtract: '搜索并抽取',
    trace: '操作轨迹',
    newTab: '新建标签页',
    closeTab: '关闭标签页',
    reload: '刷新标签页',
    navigate: '导航页面',
    screenshot: '截取页面',
    pageText: '读取页面文本',
    pageHtml: '读取页面 HTML',
    query: '查询页面元素',
    click: '点击页面元素',
    clickText: '按文本点击',
    type: '输入文本',
    fillForm: '智能填表',
    pressKey: '按键操作',
    selectOption: '选择下拉项',
    scroll: '滚动页面',
    waitForSelector: '等待页面元素',
    waitForPageStable: '等待页面稳定',
    eval: '执行页面脚本'
  };

  const elements = {
    statusBadge: document.getElementById('statusBadge'),
    serverUrl: document.getElementById('serverUrl'),
    hostName: document.getElementById('hostName'),
    bridgeUrl: document.getElementById('bridgeUrl'),
    saveButton: document.getElementById('saveButton'),
    startButton: document.getElementById('startButton'),
    stopButton: document.getElementById('stopButton'),
    copyServerButton: document.getElementById('copyServerButton'),
    copyHostButton: document.getElementById('copyHostButton'),
    copyStatusButton: document.getElementById('copyStatusButton'),
    copyInstallButton: document.getElementById('copyInstallButton'),
    clearLogButton: document.getElementById('clearLogButton'),
    runDiagnosticsButton: document.getElementById('runDiagnosticsButton'),
    copyDiagnosticsButton: document.getElementById('copyDiagnosticsButton'),
    diagnosticsSummary: document.getElementById('diagnosticsSummary'),
    diagnosticsList: document.getElementById('diagnosticsList'),
    clientId: document.getElementById('clientId'),
    lastSeen: document.getElementById('lastSeen'),
    lastCommand: document.getElementById('lastCommand'),
    log: document.getElementById('log'),
    toast: document.getElementById('toast'),
    filters: [...document.querySelectorAll('.filter-button')],
    checks: {
      extension: document.getElementById('checkExtension'),
      client: document.getElementById('checkClient'),
      native: document.getElementById('checkNative'),
      bridge: document.getElementById('checkBridge')
    }
  };

  let clientId = '';
  let nativePort = null;
  let running = false;
  let reconnectTimer = null;
  let manualDisconnect = false;
  let currentFilter = 'all';
  let currentStatus = 'starting';
  let lastStatusPayload = null;
  let lastDiagnostics = [];
  let diagnosticsRunning = false;
  let toastTimer = null;
  const logs = [];
  const traceItems = [];

  function commandLabel(name) {
    return commandNames[name] || name || '未知命令';
  }

  function previewText(value, maxChars = 160) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxChars) return { value: text, length: text.length, truncated: false };
    return { value: text.slice(0, maxChars), length: text.length, truncated: true };
  }

  function compactTab(tab) {
    if (!tab) return null;
    return {
      id: tab.id,
      active: Boolean(tab.active),
      status: tab.status || '',
      title: tab.title || '',
      url: tab.url || ''
    };
  }

  function compactRisk(risk) {
    if (!risk) return null;
    return {
      level: risk.level || '',
      action: risk.action || '',
      reason: risk.reason || '',
      requiresConfirmation: Boolean(risk.requiresConfirmation),
      matchedTerms: risk.matchedTerms || []
    };
  }

  function compactActionItem(item) {
    if (!item) return null;
    return {
      id: item.id || '',
      action: item.action || '',
      kind: item.kind || '',
      label: item.label || item.text || '',
      risk: item.risk ? compactRisk(item.risk) : null
    };
  }

  function compactTargetItem(item) {
    if (!item) return null;
    return {
      ...compactActionItem(item),
      score: item.score,
      reasons: item.reasons || []
    };
  }

  function summarizeTraceArgs(command) {
    const args = command.args || {};
    const summary = {};
    const copyKeys = [
      'tabId',
      'id',
      'action',
      'selector',
      'field',
      'label',
      'name',
      'placeholder',
      'url',
      'maxChars',
      'maxElements',
      'mode',
      'name',
      'template',
      'intent',
      'inheritTab',
      'stopOnError',
      'stopOnBlocked',
      'stopOnUnmatched',
      'stopOnAssertion',
      'titleContains',
      'urlContains',
      'textContains',
      'contains',
      'equals',
      'matches',
      'gte',
      'lte',
      'truthy',
      'riskOnly',
      'confirm',
      'submit',
      'wait',
      'waitFor',
      'waitUntil',
      'waitMs',
      'quietMs',
      'kind',
      'target',
      'query',
      'searchText',
      'queryText',
      'limit'
    ];

    for (const key of copyKeys) {
      if (args[key] !== undefined) summary[key] = args[key];
    }

    if (Array.isArray(args.steps)) {
      summary.stepCount = args.steps.length;
      summary.steps = args.steps.slice(0, 20).map((step, index) => ({
        index: index + 1,
        name: step.name || step.command || '',
        label: step.label || step.title || '',
        saveAs: step.saveAs || step.as || '',
        retry: step.retry || step.retries || undefined
      }));
    }

    if (args.output !== undefined) {
      summary.output = compactOutputValue(args.output);
    }

    if (args.inputs !== undefined) {
      summary.inputs = compactOutputValue(args.inputs);
    }

    if (command.name === 'clickText' && args.text !== undefined) {
      summary.text = previewText(args.text, 120);
    }

    for (const key of ['text', 'value', 'option', 'key', 'code']) {
      if (args[key] !== undefined && summary[key] === undefined) {
        summary[`${key}Length`] = String(args[key] ?? '').length;
      }
    }

    return summary;
  }

  function compactExtraction(result) {
    if (!result || typeof result !== 'object' || (!result.summary && !result.links && !result.cards && !result.results && !result.article)) {
      return null;
    }

    const compactItem = (item) => ({
      title: item.title || '',
      href: item.href || '',
      text: item.text ? previewText(item.text, 180) : undefined,
      actionId: item.actionId || '',
      action: item.action || '',
      risk: item.risk ? compactRisk(item.risk) : null
    });

    return {
      mode: result.mode || '',
      title: result.title || '',
      url: result.url || '',
      snapshotId: result.snapshotId || '',
      text: result.summary && typeof result.summary.text === 'string'
        ? previewText(result.summary.text, 240)
        : undefined,
      article: result.article
        ? {
            title: result.article.title || '',
            author: result.article.author || '',
            published: result.article.published || '',
            text: result.article.text ? previewText(result.article.text, 240) : undefined
          }
        : undefined,
      links: Array.isArray(result.links) ? result.links.slice(0, 12).map(compactItem) : undefined,
      cards: Array.isArray(result.cards) ? result.cards.slice(0, 12).map(compactItem) : undefined,
      results: Array.isArray(result.results) ? result.results.slice(0, 12).map(compactItem) : undefined,
      counts: {
        links: Array.isArray(result.links) ? result.links.length : undefined,
        cards: Array.isArray(result.cards) ? result.cards.length : undefined,
        results: Array.isArray(result.results) ? result.results.length : undefined
      }
    };
  }

  function compactOutputValue(value, depth = 0) {
    if (typeof value === 'string') return previewText(value, 320);
    if (value === null || value === undefined || typeof value !== 'object') return value ?? null;
    if (depth >= 3) return Array.isArray(value) ? { count: value.length } : '[object]';
    if (Array.isArray(value)) return value.slice(0, 12).map((item) => compactOutputValue(item, depth + 1));
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 24)
        .map(([key, item]) => [key, compactOutputValue(item, depth + 1)])
    );
  }

  function summarizeTraceResult(name, result) {
    if (Array.isArray(result)) {
      return {
        count: result.length,
        items: result.slice(0, 20).map(compactTab)
      };
    }

    if (!result || typeof result !== 'object') return { value: result ?? null };

    const summary = {};
    if (result.tab) summary.tab = compactTab(result.tab);
    if (result.risk) summary.risk = compactRisk(result.risk);
    if (result.blocked !== undefined) summary.blocked = Boolean(result.blocked);
    if (result.requiresConfirmation !== undefined) summary.requiresConfirmation = Boolean(result.requiresConfirmation);
    if (result.snapshotId) summary.snapshotId = result.snapshotId;
    if ((name === 'act' || result.semantic) && result.id) summary.actionId = result.id;
    if (result.action) summary.action = result.action;
    if (result.semantic) summary.semantic = result.semantic;

    for (const key of ['acted', 'clicked', 'filled', 'selected', 'pressed', 'typed', 'submitted', 'closed', 'reloaded']) {
      if (result[key] !== undefined) summary[key] = result[key];
    }

    if (result.title || result.url) {
      summary.page = {
        title: result.title || '',
        url: result.url || ''
      };
    }

    if (typeof result.text === 'string') {
      summary.text = previewText(result.text, 240);
      summary.truncated = Boolean(result.truncated);
    }

    if (Array.isArray(result.headings)) {
      summary.headings = result.headings.slice(0, 12);
    }

    if (Array.isArray(result.actions)) {
      summary.actionCount = result.actions.length;
      summary.actions = result.actions.slice(0, 24).map(compactActionItem);
      summary.actionCounts = result.actionCounts || undefined;
    }

    if (Array.isArray(result.matches)) {
      summary.query = result.query || '';
      summary.matchCount = result.count ?? result.matches.length;
      summary.best = compactTargetItem(result.best);
      summary.matches = result.matches.slice(0, 12).map(compactTargetItem);
      summary.snapshotId = result.snapshotId || summary.snapshotId;
    }

    if (result.target) {
      summary.target = {
        query: result.target.query || '',
        snapshotId: result.target.snapshotId || '',
        matchCount: result.target.count ?? (result.target.matches ? result.target.matches.length : 0),
        best: compactTargetItem(result.target.best),
        matches: Array.isArray(result.target.matches)
          ? result.target.matches.slice(0, 8).map(compactTargetItem)
          : []
      };
      summary.snapshotId = result.target.snapshotId || summary.snapshotId;
    }

    if (result.act) {
      summary.act = {
        blocked: Boolean(result.act.blocked),
        requiresConfirmation: Boolean(result.act.requiresConfirmation),
        actionId: result.act.id || '',
        action: result.act.action || '',
        acted: Boolean(result.act.acted),
        clicked: Boolean(result.act.clicked),
        filled: Boolean(result.act.filled),
        submitted: Boolean(result.act.submitted),
        risk: compactRisk(result.act.risk)
      };
    }

    if (result.asserted !== undefined) {
      summary.assertion = {
        asserted: Boolean(result.asserted),
        count: result.count || 0,
        failedCount: result.failedCount || 0,
        message: result.message || '',
        checks: Array.isArray(result.checks)
          ? result.checks.slice(0, 12).map((check) => ({
              name: check.name,
              passed: Boolean(check.passed),
              actual: typeof check.actual === 'string' ? previewText(check.actual, 160) : check.actual,
              expected: check.expected,
              error: check.error || ''
            }))
          : []
      };
    }

    if (Array.isArray(result.steps)) {
      summary.chain = {
        status: result.status || (result.risk ? 'risk' : ''),
        ok: result.ok === undefined ? true : Boolean(result.ok),
        stepCount: result.stepCount || result.steps.length,
        completed: result.completed || 0,
        stoppedAt: result.stoppedAt || null,
        stoppedReason: result.stoppedReason || '',
        currentTabId: result.currentTabId || null,
        inputs: result.inputs ? compactOutputValue(result.inputs) : undefined,
        variables: result.variables || [],
        output: result.output !== undefined ? compactOutputValue(result.output) : undefined,
        steps: result.steps.slice(0, 12).map((step) => ({
          index: step.index,
          name: step.name,
          label: step.label || commandLabel(step.name),
          saveAs: step.saveAs || '',
          status: step.status || '',
          durationMs: step.durationMs,
          attempts: Array.isArray(step.attempts) ? step.attempts : undefined,
          risk: step.risk ? compactRisk(step.risk) : null,
          error: step.error || '',
          result: step.result ? summarizeTraceResult(step.name, step.result) : undefined
        }))
      };
    }

    if (result.search) {
      summary.search = summarizeTraceResult('search', result.search);
    }

    if (result.extraction) {
      summary.extraction = compactExtraction(result.extraction);
    } else {
      const extraction = compactExtraction(result);
      if (extraction) summary.extraction = extraction;
    }

    if (Array.isArray(result.elements)) {
      summary.elementCount = result.count ?? result.elements.length;
      summary.elements = result.elements.slice(0, 12).map((item) => ({
        selector: item.selector,
        kind: item.kind,
        text: item.text || item.label || item.placeholder || '',
        risk: item.risk ? compactRisk(item.risk) : null
      }));
    }

    if (result.wait) {
      summary.wait = {
        ok: Boolean(result.wait.ok),
        mode: result.wait.mode || '',
        selector: result.wait.selector || '',
        waitedMs: result.wait.waitedMs,
        error: result.wait.error || '',
        stability: result.wait.stability || undefined,
        tab: compactTab(result.wait.tab)
      };
    }

    if (result.dataUrl) {
      summary.screenshot = { dataUrlLength: String(result.dataUrl).length };
    } else if (result.screenshot) {
      summary.screenshot = result.screenshot.dataUrl
        ? { dataUrlLength: String(result.screenshot.dataUrl).length }
        : result.screenshot;
    }

    if (name === 'eval' && result.value !== undefined) {
      summary.value = typeof result.value === 'string'
        ? previewText(result.value, 240)
        : result.value;
    }

    return summary;
  }

  function recordTrace(command, status, details) {
    const entry = {
      id: command.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      command: command.name,
      label: commandLabel(command.name),
      status,
      startedAt: new Date(details.startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: details.durationMs,
      args: summarizeTraceArgs(command)
    };

    if (status === 'ok') {
      entry.result = summarizeTraceResult(command.name, details.result);
    } else {
      entry.error = details.error || 'Unknown error';
    }

    traceItems.unshift(entry);
    if (traceItems.length > MAX_TRACE_ITEMS) traceItems.pop();
  }

  function buildTraceResult(args = {}) {
    const limit = Math.max(1, Math.min(Number(args.limit || 20), MAX_TRACE_ITEMS));
    const clear = Boolean(args.clear);
    const result = {
      count: traceItems.length,
      limit,
      items: traceItems.slice(0, limit)
    };

    if (clear) {
      result.cleared = traceItems.length;
      traceItems.length = 0;
      result.count = 0;
      result.items = [];
    }

    return result;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elements.toast.classList.remove('visible');
    }, 1800);
  }

  function setStatus(status, detail, level) {
    currentStatus = status;
    elements.statusBadge.textContent = statusText[status] || status;
    elements.statusBadge.dataset.status = status;
    if (detail) appendLog(level || (status === 'error' ? 'error' : 'info'), detail);
  }

  function setCheck(name, state, detail) {
    const item = elements.checks[name];
    if (!item) return;
    item.dataset.state = state;
    const detailNode = item.querySelector('small');
    if (detailNode && detail) detailNode.textContent = detail;
  }

  function appendLog(level, message) {
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      level,
      message,
      time: new Date()
    };
    logs.unshift(item);
    if (logs.length > MAX_LOG_ITEMS) logs.pop();
    renderLogs();
  }

  function renderLogs() {
    const visibleLogs = currentFilter === 'all'
      ? logs
      : logs.filter((item) => item.level === currentFilter);

    elements.log.textContent = '';

    if (!visibleLogs.length) {
      const empty = document.createElement('div');
      empty.className = 'log-empty';
      empty.textContent = '暂无日志';
      elements.log.appendChild(empty);
      return;
    }

    for (const item of visibleLogs) {
      const row = document.createElement('div');
      row.className = `log-item log-${item.level}`;

      const meta = document.createElement('span');
      meta.className = 'log-meta';
      meta.textContent = item.time.toLocaleTimeString();

      const text = document.createElement('span');
      text.className = 'log-message';
      text.textContent = item.message;

      row.append(meta, text);
      elements.log.appendChild(row);
    }
  }

  async function copyText(text, successMessage) {
    const value = String(text || '').trim();
    if (!value) {
      showToast('没有可复制的内容');
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }

    showToast(successMessage || '已复制');
  }

  async function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  async function storageSet(values) {
    return chrome.storage.local.set(values);
  }

  async function ensureClientId() {
    const stored = await storageGet(['clientId']);
    if (stored.clientId) {
      clientId = stored.clientId;
    } else {
      clientId = `edge_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
      await storageSet({ clientId });
    }
    elements.clientId.textContent = clientId;
    setCheck('client', 'ok', '客户端身份已就绪');
  }

  async function loadSettings() {
    const stored = await storageGet(['serverUrl', 'hostName']);
    elements.serverUrl.value = stored.serverUrl || DEFAULT_SERVER_URL;
    elements.hostName.value = stored.hostName || DEFAULT_HOST_NAME;
    elements.bridgeUrl.textContent = elements.serverUrl.value;
    setCheck('extension', 'ok', `扩展 ID：${chrome.runtime.id}`);
    await ensureClientId();
  }

  async function saveSettings() {
    const serverUrl = elements.serverUrl.value.trim() || DEFAULT_SERVER_URL;
    const hostName = elements.hostName.value.trim() || DEFAULT_HOST_NAME;
    await storageSet({ serverUrl, hostName });
    elements.serverUrl.value = serverUrl;
    elements.hostName.value = hostName;
    elements.bridgeUrl.textContent = serverUrl;
    setCheck('bridge', serverUrl ? 'ok' : 'pending', serverUrl || '等待 CLI 地址');
    appendLog('success', '配置已保存');
    showToast('配置已保存');
  }

  function postNativeMessage(message) {
    if (!nativePort) {
      throw new Error('Native Host 尚未连接');
    }
    nativePort.postMessage(message);
  }

  function sendHello() {
    postNativeMessage({
      type: 'hello',
      clientId,
      extensionVersion: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent
    });
  }

  function updateFromStatus(status) {
    if (!status) return;
    lastStatusPayload = status;
    if (status.host && status.port) {
      const url = `http://${status.host}:${status.port}`;
      elements.serverUrl.value = url;
      elements.bridgeUrl.textContent = url;
      setCheck('bridge', 'ok', url);
    }
    if (status.nativeConnected) {
      setCheck('native', 'ok', 'Native Host 正在工作');
    }
    elements.lastSeen.textContent = new Date().toLocaleTimeString();
  }

  function statusSummary() {
    const lines = [
      `连接状态：${statusText[currentStatus] || currentStatus}`,
      `客户端：${clientId || '-'}`,
      `CLI 地址：${elements.serverUrl.value || '-'}`,
      `Native Host：${elements.hostName.value || '-'}`,
      `扩展 ID：${chrome.runtime.id}`,
      `最近心跳：${elements.lastSeen.textContent || '-'}`,
      `最近命令：${elements.lastCommand.textContent || '-'}`
    ];

    if (lastStatusPayload) {
      lines.push(`待处理命令：${lastStatusPayload.pendingCommands ?? 0}`);
    }

    return lines.join('\n');
  }

  function installCommand() {
    const hostName = elements.hostName.value.trim() || DEFAULT_HOST_NAME;
    return `powershell -ExecutionPolicy Bypass -File .\\scripts\\install-native-host.ps1 -ExtensionId "${chrome.runtime.id}" -HostName "${hostName}"`;
  }

  function setDiagnosticsSummary(title, detail, state) {
    elements.diagnosticsSummary.dataset.state = state || 'pending';
    elements.diagnosticsSummary.textContent = '';

    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = detail;
    elements.diagnosticsSummary.append(strong, span);
  }

  function renderDiagnostics(results) {
    elements.diagnosticsList.textContent = '';

    if (!results.length) {
      const empty = document.createElement('div');
      empty.className = 'diagnostic-item';
      empty.dataset.state = 'pending';
      empty.innerHTML = '<span></span><div><strong>等待自检</strong><small>自检结果会按步骤显示在这里。</small></div>';
      elements.diagnosticsList.appendChild(empty);
      return;
    }

    for (const result of results) {
      const item = document.createElement('div');
      item.className = 'diagnostic-item';
      item.dataset.state = result.state;

      const dot = document.createElement('span');
      const content = document.createElement('div');
      const title = document.createElement('strong');
      const detail = document.createElement('small');

      title.textContent = result.title;
      detail.textContent = result.detail;
      content.append(title, detail);
      item.append(dot, content);
      elements.diagnosticsList.appendChild(item);
    }
  }

  function diagnosticReport() {
    if (!lastDiagnostics.length) return '尚未运行诊断';
    const lines = [
      'Codex Edge 控制台诊断报告',
      `生成时间：${new Date().toLocaleString()}`,
      `连接状态：${statusText[currentStatus] || currentStatus}`,
      `扩展 ID：${chrome.runtime.id}`,
      `CLI 地址：${elements.serverUrl.value || '-'}`,
      `Native Host：${elements.hostName.value || '-'}`,
      ''
    ];

    for (const item of lastDiagnostics) {
      const stateLabel = item.state === 'ok'
        ? '通过'
        : item.state === 'warn'
          ? '提醒'
          : item.state === 'skip'
            ? '跳过'
            : '失败';
      lines.push(`[${stateLabel}] ${item.title}：${item.detail}`);
    }

    return lines.join('\n');
  }

  function withTimeout(promise, timeoutMs, errorMessage) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
  }

  async function fetchHealth() {
    const url = elements.serverUrl.value.trim() || DEFAULT_SERVER_URL;
    const response = await withTimeout(fetch(new URL('/health', url).toString(), {
      cache: 'no-store'
    }), 3000, 'CLI 健康接口 3 秒内没有响应');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  function findReadableTab(tabs) {
    return tabs.find((tab) => {
      const url = tab.url || '';
      if (url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return false;
      return /^(https?:|file:)/.test(url);
    });
  }

  async function runDiagnostics() {
    if (diagnosticsRunning) return;
    diagnosticsRunning = true;
    elements.runDiagnosticsButton.disabled = true;
    elements.runDiagnosticsButton.textContent = '自检中...';
    setDiagnosticsSummary('正在自检', '正在逐项检查本机桥接能力。', 'pending');

    const results = [];
    const push = (state, title, detail) => {
      results.push({ state, title, detail });
      lastDiagnostics = [...results];
      renderDiagnostics(results);
    };

    try {
      appendLog('info', '开始运行一键自检');

      push('ok', '扩展运行状态', `扩展页面已加载，扩展 ID：${chrome.runtime.id}`);

      if (clientId) {
        push('ok', '客户端身份', `客户端 ID：${clientId}`);
      } else {
        push('error', '客户端身份', '未生成客户端 ID，请刷新控制台页面');
      }

      if (nativePort && currentStatus === 'connected') {
        push('ok', 'Native Host 连接', 'Native Messaging 通道处于已连接状态');
      } else if (nativePort) {
        push('warn', 'Native Host 连接', `当前状态：${statusText[currentStatus] || currentStatus}`);
      } else {
        push('error', 'Native Host 连接', 'Native Messaging 通道未连接');
      }

      try {
        const health = await fetchHealth();
        if (health.ok) {
          const pending = health.pendingCommands ?? 0;
          const client = health.client && health.client.clientId ? `，客户端：${health.client.clientId}` : '';
          push('ok', 'CLI 健康接口', `本机桥接接口可访问，待处理命令：${pending}${client}`);
          updateFromStatus(health);
        } else {
          push('error', 'CLI 健康接口', '接口返回了非健康状态');
        }
      } catch (error) {
        push('error', 'CLI 健康接口', error.message);
      }

      let tabs = [];
      try {
        tabs = await withTimeout(
          window.EdgeCodexExecutor.execute({ name: 'tabs', args: {} }),
          5000,
          '5 秒内没有返回标签页列表'
        );
        push('ok', '标签页能力', `已读取 ${tabs.length} 个标签页`);
      } catch (error) {
        push('error', '标签页能力', error.message);
      }

      const readableTab = findReadableTab(tabs);
      if (readableTab) {
        try {
          const page = await withTimeout(
            window.EdgeCodexExecutor.execute({
              name: 'pageText',
              args: { tabId: readableTab.id, maxChars: 800 }
            }),
            7000,
            '7 秒内没有读到页面文本'
          );
          const textLength = page && page.text ? page.text.length : 0;
          push('ok', '页面读取能力', `已读取标签页“${readableTab.title || readableTab.url}”，文本长度 ${textLength}`);
        } catch (error) {
          push('warn', '页面读取能力', `目标标签页“${readableTab.title || readableTab.url}”读取失败：${error.message}`);
        }
      } else {
        push('skip', '页面读取能力', '当前只有扩展页或受限页面，已跳过普通网页读取测试');
      }

      try {
        const activeTab = tabs.find((tab) => tab.active) || tabs[0];
        if (!activeTab) throw new Error('没有可截图的标签页');
        const screenshot = await withTimeout(
          window.EdgeCodexExecutor.execute({
            name: 'screenshot',
            args: { tabId: activeTab.id }
          }),
          7000,
          '7 秒内没有完成截图'
        );
        const length = screenshot && screenshot.dataUrl ? screenshot.dataUrl.length : 0;
        if (length > 100) {
          push('ok', '截图能力', `已完成可见区域截图，数据长度 ${length}`);
        } else {
          push('warn', '截图能力', '截图返回数据较短，请确认页面可见');
        }
      } catch (error) {
        push('warn', '截图能力', error.message);
      }

      const failed = results.filter((item) => item.state === 'error').length;
      const warned = results.filter((item) => item.state === 'warn').length;
      const skipped = results.filter((item) => item.state === 'skip').length;
      if (failed) {
        const extra = skipped ? `，${skipped} 项跳过` : '';
        setDiagnosticsSummary('自检发现问题', `${failed} 项失败，${warned} 项提醒${extra}。`, 'error');
        appendLog('error', `一键自检完成：${failed} 项失败，${warned} 项提醒${extra}`);
      } else if (warned) {
        const extra = skipped ? `，${skipped} 项跳过` : '';
        setDiagnosticsSummary('自检基本通过', `${warned} 项提醒${extra}，其余能力正常。`, 'warn');
        appendLog('warn', `一键自检完成：${warned} 项提醒${extra}`);
      } else if (skipped) {
        setDiagnosticsSummary('自检通过', `${skipped} 项因当前没有普通网页而跳过，其余能力正常。`, 'ok');
        appendLog('success', `一键自检通过：${skipped} 项跳过`);
      } else {
        setDiagnosticsSummary('自检全部通过', '扩展、Native Host、CLI、标签页、读取和截图能力均可用。', 'ok');
        appendLog('success', '一键自检全部通过');
      }
    } finally {
      diagnosticsRunning = false;
      elements.runDiagnosticsButton.disabled = false;
      elements.runDiagnosticsButton.textContent = '开始自检';
    }
  }

  async function handleCommand(command) {
    const label = commandLabel(command.name);
    elements.lastCommand.textContent = `${label}（${command.id}）`;

    if (command.name === 'trace') {
      postNativeMessage({
        type: 'result',
        id: command.id,
        ok: true,
        result: buildTraceResult(command.args || {})
      });
      appendLog('info', '已返回操作轨迹');
      return;
    }

    const startedAt = Date.now();
    appendLog('info', `正在执行：${label}`);

    try {
      const result = await window.EdgeCodexExecutor.execute(command);
      recordTrace(command, 'ok', {
        startedAt,
        durationMs: Date.now() - startedAt,
        result
      });
      postNativeMessage({
        type: 'result',
        id: command.id,
        ok: true,
        result
      });
      appendLog('success', `命令完成：${label}`);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      postNativeMessage({
        type: 'result',
        id: command.id,
        ok: false,
        error: message
      });
      recordTrace(command, 'error', {
        startedAt,
        durationMs: Date.now() - startedAt,
        error: message
      });
      appendLog('error', `命令失败：${label}，${message}`);
    }
  }

  function handleNativeMessage(message) {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'ready' || message.type === 'pong') {
      updateFromStatus(message.status);
      setStatus('connected', 'Native Host 已就绪，Codex 可以发送浏览器命令', 'success');
      return;
    }

    if (message.type === 'hostError') {
      updateFromStatus(message.status);
      setCheck('native', 'error', message.error || 'Native Host 返回异常');
      setStatus('error', message.error || 'Native Host 异常', 'error');
      return;
    }

    if (message.type === 'command') {
      updateFromStatus(null);
      handleCommand(message.command).catch((error) => {
        appendLog('error', `命令处理异常：${error.message}`);
      });
      return;
    }

    appendLog('warn', `忽略未知消息：${message.type || '缺少类型'}`);
  }

  function connectNative() {
    if (nativePort) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    manualDisconnect = false;

    const hostName = elements.hostName.value.trim() || DEFAULT_HOST_NAME;
    setCheck('native', 'pending', `正在连接：${hostName}`);
    setStatus('connecting', `正在连接 Native Host：${hostName}`, 'info');

    try {
      nativePort = chrome.runtime.connectNative(hostName);
    } catch (error) {
      setCheck('native', 'error', error.message);
      setStatus('error', error.message, 'error');
      nativePort = null;
      running = false;
      return;
    }

    running = true;

    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      const message = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : 'Native Host 已断开';
      nativePort = null;
      running = false;
      setCheck('native', manualDisconnect ? 'pending' : 'warn', message);
      setStatus(manualDisconnect ? 'paused' : 'connecting', message, manualDisconnect ? 'warn' : 'info');
      if (manualDisconnect) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectNative();
      }, 1200);
    });

    sendHello();
  }

  function disconnectNative() {
    running = false;
    manualDisconnect = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (nativePort) {
      nativePort.disconnect();
      nativePort = null;
    }
    setCheck('native', 'pending', '已手动断开');
    setStatus('paused', '已手动断开 Native Host', 'warn');
  }

  elements.saveButton.addEventListener('click', () => {
    saveSettings().catch((error) => appendLog('error', `保存失败：${error.message}`));
  });
  elements.startButton.addEventListener('click', () => {
    if (nativePort) disconnectNative();
    setTimeout(connectNative, 100);
  });
  elements.stopButton.addEventListener('click', disconnectNative);
  elements.copyServerButton.addEventListener('click', () => {
    copyText(elements.serverUrl.value, 'CLI 地址已复制').catch((error) => appendLog('error', `复制失败：${error.message}`));
  });
  elements.copyHostButton.addEventListener('click', () => {
    copyText(elements.hostName.value, 'Native Host 名称已复制').catch((error) => appendLog('error', `复制失败：${error.message}`));
  });
  elements.copyStatusButton.addEventListener('click', () => {
    copyText(statusSummary(), '状态摘要已复制').catch((error) => appendLog('error', `复制失败：${error.message}`));
  });
  elements.copyInstallButton.addEventListener('click', () => {
    copyText(installCommand(), '注册命令已复制').catch((error) => appendLog('error', `复制失败：${error.message}`));
  });
  elements.clearLogButton.addEventListener('click', () => {
    logs.length = 0;
    renderLogs();
    showToast('日志已清空');
  });
  elements.runDiagnosticsButton.addEventListener('click', () => {
    runDiagnostics().catch((error) => {
      setDiagnosticsSummary('自检异常中断', error.message, 'error');
      appendLog('error', `自检异常中断：${error.message}`);
    });
  });
  elements.copyDiagnosticsButton.addEventListener('click', () => {
    copyText(diagnosticReport(), '诊断报告已复制').catch((error) => appendLog('error', `复制失败：${error.message}`));
  });

  for (const button of elements.filters) {
    button.addEventListener('click', () => {
      currentFilter = button.dataset.filter || 'all';
      for (const item of elements.filters) item.classList.toggle('active', item === button);
      renderLogs();
    });
  }

  setStatus('starting', '控制台正在初始化', 'info');
  renderLogs();

  loadSettings()
    .then(() => {
      appendLog('success', '控制台初始化完成');
      connectNative();
    })
    .catch((error) => {
      setCheck('extension', 'error', error.message);
      setStatus('error', `初始化失败：${error.message}`, 'error');
    });
})();
