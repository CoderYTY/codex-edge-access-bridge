window.EdgeCodexExecutor = (function createExecutor() {
  const CONTENT_TARGET = 'edge-codex-content-v2.6';
  const MAX_CHAIN_STEPS = 25;

  function lastError() {
    return chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
  }

  function tabsQuery(queryInfo) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query(queryInfo, (tabs) => {
        const error = lastError();
        if (error) reject(new Error(error));
        else resolve(tabs || []);
      });
    });
  }

  function tabsGet(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, (tab) => {
        const error = lastError();
        if (error) reject(new Error(error));
        else resolve(tab);
      });
    });
  }

  function tabsUpdate(tabId, updateProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.update(tabId, updateProperties, (tab) => {
        const error = lastError();
        if (error) reject(new Error(error));
        else resolve(tab);
      });
    });
  }

  function tabsCreate(createProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(createProperties, (tab) => {
        const error = lastError();
        if (error) reject(new Error(error));
        else resolve(tab);
      });
    });
  }

  function tabsRemove(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.remove(tabId, () => {
        const error = lastError();
        if (error) reject(new Error(error));
        else resolve({ closed: true, tabId });
      });
    });
  }

  function tabsReload(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.reload(tabId, {}, () => {
        const error = lastError();
        if (error) reject(new Error(error));
        else resolve({ reloaded: true, tabId });
      });
    });
  }

  function windowsUpdate(windowId, updateInfo) {
    return new Promise((resolve, reject) => {
      chrome.windows.update(windowId, updateInfo, (windowInfo) => {
        const error = lastError();
        if (error) reject(new Error(error));
        else resolve(windowInfo);
      });
    });
  }

  function executeScript(tabId, files) {
    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript({ target: { tabId }, files }, (result) => {
        const error = lastError();
        if (error) reject(new Error(error));
        else resolve(result);
      });
    });
  }

  function sendMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = lastError();
        if (error) {
          reject(new Error(error));
          return;
        }
        if (!response) {
          reject(new Error('No response from content script'));
          return;
        }
        if (!response.ok) {
          reject(new Error(response.error || 'Content script failed'));
          return;
        }
        resolve(response.result);
      });
    });
  }

  function captureVisibleTab(windowId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
        const error = lastError();
        if (error) reject(new Error(error));
        else resolve(dataUrl);
      });
    });
  }

  function waitForComplete(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(`Tab ${tabId} did not finish loading in ${timeoutMs} ms`));
      }, timeoutMs);

      const listener = (updatedTabId, changeInfo, tab) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(tab);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      tabsGet(tabId)
        .then((tab) => {
          if (tab.status === 'complete') {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(tab);
          }
        })
        .catch((error) => {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          reject(error);
        });
    });
  }

  function normalizeTab(tab) {
    if (!tab) return null;
    return {
      id: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      active: tab.active,
      pinned: tab.pinned,
      audible: tab.audible,
      status: tab.status,
      title: tab.title,
      url: tab.url
    };
  }

  function risk(level, action, reason, details) {
    return {
      level,
      action,
      reason,
      requiresConfirmation: level === 'high',
      ...(details || {})
    };
  }

  function normalizeChainSteps(rawSteps) {
    if (!Array.isArray(rawSteps)) throw new Error('chain steps must be an array');
    if (rawSteps.length > MAX_CHAIN_STEPS) throw new Error(`chain supports at most ${MAX_CHAIN_STEPS} steps`);

    return rawSteps.map((step, index) => {
      const normalized = typeof step === 'string'
        ? { name: step, args: {} }
        : step;
      if (!normalized || typeof normalized !== 'object') {
        throw new Error(`chain step ${index + 1} must be an object`);
      }

      const name = String(normalized.name || normalized.command || '').trim();
      if (!name) throw new Error(`chain step ${index + 1} is missing name`);
      if (name === 'chain') throw new Error('nested chain steps are not supported');
      if (name === 'trace') throw new Error('trace is managed by the dashboard and cannot run inside a chain');

      return {
        index: index + 1,
        name,
        label: normalized.label || normalized.title || '',
        saveAs: normalizeSaveAs(normalized.saveAs || normalized.as || ''),
        inheritTab: normalized.inheritTab,
        retry: normalized.retry,
        retries: normalized.retries,
        retryDelayMs: normalized.retryDelayMs,
        args: normalized.args && typeof normalized.args === 'object' ? normalized.args : {}
      };
    });
  }

  function chainRisk(args) {
    let steps = [];
    try {
      steps = normalizeChainSteps(args && args.steps);
    } catch (error) {
      return risk('high', 'chain', error.message, { steps: [] });
    }

    const stepRisks = steps.map((step) => ({
      index: step.index,
      name: step.name,
      label: step.label,
      saveAs: step.saveAs,
      risk: commandRisk(step.name, step.args)
    }));
    const hasHigh = stepRisks.some((step) => step.risk && step.risk.level === 'high');
    const hasMedium = stepRisks.some((step) => step.risk && step.risk.level === 'medium');
    const level = hasHigh ? 'high' : (hasMedium ? 'medium' : 'low');

    return risk(level, 'chain', `任务链包含 ${steps.length} 个步骤`, {
      stepCount: steps.length,
      steps: stepRisks
    });
  }

  function commandRisk(name, args) {
    if (name === 'chain') {
      return chainRisk(args || {});
    }

    if (['tabs', 'activeTab', 'observe', 'snapshot', 'target', 'extract', 'assert', 'expect', 'pageText', 'pageHtml', 'query', 'screenshot', 'waitForSelector', 'waitForPageStable'].includes(name)) {
      return risk('low', name, '只读取浏览器或页面信息');
    }

    if (['activateTab', 'scroll'].includes(name)) {
      return risk('low', name, '轻量浏览器操作，不修改页面数据');
    }

    if (['navigate', 'newTab', 'reload'].includes(name)) {
      return risk('medium', name, '会改变当前浏览会话或页面位置', {
        url: args && args.url ? args.url : undefined
      });
    }

    if (name === 'closeTab') {
      return risk('high', name, '关闭标签页会丢失当前页面上下文', {
        matchedTerms: ['close']
      });
    }

    if (name === 'eval') {
      return risk('high', name, '执行页面脚本可以读取或修改页面状态', {
        matchedTerms: ['eval']
      });
    }

    if (['click', 'clickText', 'type', 'fillForm', 'pressKey', 'selectOption', 'act', 'openTarget', 'fillTarget', 'search', 'searchExtract'].includes(name)) {
      return risk('medium', name, '页面交互可能改变当前页面状态');
    }

    return risk('medium', name, '未知命令按中风险处理');
  }

  function confirmationBlock(commandRisk) {
    return {
      blocked: true,
      requiresConfirmation: true,
      confirmed: false,
      risk: commandRisk,
      message: '该浏览器命令被安全层拦截。请在明确获得用户确认后带 confirm=true 重新执行。'
    };
  }

  function maybeReturnRiskOnly(name, args) {
    if (!args.riskOnly) return null;
    return { risk: commandRisk(name, args) };
  }

  function maybeBlockCommand(name, args) {
    const currentRisk = commandRisk(name, args);
    if (currentRisk.requiresConfirmation && !args.confirm) return confirmationBlock(currentRisk);
    return null;
  }

  function pathValue(source, path) {
    const normalized = String(path || '').trim().replace(/\[(\d+)\]/g, '.$1');
    if (!normalized) return undefined;

    let current = source;
    for (const part of normalized.split('.').filter(Boolean)) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  function normalizeSaveAs(value) {
    const name = String(value || '').trim();
    if (!name) return '';
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
      throw new Error(`Invalid saveAs name: ${name}`);
    }
    return name;
  }

  function resolveTemplateValue(value, context) {
    if (Array.isArray(value)) return value.map((item) => resolveTemplateValue(item, context));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, resolveTemplateValue(item, context)])
      );
    }
    if (typeof value !== 'string') return value;

    const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (exact) return pathValue(context, exact[1]);

    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression) => {
      const resolved = pathValue(context, expression);
      return resolved === undefined || resolved === null ? '' : String(resolved);
    });
  }

  function resultTabId(result) {
    const candidates = [
      result,
      result && result.tab,
      result && result.wait && result.wait.tab,
      result && result.search && result.search.tab,
      result && result.search && result.search.wait && result.search.wait.tab
    ];

    for (const tab of candidates) {
      if (tab && Number.isFinite(Number(tab.id))) return Number(tab.id);
    }
    return undefined;
  }

  function resultBlocked(result) {
    if (!result || typeof result !== 'object') return false;
    if (result.blocked || result.requiresConfirmation) return true;
    return resultBlocked(result.act) || resultBlocked(result.search);
  }

  function resultUnmatched(result) {
    if (!result || typeof result !== 'object') return false;
    if (result.matched === false) return true;
    return resultUnmatched(result.search);
  }

  function resultAssertionFailed(result) {
    if (!result || typeof result !== 'object') return false;
    if (result.asserted === false) return true;
    return resultAssertionFailed(result.search);
  }

  function compactChainArgs(args) {
    const summary = { ...(args || {}) };
    if (typeof summary.text === 'string') summary.text = { length: summary.text.length };
    if (typeof summary.value === 'string') summary.value = { length: summary.value.length };
    if (typeof summary.searchText === 'string') summary.searchText = { value: summary.searchText, length: summary.searchText.length };
    return summary;
  }

  function retryConfig(step) {
    const raw = step.retry;
    let attempts = 1;
    let delayMs = Number(step.retryDelayMs || 800);
    let backoff = 1;
    let retryOn = ['error', 'unmatched', 'assertionFailed'];

    if (raw === true) {
      attempts = 3;
    } else if (Number.isFinite(Number(raw))) {
      attempts = Math.max(1, Number(raw));
    } else if (raw && typeof raw === 'object') {
      if (Number.isFinite(Number(raw.attempts))) attempts = Number(raw.attempts);
      if (Number.isFinite(Number(raw.retries))) attempts = Number(raw.retries) + 1;
      if (Number.isFinite(Number(raw.delayMs))) delayMs = Number(raw.delayMs);
      if (Number.isFinite(Number(raw.backoff))) backoff = Math.max(1, Number(raw.backoff));
      if (Array.isArray(raw.on)) retryOn = raw.on.map(String);
    }

    if (Number.isFinite(Number(step.retries))) attempts = Number(step.retries) + 1;
    attempts = Math.max(1, Math.min(8, Math.floor(attempts)));
    delayMs = Math.max(0, Math.min(30000, Math.floor(delayMs)));

    return { attempts, delayMs, backoff, retryOn };
  }

  function shouldRetryStatus(status, retry, attempt) {
    if (attempt >= retry.attempts) return false;
    return retry.retryOn.includes(status);
  }

  function assertionValue(value) {
    if (value === undefined) return '';
    if (value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  }

  function compareText(actual, expected, caseSensitive) {
    const left = assertionValue(actual);
    const right = assertionValue(expected);
    return caseSensitive ? left.includes(right) : left.toLowerCase().includes(right.toLowerCase());
  }

  function matchesPattern(actual, pattern) {
    const source = assertionValue(pattern);
    const value = assertionValue(actual);
    const match = source.match(/^\/(.+)\/([a-z]*)$/i);
    const regex = match ? new RegExp(match[1], match[2]) : new RegExp(source, 'i');
    return regex.test(value);
  }

  function addAssertCheck(checks, name, actual, expected, passed, details = {}) {
    checks.push({
      name,
      passed: Boolean(passed),
      actual,
      expected,
      ...details
    });
  }

  async function getTargetTab(args) {
    if (Number.isFinite(Number(args.tabId))) {
      return tabsGet(Number(args.tabId));
    }

    const tabs = await tabsQuery({ active: true, currentWindow: true });
    if (!tabs.length) throw new Error('No active tab in current window');
    return tabs[0];
  }

  async function runContent(tabId, action, args) {
    try {
      return await sendMessage(tabId, {
        target: CONTENT_TARGET,
        action,
        args
      });
    } catch (firstError) {
      if (!/Receiving end does not exist|No response|message port closed/i.test(firstError.message)) {
        throw firstError;
      }

      await executeScript(tabId, ['content.js']);
      return sendMessage(tabId, {
        target: CONTENT_TARGET,
        action,
        args
      });
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function remainingWaitMs(startedAt, timeoutMs) {
    return Math.max(500, timeoutMs - (Date.now() - startedAt));
  }

  function wantsPostActionWait(args) {
    return Boolean(args.wait || args.waitFor || args.waitUntil || args.waitMs);
  }

  async function waitAfterAction(tabId, args) {
    if (!wantsPostActionWait(args)) return null;

    const startedAt = Date.now();
    const timeoutMs = Math.max(1000, Number(args.waitMs || 8000));
    const wait = {
      requested: true,
      mode: args.waitFor ? 'selector' : (args.waitUntil || 'stable'),
      timeoutMs
    };
    let finalTargetTabId = tabId;

    try {
      await sleep(Math.max(0, Number(args.settleMs || 200)));

      let targetTabId = tabId;
      const originalTab = await tabsGet(tabId);
      let tab = originalTab;

      if (args.followNewTab && originalTab.windowId !== undefined) {
        const activeTabs = await tabsQuery({ active: true, windowId: originalTab.windowId });
        if (activeTabs.length && activeTabs[0].id !== tabId) {
          tab = activeTabs[0];
          targetTabId = tab.id;
          finalTargetTabId = targetTabId;
          wait.followedNewTab = true;
          wait.originalTab = normalizeTab(originalTab);
        }
      }

      if (tab.status !== 'complete') {
        await waitForComplete(targetTabId, remainingWaitMs(startedAt, timeoutMs));
        tab = await tabsGet(targetTabId);
        wait.loaded = true;
      }

      if (args.waitFor) {
        wait.selector = args.waitFor;
        wait.element = await runContent(targetTabId, 'waitForSelector', {
          selector: args.waitFor,
          timeoutMs: remainingWaitMs(startedAt, timeoutMs)
        });
      } else if (wait.mode === 'stable' || wait.mode === 'idle' || wait.mode === 'load') {
        wait.stability = wait.mode === 'load'
          ? { stable: tab.status === 'complete', readyState: 'complete' }
          : await runContent(targetTabId, 'waitForPageStable', {
              timeoutMs: remainingWaitMs(startedAt, timeoutMs),
              quietMs: args.quietMs
            });
      }

      wait.ok = true;
    } catch (error) {
      wait.ok = false;
      wait.error = error && error.message ? error.message : String(error);
    }

    wait.waitedMs = Date.now() - startedAt;
    try {
      wait.tab = normalizeTab(await tabsGet(finalTargetTabId));
    } catch (_) {
      wait.tab = null;
    }
    return wait;
  }

  async function executeSemanticAction(name, args) {
    const tab = await getTargetTab(args);
    const targetQuery = name === 'search'
      ? (args.target || args.field || args.selectorText || '搜索框')
      : (args.query || args.text || args.target);
    if (!targetQuery) throw new Error('target query is required');

    const targetAction = name === 'openTarget' ? 'click' : 'fill';
    const value = name === 'openTarget'
      ? undefined
      : (args.value ?? args.text ?? args.searchText ?? args.queryText);

    if (name !== 'openTarget' && (value === undefined || value === null || String(value) === '')) {
      throw new Error('value is required');
    }

    const target = await runContent(tab.id, 'target', {
      query: targetQuery,
      maxElements: args.maxElements,
      action: targetAction,
      kind: args.kind,
      exact: args.exact,
      limit: args.limit || 5,
      includeHighRiskBias: args.includeHighRiskBias
    });

    if (!target.best) {
      return {
        tab: normalizeTab(tab),
        semantic: name,
        matched: false,
        target,
        message: `No target matched: ${targetQuery}`
      };
    }

    const actionArgs = {
      ...args,
      id: target.best.id,
      action: targetAction,
      value,
      text: value,
      option: value,
      exact: args.exact,
      submit: name === 'search' ? true : Boolean(args.submit),
      allowSearchSubmit: name === 'search',
      wait: name === 'search' ? true : Boolean(args.wait || args.waitFor || args.waitUntil || args.waitMs),
      waitFor: args.waitFor,
      waitUntil: args.waitUntil,
      waitMs: args.waitMs,
      quietMs: args.quietMs,
      followNewTab: name === 'search',
      confirm: args.confirm,
      riskOnly: args.riskOnly
    };

    const act = await runContent(tab.id, 'act', actionArgs);
    if (args.riskOnly || act.blocked) {
      return {
        tab: normalizeTab(await tabsGet(tab.id)),
        semantic: name,
        matched: true,
        target,
        id: target.best.id,
        action: targetAction,
        risk: act.risk,
        blocked: Boolean(act.blocked),
        requiresConfirmation: Boolean(act.requiresConfirmation || (act.risk && act.risk.requiresConfirmation)),
        act
      };
    }

    const wait = await waitAfterAction(tab.id, actionArgs);
    const currentTab = wait && wait.tab ? wait.tab : normalizeTab(await tabsGet(tab.id));
    return {
      tab: currentTab,
      semantic: name,
      matched: true,
      target,
      id: target.best.id,
      action: targetAction,
      risk: act.risk,
      ...act,
      ...(wait ? { wait } : {})
    };
  }

  async function executeSearchExtract(args) {
    const search = await executeSemanticAction('search', {
      ...args,
      wait: true
    });

    if (args.riskOnly || search.blocked || !search.matched) {
      return {
        tab: search.tab,
        search,
        extraction: null
      };
    }

    const targetTab = search.wait && search.wait.tab ? search.wait.tab : search.tab;
    if (!targetTab || !Number.isFinite(Number(targetTab.id))) {
      return {
        tab: targetTab || null,
        search,
        extraction: null,
        message: 'No tab available for extraction'
      };
    }

    const extraction = await runContent(Number(targetTab.id), 'extract', {
      ...args,
      mode: args.mode || 'search'
    });

    return {
      tab: targetTab,
      search,
      extraction
    };
  }

  async function executeAssert(args) {
    const tab = await getTargetTab(args);
    const normalizedTab = normalizeTab(tab);
    const checks = [];
    let pageText = '';

    const ensurePageText = async () => {
      if (pageText) return pageText;
      const page = await runContent(tab.id, 'pageText', {
        maxChars: Number(args.maxChars || 60000)
      });
      pageText = page.text || '';
      return pageText;
    };

    if (args.titleContains !== undefined) {
      addAssertCheck(
        checks,
        'titleContains',
        normalizedTab.title || '',
        args.titleContains,
        compareText(normalizedTab.title || '', args.titleContains, args.caseSensitive)
      );
    }

    if (args.titleMatches !== undefined) {
      addAssertCheck(
        checks,
        'titleMatches',
        normalizedTab.title || '',
        args.titleMatches,
        matchesPattern(normalizedTab.title || '', args.titleMatches)
      );
    }

    if (args.urlContains !== undefined) {
      addAssertCheck(
        checks,
        'urlContains',
        normalizedTab.url || '',
        args.urlContains,
        compareText(normalizedTab.url || '', args.urlContains, args.caseSensitive)
      );
    }

    if (args.urlMatches !== undefined) {
      addAssertCheck(
        checks,
        'urlMatches',
        normalizedTab.url || '',
        args.urlMatches,
        matchesPattern(normalizedTab.url || '', args.urlMatches)
      );
    }

    if (args.textContains !== undefined) {
      const text = await ensurePageText();
      addAssertCheck(
        checks,
        'textContains',
        text.length > 300 ? `${text.slice(0, 300)}...` : text,
        args.textContains,
        compareText(text, args.textContains, args.caseSensitive),
        { textLength: text.length }
      );
    }

    if (args.textMatches !== undefined) {
      const text = await ensurePageText();
      addAssertCheck(
        checks,
        'textMatches',
        text.length > 300 ? `${text.slice(0, 300)}...` : text,
        args.textMatches,
        matchesPattern(text, args.textMatches),
        { textLength: text.length }
      );
    }

    if (args.selector) {
      if (args.wait) {
        try {
          const element = await runContent(tab.id, 'waitForSelector', {
            selector: args.selector,
            timeoutMs: Number(args.timeoutMs || args.waitMs || 5000)
          });
          addAssertCheck(checks, 'selector', args.selector, 'visible element', Boolean(element), { element });
        } catch (error) {
          addAssertCheck(checks, 'selector', args.selector, 'visible element', false, {
            error: error && error.message ? error.message : String(error)
          });
        }
      } else {
        const query = await runContent(tab.id, 'query', { selector: args.selector });
        const minCount = Number(args.minCount || 1);
        addAssertCheck(checks, 'selectorCount', query.count, `>= ${minCount}`, Number(query.count || 0) >= minCount, {
          selector: args.selector,
          elements: Array.isArray(query.elements) ? query.elements.slice(0, 5) : []
        });
      }
    }

    if (args.value !== undefined || args.equals !== undefined || args.contains !== undefined || args.matches !== undefined || args.gte !== undefined || args.lte !== undefined || args.gt !== undefined || args.lt !== undefined || args.truthy) {
      const value = args.value;
      if (args.truthy) {
        addAssertCheck(checks, 'truthy', value, true, Boolean(value));
      }
      if (args.equals !== undefined) {
        addAssertCheck(checks, 'equals', value, args.equals, assertionValue(value) === assertionValue(args.equals));
      }
      if (args.contains !== undefined) {
        addAssertCheck(checks, 'contains', value, args.contains, compareText(value, args.contains, args.caseSensitive));
      }
      if (args.matches !== undefined) {
        addAssertCheck(checks, 'matches', value, args.matches, matchesPattern(value, args.matches));
      }
      if (args.gte !== undefined) {
        addAssertCheck(checks, 'gte', Number(value), Number(args.gte), Number(value) >= Number(args.gte));
      }
      if (args.lte !== undefined) {
        addAssertCheck(checks, 'lte', Number(value), Number(args.lte), Number(value) <= Number(args.lte));
      }
      if (args.gt !== undefined) {
        addAssertCheck(checks, 'gt', Number(value), Number(args.gt), Number(value) > Number(args.gt));
      }
      if (args.lt !== undefined) {
        addAssertCheck(checks, 'lt', Number(value), Number(args.lt), Number(value) < Number(args.lt));
      }
    }

    if (!checks.length) {
      throw new Error('assert requires at least one check');
    }

    const failed = checks.filter((check) => !check.passed);
    return {
      tab: normalizedTab,
      asserted: failed.length === 0,
      count: checks.length,
      failedCount: failed.length,
      checks,
      message: failed.length ? `断言失败：${failed.map((item) => item.name).join(', ')}` : '断言通过'
    };
  }

  async function executeChain(args) {
    const steps = normalizeChainSteps(args.steps);
    const chainRiskResult = chainRisk(args);
    if (args.riskOnly) {
      return {
        risk: chainRiskResult,
        stepCount: steps.length,
        steps: chainRiskResult.steps || []
      };
    }

    const chainId = `chain_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
    const startedAt = Date.now();
    const stopOnError = args.stopOnError !== false;
    const stopOnBlocked = args.stopOnBlocked !== false;
    const stopOnUnmatched = args.stopOnUnmatched !== false;
    const stopOnAssertion = args.stopOnAssertion !== false;
    const inheritTab = args.inheritTab !== false;
    let currentTabId = Number.isFinite(Number(args.tabId)) ? Number(args.tabId) : undefined;
    let status = 'ok';
    let stoppedReason = '';
    let stoppedAt = null;

    const context = {
      chainId,
      tabId: currentTabId,
      tab: Number.isFinite(currentTabId) ? { id: currentTabId } : null,
      inputs: args.inputs && typeof args.inputs === 'object' && !Array.isArray(args.inputs) ? args.inputs : {},
      vars: {},
      last: null,
      steps: []
    };
    context.input = context.inputs;
    const records = [];

    for (const step of steps) {
      const stepStartedAt = Date.now();
      const resolvedArgs = resolveTemplateValue(step.args, context) || {};
      if (inheritTab && step.inheritTab !== false && resolvedArgs.tabId === undefined && Number.isFinite(currentTabId)) {
        resolvedArgs.tabId = currentTabId;
      }

      const retry = retryConfig(step);
      const currentRisk = commandRisk(step.name, resolvedArgs);
      const record = {
        index: step.index,
        name: step.name,
        label: step.label,
        saveAs: step.saveAs || undefined,
        args: compactChainArgs(resolvedArgs),
        risk: currentRisk,
        retry: retry.attempts > 1
          ? { attempts: retry.attempts, delayMs: retry.delayMs, backoff: retry.backoff, on: retry.retryOn }
          : undefined,
        attempts: [],
        startedAt: new Date(stepStartedAt).toISOString()
      };

      if (currentRisk.requiresConfirmation && !resolvedArgs.confirm) {
        record.status = 'blocked';
        record.durationMs = Date.now() - stepStartedAt;
        record.result = confirmationBlock(currentRisk);
        records.push(record);
        context.steps.push(record);
        context.last = record.result;
        if (step.saveAs) {
          context.vars[step.saveAs] = record.result;
        }
        status = 'blocked';
        stoppedReason = 'requiresConfirmation';
        stoppedAt = step.index;
        if (stopOnBlocked) break;
        continue;
      }

      for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
        const attemptStartedAt = Date.now();
        const attemptRecord = {
          attempt,
          startedAt: new Date(attemptStartedAt).toISOString()
        };

        try {
          const result = await execute({ name: step.name, args: resolvedArgs });
          record.result = result;
          delete record.error;

          const nextTabId = resultTabId(result);
          if (Number.isFinite(nextTabId)) {
            currentTabId = nextTabId;
            context.tabId = currentTabId;
            context.tab = { id: currentTabId };
            attemptRecord.tabId = currentTabId;
          }

          if (resultBlocked(result)) {
            record.status = 'blocked';
            status = 'blocked';
            stoppedReason = 'blockedResult';
            stoppedAt = step.index;
          } else if (resultAssertionFailed(result)) {
            record.status = 'assertionFailed';
            status = 'assertionFailed';
            stoppedReason = 'assertionFailed';
            stoppedAt = step.index;
          } else if (resultUnmatched(result)) {
            record.status = 'unmatched';
            status = 'unmatched';
            stoppedReason = 'targetNotMatched';
            stoppedAt = step.index;
          } else {
            record.status = 'ok';
            status = 'ok';
            stoppedReason = '';
            stoppedAt = null;
          }
        } catch (error) {
          record.status = 'error';
          record.error = error && error.message ? error.message : String(error);
          status = 'error';
          stoppedReason = record.error;
          stoppedAt = step.index;
        }

        attemptRecord.status = record.status;
        attemptRecord.durationMs = Date.now() - attemptStartedAt;
        if (record.error) attemptRecord.error = record.error;
        record.attempts.push(attemptRecord);

        if (!shouldRetryStatus(record.status, retry, attempt)) break;
        const delay = Math.round(retry.delayMs * (retry.backoff ** (attempt - 1)));
        attemptRecord.retryAfterMs = delay;
        if (delay > 0) await sleep(delay);
      }

      record.durationMs = Date.now() - stepStartedAt;
      records.push(record);
      context.steps.push(record);
      context.last = record.result || null;
      if (step.saveAs && record.result !== undefined) {
        context.vars[step.saveAs] = record.result;
      }

      if (
        (record.status === 'error' && stopOnError) ||
        (record.status === 'blocked' && stopOnBlocked) ||
        (record.status === 'assertionFailed' && stopOnAssertion) ||
        (record.status === 'unmatched' && stopOnUnmatched)
      ) {
        break;
      }

      if (record.status !== 'ok') {
        status = 'ok';
        stoppedReason = '';
        stoppedAt = null;
      }
    }

    const output = args.output !== undefined
      ? resolveTemplateValue(args.output, {
          ...context,
          status,
          ok: status === 'ok',
          currentTabId: Number.isFinite(currentTabId) ? currentTabId : null
        })
      : undefined;

    return {
      chainId,
      status,
      ok: status === 'ok',
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      stepCount: steps.length,
      completed: records.filter((step) => step.status === 'ok').length,
      stoppedAt,
      stoppedReason,
      currentTabId: Number.isFinite(currentTabId) ? currentTabId : null,
      inputs: context.inputs,
      variables: Object.keys(context.vars),
      ...(output !== undefined ? { output } : {}),
      steps: records
    };
  }

  async function execute(command) {
    const name = command.name;
    const args = command.args || {};

    if (name === 'tabs') {
      const riskOnly = maybeReturnRiskOnly(name, args);
      if (riskOnly) return riskOnly;
      const tabs = await tabsQuery({});
      return tabs.map(normalizeTab);
    }

    if (name === 'activeTab') {
      const riskOnly = maybeReturnRiskOnly(name, args);
      if (riskOnly) return riskOnly;
      const tab = await getTargetTab(args);
      return normalizeTab(tab);
    }

    if (name === 'activateTab') {
      const riskOnly = maybeReturnRiskOnly(name, args);
      if (riskOnly) return riskOnly;
      const tab = await getTargetTab(args);
      await tabsUpdate(tab.id, { active: true });
      if (tab.windowId !== undefined) {
        await windowsUpdate(tab.windowId, { focused: true });
      }
      return normalizeTab(await tabsGet(tab.id));
    }

    if (name === 'newTab') {
      const riskOnly = maybeReturnRiskOnly(name, args);
      if (riskOnly) return riskOnly;
      if (!args.url) throw new Error('url is required');
      let tab = normalizeTab(await tabsCreate({ url: args.url, active: args.active !== false }));
      if (args.wait) {
        await waitForComplete(tab.id, Number(args.timeoutMs || args.waitMs || 30000));
        tab = normalizeTab(await tabsGet(tab.id));
        if (args.waitUntil === 'stable' || args.waitUntil === 'idle') {
          const stability = await runContent(tab.id, 'waitForPageStable', {
            timeoutMs: Number(args.waitMs || args.timeoutMs || 10000),
            quietMs: args.quietMs
          });
          return { ...tab, stability, risk: commandRisk(name, args) };
        }
      }
      return { ...tab, risk: commandRisk(name, args) };
    }

    if (name === 'closeTab') {
      const riskOnly = maybeReturnRiskOnly(name, args);
      if (riskOnly) return riskOnly;
      const blocked = maybeBlockCommand(name, args);
      if (blocked) return blocked;
      if (!Number.isFinite(Number(args.tabId))) throw new Error('tabId is required');
      return { ...(await tabsRemove(Number(args.tabId))), risk: commandRisk(name, args) };
    }

    if (name === 'reload') {
      const riskOnly = maybeReturnRiskOnly(name, args);
      if (riskOnly) return riskOnly;
      const tab = await getTargetTab(args);
      await tabsReload(tab.id);
      if (args.wait !== false) {
        await waitForComplete(tab.id, Number(args.timeoutMs || 30000));
      }
      return { ...normalizeTab(await tabsGet(tab.id)), risk: commandRisk(name, args) };
    }

    if (name === 'navigate') {
      const riskOnly = maybeReturnRiskOnly(name, args);
      if (riskOnly) return riskOnly;
      if (!args.url) throw new Error('url is required');
      const tab = await getTargetTab(args);
      await tabsUpdate(tab.id, { url: args.url, active: true });
      if (args.wait !== false) {
        await waitForComplete(tab.id, Number(args.timeoutMs || 30000));
      }
      return { ...normalizeTab(await tabsGet(tab.id)), risk: commandRisk(name, args) };
    }

    if (name === 'screenshot') {
      const riskOnly = maybeReturnRiskOnly(name, args);
      if (riskOnly) return riskOnly;
      const tab = await getTargetTab(args);
      await tabsUpdate(tab.id, { active: true });
      if (tab.windowId !== undefined) {
        await windowsUpdate(tab.windowId, { focused: true });
      }
      const dataUrl = await captureVisibleTab(tab.windowId);
      return {
        tab: normalizeTab(await tabsGet(tab.id)),
        dataUrl
      };
    }

    if (name === 'observe' || name === 'snapshot') {
      const riskOnly = maybeReturnRiskOnly(name, args);
      if (riskOnly) return riskOnly;
      const tab = await getTargetTab(args);
      const result = await runContent(tab.id, name, args);
      if (!args.screenshot) {
        return {
          tab: normalizeTab(tab),
          ...result
        };
      }

      await tabsUpdate(tab.id, { active: true });
      if (tab.windowId !== undefined) {
        await windowsUpdate(tab.windowId, { focused: true });
      }
      const dataUrl = await captureVisibleTab(tab.windowId);
      return {
        tab: normalizeTab(await tabsGet(tab.id)),
        ...result,
        screenshot: { dataUrl }
      };
    }

    if (name === 'chain') {
      return executeChain(args);
    }

    if (name === 'searchExtract') {
      return executeSearchExtract(args);
    }

    if (name === 'assert' || name === 'expect') {
      const riskOnly = maybeReturnRiskOnly(name, args);
      if (riskOnly) return riskOnly;
      return executeAssert(args);
    }

    if (['openTarget', 'fillTarget', 'search'].includes(name)) {
      return executeSemanticAction(name, args);
    }

    const contentActions = new Set([
      'pageText',
      'pageHtml',
      'query',
      'target',
      'extract',
      'act',
      'click',
      'clickText',
      'type',
      'fillForm',
      'pressKey',
      'selectOption',
      'scroll',
      'waitForSelector',
      'waitForPageStable',
      'eval'
    ]);

    if (contentActions.has(name)) {
      const tab = await getTargetTab(args);
      const result = await runContent(tab.id, name, args);
      if (name === 'act' && !result.blocked) {
        const wait = await waitAfterAction(tab.id, args);
        const currentTab = wait && wait.tab ? wait.tab : normalizeTab(await tabsGet(tab.id));
        return {
          tab: currentTab,
          ...result,
          ...(wait ? { wait } : {})
        };
      }
      return {
        tab: normalizeTab(tab),
        ...result
      };
    }

    throw new Error(`Unknown command: ${name}`);
  }

  return {
    execute
  };
})();
