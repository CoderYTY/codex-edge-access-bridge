(function initCodexEdgeContentScript() {
  const SCRIPT_VERSION = '0.7.0-extract';
  if (window.__CODEX_EDGE_CONTENT_SCRIPT_VERSION__ === SCRIPT_VERSION) return;
  window.__CODEX_EDGE_CONTENT_SCRIPT__ = true;
  window.__CODEX_EDGE_CONTENT_SCRIPT_VERSION__ = SCRIPT_VERSION;

  const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    'summary',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="option"]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  const FIELD_SELECTOR = [
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[role="combobox"]'
  ].join(',');

  const HIGH_RISK_PATTERNS = [
    /删除|移除|清空|注销|退出登录|登出|解绑|关闭账户|停用/,
    /提交|确认|发送|发布|发出|上传|下单|付款|支付|购买|充值|打赏|订阅|开通|续费/,
    /登录|登陆|注册|授权|同意|接受|允许|approve|authorize|allow|agree|accept/i,
    /关注|取关|取消关注|拉黑|举报|屏蔽/,
    /delete|remove|clear|logout|sign out|deactivate|disable/i,
    /submit|send|publish|post|upload|order|pay|purchase|buy|checkout|subscribe|renew/i,
    /follow|unfollow|block|report/i
  ];

  const SENSITIVE_FIELD_PATTERNS = [
    /密码|口令|验证码|校验码|短信|邮箱验证码|动态码|支付|银行卡|信用卡|身份证|护照|token|密钥|私钥/,
    /password|passcode|otp|mfa|2fa|verification|verify code|captcha|credit card|card number|cvv|cvc|ssn|secret|token|api key|private key/i
  ];

  const SEMANTIC_ALIAS_GROUPS = [
    ['搜索', '搜索框', '查找', '检索', '关键词', 'search', 'find', 'query'],
    ['输入', '输入框', '文本框', '填写', '填入', 'field', 'input', 'textbox', 'type'],
    ['按钮', '点击', 'button', 'click'],
    ['链接', '入口', 'link', 'open'],
    ['下拉', '选择', '选项', 'select', 'option', 'dropdown'],
    ['登录', '登陆', '登入', 'login', 'sign in', 'log in'],
    ['投稿', '上传', '发布', '发稿', 'upload', 'publish', 'post'],
    ['历史', '观看历史', '浏览历史', 'history'],
    ['收藏', '收藏夹', 'fav', 'favorite', 'favorites'],
    ['消息', '私信', '通知', 'message', 'notification'],
    ['动态', '订阅流', 'feed', 'dynamic'],
    ['个人', '主页', '空间', '头像', 'profile', 'space', 'avatar'],
    ['关注', '粉丝', 'follow', 'following'],
    ['设置', '配置', 'setting', 'settings']
  ];

  let snapshotSerial = 0;
  let currentSnapshotId = '';
  let actionMap = new Map();

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function limitText(value, maxChars) {
    const text = String(value ?? '');
    const limit = Number(maxChars || 0);
    if (!limit || text.length <= limit) {
      return { value: text, truncated: false };
    }
    return { value: text.slice(0, limit), truncated: true };
  }

  function escapeAttribute(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function selectorForElement(element) {
    if (!element || !element.tagName) return '';
    const tag = element.tagName.toLowerCase();
    if (element.id) return `[id="${escapeAttribute(element.id)}"]`;
    const name = element.getAttribute('name');
    if (name) return `${tag}[name="${escapeAttribute(name)}"]`;
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return `${tag}[aria-label="${escapeAttribute(ariaLabel)}"]`;

    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
      const currentTag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) {
        parts.unshift(currentTag);
        break;
      }
      const siblings = [...parent.children].filter((item) => item.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${currentTag}:nth-of-type(${index})`);
      if (currentTag === 'body') break;
      current = parent;
    }
    return parts.join(' > ');
  }

  function isElementVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isDisabled(element) {
    return Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true');
  }

  function labelTexts(element) {
    const labels = new Set();
    if (!element) return [];

    if (element.labels) {
      for (const label of element.labels) labels.add(normalizeText(label.innerText || label.textContent));
    }

    const id = element.id;
    if (id) {
      for (const label of document.querySelectorAll(`label[for="${escapeAttribute(id)}"]`)) {
        labels.add(normalizeText(label.innerText || label.textContent));
      }
    }

    const closestLabel = element.closest ? element.closest('label') : null;
    if (closestLabel) labels.add(normalizeText(closestLabel.innerText || closestLabel.textContent));

    const labelledBy = String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    for (const labelId of labelledBy) {
      const node = document.getElementById(labelId);
      if (node) labels.add(normalizeText(node.innerText || node.textContent));
    }

    return [...labels].filter(Boolean);
  }

  function accessibleName(element) {
    if (!element) return '';
    const labels = labelTexts(element);
    const text = normalizeText(element.innerText || element.textContent);
    const values = [
      element.getAttribute('aria-label'),
      labels.join(' '),
      element.getAttribute('alt'),
      element.getAttribute('title'),
      element.getAttribute('placeholder'),
      element.getAttribute('name'),
      element.id,
      'value' in element ? element.value : '',
      text
    ];
    return normalizeText(values.filter(Boolean).join(' '));
  }

  function matchesAnyPattern(value, patterns) {
    const text = normalizeText(value);
    return patterns
      .map((pattern) => {
        const match = text.match(pattern);
        return match ? match[0] : '';
      })
      .filter(Boolean);
  }

  function riskResult(level, action, reason, details = {}) {
    return {
      level,
      action,
      reason,
      requiresConfirmation: level === 'high',
      ...details
    };
  }

  function elementRiskText(element) {
    if (!element) return '';
    return normalizeText([
      accessibleName(element),
      element.getAttribute('type'),
      element.getAttribute('name'),
      element.getAttribute('id'),
      element.getAttribute('class'),
      element.getAttribute('href')
    ].filter(Boolean).join(' '));
  }

  function classifyElementAction(action, element, args = {}) {
    const text = elementRiskText(element);
    const matchedHighRisk = matchesAnyPattern(text, HIGH_RISK_PATTERNS);
    const matchedSensitive = matchesAnyPattern(text, SENSITIVE_FIELD_PATTERNS);
    const type = String(element && element.getAttribute ? element.getAttribute('type') || '' : '').toLowerCase();

    if (matchedHighRisk.length) {
      return riskResult('high', action, '目标文本或属性包含高风险操作词', {
        matchedTerms: matchedHighRisk,
        target: element ? elementSummary(element) : null
      });
    }

    if (matchedSensitive.length || type === 'password') {
      return riskResult('high', action, '目标字段看起来包含敏感凭据或支付身份信息', {
        matchedTerms: matchedSensitive.length ? matchedSensitive : [type],
        target: element ? elementSummary(element) : null
      });
    }

    if (args.submit && args.allowSearchSubmit && ['type', 'fillForm'].includes(action)) {
      return riskResult('medium', action, '普通搜索提交会改变当前页面位置', {
        matchedTerms: ['search-submit'],
        target: element ? elementSummary(element) : null
      });
    }

    if (args.submit) {
      return riskResult('high', action, '动作会提交表单或触发确认流程', {
        matchedTerms: ['submit'],
        target: element ? elementSummary(element) : null
      });
    }

    if (['click', 'clickText', 'pressKey'].includes(action)) {
      return riskResult('medium', action, '页面交互可能改变当前页面状态', {
        target: element ? elementSummary(element) : null
      });
    }

    if (['type', 'fillForm', 'selectOption'].includes(action)) {
      return riskResult('medium', action, '页面字段修改会改变当前页面状态', {
        target: element ? elementSummary(element) : null
      });
    }

    return riskResult('low', action, '低风险页面操作', {
      target: element ? elementSummary(element) : null
    });
  }

  function confirmationBlock(risk) {
    return {
      blocked: true,
      requiresConfirmation: true,
      confirmed: false,
      risk,
      message: '该动作被安全层拦截。请在明确获得用户确认后带 confirm=true 重新执行。'
    };
  }

  function maybeBlockRisk(risk, args = {}) {
    if (risk.requiresConfirmation && !args.confirm) return confirmationBlock(risk);
    return null;
  }

  function elementKind(element) {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role') || '';
    const type = element.getAttribute('type') || '';
    if (tag === 'a') return 'link';
    if (tag === 'button' || role === 'button') return 'button';
    if (tag === 'select' || role === 'combobox') return 'select';
    if (tag === 'textarea' || role === 'textbox' || element.isContentEditable) return 'text-field';
    if (tag === 'input') return type ? `input:${type}` : 'input';
    return role || tag;
  }

  function elementSummary(element) {
    const rect = element.getBoundingClientRect();
    const tag = element.tagName.toLowerCase();
    const type = element.getAttribute('type') || '';
    const rawValue = 'value' in element ? String(element.value || '') : '';
    const isPassword = tag === 'input' && type.toLowerCase() === 'password';
    const summary = {
      selector: selectorForElement(element),
      kind: elementKind(element),
      tag,
      id: element.id || '',
      className: typeof element.className === 'string' ? element.className : '',
      name: element.getAttribute('name') || '',
      type,
      role: element.getAttribute('role') || '',
      ariaLabel: element.getAttribute('aria-label') || '',
      label: labelTexts(element).join(' '),
      placeholder: element.getAttribute('placeholder') || '',
      href: (element.href || '').slice(0, 500),
      hrefTruncated: Boolean(element.href && element.href.length > 500),
      value: isPassword ? '' : rawValue.slice(0, 240),
      valueLength: isPassword ? rawValue.length : undefined,
      checked: 'checked' in element ? Boolean(element.checked) : undefined,
      disabled: isDisabled(element),
      text: normalizeText(element.innerText || element.textContent).slice(0, 240),
      visible: isElementVisible(element),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };

    if (tag === 'select') {
      summary.options = [...element.options].slice(0, 60).map((option) => ({
        text: normalizeText(option.textContent),
        value: option.value,
        selected: option.selected
      }));
    }

    return summary;
  }

  function findElement(selector) {
    if (!selector || typeof selector !== 'string') {
      throw new Error('selector is required');
    }

    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`No element matches selector: ${selector}`);
    }

    return element;
  }

  function matchScore(candidate, query, exact) {
    const haystack = normalizeText(candidate).toLowerCase();
    const needle = normalizeText(query).toLowerCase();
    if (!needle) return 0;
    if (exact) return haystack === needle ? 1000 : 0;
    if (haystack === needle) return 1000;
    if (haystack.startsWith(needle)) return 700 - Math.min(haystack.length, 300);
    if (haystack.includes(needle)) return 400 - Math.min(haystack.indexOf(needle), 200);
    return 0;
  }

  function bestElement(candidates, query, options = {}) {
    const exact = Boolean(options.exact);
    let best = null;
    let bestScore = 0;

    for (const element of candidates) {
      if (!isElementVisible(element) || isDisabled(element)) continue;
      const score = matchScore(accessibleName(element), query, exact);
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }

    if (!best) {
      throw new Error(`No visible element matches text: ${query}`);
    }

    return best;
  }

  function findTextTarget(text, args = {}) {
    const candidates = args.selector
      ? [...document.querySelectorAll(args.selector)]
      : [...document.querySelectorAll(INTERACTIVE_SELECTOR)];
    return bestElement(candidates, text, { exact: args.exact });
  }

  function findFieldTarget(args = {}) {
    if (args.selector) return findElement(args.selector);
    const query = args.field || args.label || args.name || args.placeholder;
    if (!query) throw new Error('field or selector is required');
    const candidates = [...document.querySelectorAll(FIELD_SELECTOR)];
    return bestElement(candidates, query, { exact: args.exact });
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setNativeValue(element, value) {
    const tag = element.tagName.toLowerCase();
    const type = String(element.getAttribute('type') || '').toLowerCase();
    const text = String(value ?? '');

    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
      element.checked = /^(true|1|yes|on|checked|是|选中)$/i.test(text);
      dispatchInputEvents(element);
      return;
    }

    if (element.isContentEditable) {
      element.textContent = text;
      dispatchInputEvents(element);
      return;
    }

    if (tag === 'select') {
      element.value = text;
      dispatchInputEvents(element);
      return;
    }

    if (!('value' in element)) {
      throw new Error(`Element is not editable: ${selectorForElement(element)}`);
    }

    const prototype = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, text);
    } else {
      element.value = text;
    }
    dispatchInputEvents(element);
  }

  function clickElement(element) {
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    if (typeof element.focus === 'function') element.focus({ preventScroll: true });
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    element.click();
  }

  function maybeSubmit(element, submit) {
    if (!submit) return false;
    const form = element.closest ? element.closest('form') : null;
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return true;
    }
    element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true
    }));
    return false;
  }

  async function waitForSelector(selector, timeoutMs) {
    const startedAt = Date.now();
    const timeout = Number(timeoutMs || 10000);

    while (Date.now() - startedAt < timeout) {
      const element = document.querySelector(selector);
      if (element) return elementSummary(element);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Timed out waiting for selector: ${selector}`);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForPageStable(args = {}) {
    const startedAt = Date.now();
    const timeout = Math.max(500, Number(args.timeoutMs || 5000));
    const quietMs = Math.max(100, Number(args.quietMs || 500));
    let lastChangeAt = Date.now();

    const observer = new MutationObserver(() => {
      lastChangeAt = Date.now();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });

    try {
      while (Date.now() - startedAt < timeout) {
        const quietFor = Date.now() - lastChangeAt;
        if (document.readyState === 'complete' && quietFor >= quietMs) {
          return {
            stable: true,
            waitedMs: Date.now() - startedAt,
            quietMs,
            readyState: document.readyState,
            title: document.title,
            url: location.href
          };
        }
        await sleep(100);
      }

      return {
        stable: false,
        waitedMs: Date.now() - startedAt,
        quietMs,
        readyState: document.readyState,
        title: document.title,
        url: location.href
      };
    } finally {
      observer.disconnect();
    }
  }

  function observePage(args) {
    const maxChars = Number(args.maxChars || 5000);
    const maxElements = Number(args.maxElements || 50);
    const textResult = limitText(document.body ? document.body.innerText : '', maxChars);
    const controls = [...document.querySelectorAll(INTERACTIVE_SELECTOR)]
      .filter(isElementVisible)
      .slice(0, maxElements)
      .map(elementSummary);
    const fields = [...document.querySelectorAll(FIELD_SELECTOR)]
      .filter(isElementVisible)
      .slice(0, maxElements)
      .map(elementSummary);

    return {
      title: document.title,
      url: location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight
      },
      selection: String(window.getSelection ? window.getSelection() : ''),
      text: textResult.value,
      maxChars,
      truncated: textResult.truncated,
      headings: [...document.querySelectorAll('h1,h2,h3')]
        .filter(isElementVisible)
        .slice(0, 80)
        .map((heading) => ({
          level: heading.tagName.toLowerCase(),
          text: normalizeText(heading.innerText || heading.textContent)
        })),
      links: [...document.links]
        .filter(isElementVisible)
        .slice(0, 80)
        .map((link) => ({
          text: normalizeText(link.innerText || link.textContent).slice(0, 160),
          href: link.href.slice(0, 500),
          hrefTruncated: link.href.length > 500,
          selector: selectorForElement(link)
        })),
      controls,
      fields,
      activeElement: document.activeElement && document.activeElement !== document.body
        ? elementSummary(document.activeElement)
        : null
    };
  }

  function compactRisk(risk) {
    if (!risk) return null;
    return {
      level: risk.level,
      action: risk.action,
      reason: risk.reason,
      requiresConfirmation: Boolean(risk.requiresConfirmation),
      matchedTerms: risk.matchedTerms || []
    };
  }

  function defaultSnapshotAction(element) {
    const tag = element.tagName.toLowerCase();
    const role = String(element.getAttribute('role') || '').toLowerCase();
    const type = String(element.getAttribute('type') || '').toLowerCase();

    if (tag === 'select') return 'select';
    if (tag === 'textarea' || element.isContentEditable || role === 'textbox') return 'fill';
    if (tag === 'input') {
      if (['button', 'submit', 'reset', 'checkbox', 'radio', 'image'].includes(type)) return 'click';
      return 'fill';
    }
    if (role === 'combobox') return 'fill';
    return 'click';
  }

  function actionIdPrefix(element, action) {
    const tag = element.tagName.toLowerCase();
    const role = String(element.getAttribute('role') || '').toLowerCase();
    const type = String(element.getAttribute('type') || '').toLowerCase();
    if (action === 'fill' || action === 'select') return 'f';
    if (tag === 'a' || role === 'link') return 'l';
    if (tag === 'button' || role === 'button' || ['button', 'submit', 'reset', 'image'].includes(type)) return 'b';
    return 'c';
  }

  function riskActionForSnapshotAction(action) {
    if (action === 'fill') return 'fillForm';
    if (action === 'select') return 'selectOption';
    if (action === 'press') return 'pressKey';
    return 'clickText';
  }

  function snapshotActionSummary(element, id, action) {
    const summary = elementSummary(element);
    const label = limitText(accessibleName(element) || summary.text || summary.placeholder || summary.name || summary.id || summary.href, 160);
    const item = {
      id,
      action,
      kind: summary.kind,
      label: label.value,
      labelTruncated: label.truncated,
      selector: summary.selector,
      disabled: summary.disabled,
      risk: compactRisk(classifyElementAction(riskActionForSnapshotAction(action), element, {})),
      rect: summary.rect
    };

    if (summary.text) item.text = summary.text;
    if (summary.href) item.href = summary.href;
    if (summary.placeholder) item.placeholder = summary.placeholder;
    if (summary.value) item.value = summary.value;
    if (summary.checked !== undefined) item.checked = summary.checked;
    if (summary.options) item.options = summary.options.slice(0, 20);
    return item;
  }

  function buildSnapshotActions(maxElements) {
    const limit = Number(maxElements || 35);
    const candidates = [...document.querySelectorAll(`${FIELD_SELECTOR},${INTERACTIVE_SELECTOR}`)];
    const seen = new Set();
    const counts = { l: 0, b: 0, f: 0, c: 0 };
    const actions = [];

    snapshotSerial += 1;
    currentSnapshotId = `s${Date.now().toString(36)}-${snapshotSerial}`;
    actionMap = new Map();

    for (const element of candidates) {
      if (seen.has(element)) continue;
      seen.add(element);
      if (!isElementVisible(element) || isDisabled(element)) continue;

      const action = defaultSnapshotAction(element);
      const prefix = actionIdPrefix(element, action);
      const id = `${prefix}${counts[prefix] + 1}`;
      counts[prefix] += 1;
      const selector = selectorForElement(element);

      const summary = snapshotActionSummary(element, id, action);
      actionMap.set(id, {
        id,
        selector,
        action,
        snapshotId: currentSnapshotId,
        summary
      });
      actions.push(summary);
      if (actions.length >= limit) break;
    }

    window.__CODEX_EDGE_LAST_ACTION_MAP__ = {
      snapshotId: currentSnapshotId,
      count: actionMap.size,
      ids: [...actionMap.keys()]
    };

    return { actions, counts };
  }

  function snapshotPage(args) {
    const maxChars = Number(args.maxChars || 2500);
    const maxElements = Number(args.maxElements || 35);
    const textResult = limitText(document.body ? document.body.innerText : '', maxChars);
    const actionResult = buildSnapshotActions(maxElements);

    return {
      snapshotId: currentSnapshotId,
      title: document.title,
      url: location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight
      },
      selection: String(window.getSelection ? window.getSelection() : ''),
      text: textResult.value,
      maxChars,
      truncated: textResult.truncated,
      headings: [...document.querySelectorAll('h1,h2,h3')]
        .filter(isElementVisible)
        .slice(0, 30)
        .map((heading) => ({
          level: heading.tagName.toLowerCase(),
          text: normalizeText(heading.innerText || heading.textContent)
        })),
      actions: actionResult.actions,
      actionCounts: actionResult.counts,
      activeElement: document.activeElement && document.activeElement !== document.body
        ? elementSummary(document.activeElement)
        : null
    };
  }

  function absoluteUrl(value) {
    if (!value) return '';
    try {
      return new URL(value, location.href).href;
    } catch (_error) {
      return String(value);
    }
  }

  function urlKey(value) {
    const href = absoluteUrl(value);
    return href ? href.replace(/#.*$/, '') : '';
  }

  function metaContent(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = element && (element.getAttribute('content') || element.getAttribute('value') || element.textContent);
      const text = normalizeText(value);
      if (text) return text;
    }
    return '';
  }

  function firstVisibleText(root, selector) {
    const element = [...root.querySelectorAll(selector)].find(isElementVisible);
    return element ? normalizeText(element.innerText || element.textContent) : '';
  }

  function elementRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function visibleLinkElements() {
    return [...document.querySelectorAll('a[href]')].filter((element) => {
      if (!isElementVisible(element)) return false;
      const href = absoluteUrl(element.getAttribute('href') || element.href);
      if (!href || href.startsWith('javascript:')) return false;
      return true;
    });
  }

  function actionLookup(actions) {
    const bySelector = new Map();
    const byHref = new Map();

    for (const action of actions) {
      if (action.selector && !bySelector.has(action.selector)) bySelector.set(action.selector, action);
      const key = urlKey(action.href);
      if (key && !byHref.has(key)) byHref.set(key, action);
    }

    return { bySelector, byHref };
  }

  function findLinkAction(link, lookup) {
    const selector = selectorForElement(link);
    const bySelector = lookup.bySelector.get(selector);
    if (bySelector) return bySelector;
    const byHref = lookup.byHref.get(urlKey(link.getAttribute('href') || link.href));
    return byHref || null;
  }

  function linkText(link) {
    return normalizeText([
      link.innerText,
      link.getAttribute('aria-label'),
      link.getAttribute('title'),
      link.querySelector('img') ? link.querySelector('img').getAttribute('alt') : ''
    ].filter(Boolean).join(' '));
  }

  function mediaSource(root) {
    const image = [...root.querySelectorAll('img')].find(isElementVisible);
    if (!image) return null;
    return {
      src: absoluteUrl(image.currentSrc || image.src),
      alt: normalizeText(image.getAttribute('alt') || image.getAttribute('aria-label') || '')
    };
  }

  function nearestCard(element) {
    const selectors = [
      'article',
      'li',
      '[role="article"]',
      '[role="listitem"]',
      '[class*="result" i]',
      '[class*="card" i]',
      '[class*="video" i]',
      '[class*="item" i]'
    ].join(',');
    const matched = element.closest(selectors);
    if (matched && matched !== document.body && matched !== document.documentElement && isElementVisible(matched)) {
      return matched;
    }

    let current = element.parentElement;
    for (let depth = 0; current && current !== document.body && depth < 6; depth += 1) {
      const text = normalizeText(current.innerText || current.textContent);
      const linkCount = current.querySelectorAll('a[href]').length;
      const rect = current.getBoundingClientRect();
      if (text.length >= 30 && linkCount >= 1 && rect.width >= 80 && rect.height >= 32 && isElementVisible(current)) {
        return current;
      }
      current = current.parentElement;
    }

    return element;
  }

  function extractLinks(args, lookup) {
    const limit = Math.max(1, Number(args.limit || 30));
    const links = [];
    const seen = new Set();

    for (const link of visibleLinkElements()) {
      const href = absoluteUrl(link.getAttribute('href') || link.href);
      const text = linkText(link);
      const key = urlKey(href) || text;
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const action = findLinkAction(link, lookup);
      links.push({
        title: limitText(text || href, 220).value,
        href,
        selector: selectorForElement(link),
        actionId: action ? action.id : '',
        action: action ? action.action : 'click',
        risk: action ? action.risk : null,
        rect: elementRect(link)
      });

      if (links.length >= limit) break;
    }

    return links;
  }

  function extractCards(args, lookup) {
    const limit = Math.max(1, Number(args.limit || 20));
    const cards = [];
    const seen = new Set();

    for (const link of visibleLinkElements()) {
      const href = absoluteUrl(link.getAttribute('href') || link.href);
      const card = nearestCard(link);
      const rect = card.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 32) continue;

      const heading = firstVisibleText(card, 'h1,h2,h3,h4,[role="heading"]');
      const title = normalizeText(heading || linkText(link));
      const textResult = limitText(normalizeText(card.innerText || card.textContent), Number(args.cardChars || 520));
      if (!title && textResult.value.length < 24) continue;

      const key = urlKey(href) || `${title}@${Math.round(rect.x)}:${Math.round(rect.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const action = findLinkAction(link, lookup);
      cards.push({
        title: limitText(title || textResult.value, 220).value,
        href,
        text: textResult.value,
        truncated: textResult.truncated,
        selector: selectorForElement(link),
        actionId: action ? action.id : '',
        action: action ? action.action : 'click',
        risk: action ? action.risk : null,
        image: mediaSource(card),
        rect: elementRect(card)
      });

      if (cards.length >= limit) break;
    }

    return cards;
  }

  function extractArticle(args) {
    const maxChars = Number(args.maxChars || 5000);
    const root = document.querySelector('article') || document.querySelector('main') || document.body || document.documentElement;
    const title = normalizeText(
      firstVisibleText(document, 'h1') ||
      metaContent(['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
      document.title
    );
    const textResult = limitText(normalizeText(root.innerText || root.textContent), maxChars);
    const published = normalizeText(
      metaContent([
        'meta[property="article:published_time"]',
        'meta[name="pubdate"]',
        'meta[name="publishdate"]',
        'meta[name="date"]'
      ]) ||
      firstVisibleText(document, 'time')
    );

    return {
      title,
      description: metaContent(['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']),
      author: metaContent(['meta[name="author"]', 'meta[property="article:author"]']) || firstVisibleText(document, '[rel="author"],.author,[class*="author" i]'),
      published,
      text: textResult.value,
      maxChars,
      truncated: textResult.truncated
    };
  }

  function looksLikeSearchPage() {
    const value = `${location.href} ${document.title}`.toLowerCase();
    return /search|query|keyword|result/.test(value) || value.includes('\u641c\u7d22') || value.includes('\u7ed3\u679c');
  }

  function extractSearchResults(args, lookup) {
    const cards = extractCards({ ...args, cardChars: args.cardChars || 700, limit: Number(args.limit || 12) * 2 }, lookup);
    return cards
      .filter((card) => card.href && card.title && (card.text.length >= 36 || card.image))
      .slice(0, Math.max(1, Number(args.limit || 12)))
      .map((card, index) => ({
        rank: index + 1,
        title: card.title,
        href: card.href,
        text: card.text,
        image: card.image,
        actionId: card.actionId,
        action: card.action,
        risk: card.risk,
        rect: card.rect
      }));
  }

  function extractPage(args) {
    const mode = normalizeText(args.mode || 'auto').toLowerCase();
    const maxElements = Number(args.maxElements || 180);
    const actionResult = buildSnapshotActions(maxElements);
    const lookup = actionLookup(actionResult.actions);
    const maxChars = Number(args.maxChars || 5000);
    const bodyText = limitText(normalizeText(document.body ? document.body.innerText : ''), maxChars);
    const includeAuto = !mode || mode === 'auto';
    const includeSearch = mode === 'search' || (includeAuto && looksLikeSearchPage());
    const result = {
      mode: mode || 'auto',
      title: document.title,
      url: location.href,
      snapshotId: currentSnapshotId,
      actionCounts: actionResult.counts,
      summary: {
        text: bodyText.value,
        maxChars,
        truncated: bodyText.truncated
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        documentWidth: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight
      }
    };

    if (includeAuto || mode === 'article') {
      result.article = extractArticle({ ...args, maxChars });
    }
    if (includeAuto || mode === 'links') {
      result.links = extractLinks(args, lookup);
    }
    if (includeAuto || mode === 'cards') {
      result.cards = extractCards(args, lookup);
    }
    if (includeSearch) {
      result.results = extractSearchResults(args, lookup);
    }

    return result;
  }

  function searchTermsForQuery(query) {
    const normalized = normalizeText(query).toLowerCase();
    const terms = new Set();
    if (normalized) terms.add(normalized);

    for (const token of normalized.split(/[\s,，.。/|:：;；()[\]{}"'`~!！?？<>《》]+/).filter(Boolean)) {
      terms.add(token);
    }

    for (const group of SEMANTIC_ALIAS_GROUPS) {
      if (group.some((term) => normalized.includes(term.toLowerCase()))) {
        for (const term of group) terms.add(term.toLowerCase());
      }
    }

    return [...terms].filter(Boolean);
  }

  function actionSearchHaystack(item) {
    return normalizeText([
      item.id,
      item.action,
      item.kind,
      item.label,
      item.text,
      item.placeholder,
      item.href,
      item.selector,
      item.value,
      item.options ? item.options.map((option) => `${option.text} ${option.value}`).join(' ') : ''
    ].filter(Boolean).join(' ')).toLowerCase();
  }

  function actionPrimaryText(item) {
    return normalizeText([
      item.label,
      item.text,
      item.placeholder,
      item.href
    ].filter(Boolean).join(' ')).toLowerCase();
  }

  function scoreActionTarget(item, query, terms, args = {}) {
    const normalizedQuery = normalizeText(query).toLowerCase();
    const preferredAction = args.action ? normalizeActionName(args.action, '') : '';
    const preferredKind = normalizeText(args.kind || '').toLowerCase();

    if (preferredAction && item.action !== preferredAction) return null;
    if (preferredKind && !normalizeText(`${item.kind} ${item.action}`).toLowerCase().includes(preferredKind)) return null;

    const primary = actionPrimaryText(item);
    const haystack = actionSearchHaystack(item);
    let score = 0;
    const reasons = [];

    if (args.exact) {
      if (primary === normalizedQuery || item.id.toLowerCase() === normalizedQuery) {
        score += 1200;
        reasons.push('exact');
      } else {
        return null;
      }
    } else {
      if (item.id.toLowerCase() === normalizedQuery) {
        score += 1200;
        reasons.push('id');
      }
      if (primary === normalizedQuery) {
        score += 1000;
        reasons.push('exact-text');
      } else if (primary.startsWith(normalizedQuery)) {
        score += 760;
        reasons.push('prefix');
      } else if (primary.includes(normalizedQuery)) {
        score += 620;
        reasons.push('contains-text');
      } else if (haystack.includes(normalizedQuery)) {
        score += 440;
        reasons.push('contains-metadata');
      }
    }

    for (const term of terms) {
      if (!term || term === normalizedQuery) continue;
      if (primary.includes(term)) {
        score += 130;
        reasons.push(`text:${term}`);
      } else if (haystack.includes(term)) {
        score += 80;
        reasons.push(`meta:${term}`);
      }
    }

    const queryWantsSearch = terms.some((term) => ['搜索', '搜索框', '查找', '检索', 'search', 'find', 'query'].includes(term));
    const queryWantsInput = terms.some((term) => ['输入', '输入框', '文本框', '填写', 'field', 'input', 'textbox', 'type'].includes(term));
    const queryWantsButton = terms.some((term) => ['按钮', 'button', 'click'].includes(term));
    const queryWantsLink = terms.some((term) => ['链接', '入口', 'link', 'open'].includes(term));
    const queryWantsSelect = terms.some((term) => ['下拉', '选择', '选项', 'select', 'option', 'dropdown'].includes(term));

    if (queryWantsSearch && item.action === 'fill') {
      score += 260;
      reasons.push('search-field');
    }
    if (queryWantsInput && item.action === 'fill') {
      score += 240;
      reasons.push('input-field');
    }
    if (queryWantsButton && item.action === 'click' && item.kind.includes('button')) {
      score += 200;
      reasons.push('button');
    }
    if (queryWantsLink && item.action === 'click' && item.kind === 'link') {
      score += 160;
      reasons.push('link');
    }
    if (queryWantsSelect && item.action === 'select') {
      score += 260;
      reasons.push('select');
    }
    const matchedIntentScore = score;

    if (preferredAction) {
      score += 120;
      reasons.push(`action:${preferredAction}`);
    }
    if (preferredKind) {
      score += 100;
      reasons.push(`kind:${preferredKind}`);
    }

    if (item.risk && item.risk.requiresConfirmation && !args.includeHighRiskBias) {
      score -= 20;
      reasons.push('high-risk');
    }

    if (matchedIntentScore <= 0 || score <= 0) return null;

    return {
      ...item,
      score,
      reasons: [...new Set(reasons)].slice(0, 12)
    };
  }

  function targetAction(args) {
    const query = normalizeText(args.query || args.text || args.target || '');
    if (!query) throw new Error('query is required');

    const maxElements = Number(args.maxElements || 120);
    const limit = Math.max(1, Number(args.limit || 8));
    const actionResult = buildSnapshotActions(maxElements);
    const terms = searchTermsForQuery(query);
    const matches = actionResult.actions
      .map((item) => scoreActionTarget(item, query, terms, args))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);

    return {
      query,
      terms,
      snapshotId: currentSnapshotId,
      title: document.title,
      url: location.href,
      actionCounts: actionResult.counts,
      searchedActions: actionResult.actions.length,
      count: matches.length,
      best: matches[0] || null,
      matches
    };
  }

  function normalizeActionName(action, fallback) {
    const name = normalizeText(action || fallback || 'click').toLowerCase();
    const aliases = {
      input: 'fill',
      type: 'fill',
      fillform: 'fill',
      selectoption: 'select',
      clicktext: 'click',
      presskey: 'press',
      key: 'press',
      auto: fallback || 'click'
    };
    return aliases[name] || name;
  }

  function resolveActionTarget(args) {
    const id = normalizeText(args.id || args.actionId).toLowerCase();
    if (!id) throw new Error('action id is required');
    const target = actionMap.get(id);
    if (!target) {
      throw new Error(`Unknown action id: ${id}. Run snapshot again before act.`);
    }
    const element = findElement(target.selector);
    if (!isElementVisible(element)) {
      throw new Error(`Action target is no longer visible: ${id}. Run snapshot again.`);
    }
    return { id, target, element };
  }

  async function actOnTarget(args) {
    const { id, target, element } = resolveActionTarget(args);
    const action = normalizeActionName(args.action, target.action || defaultSnapshotAction(element));
    if (!['click', 'fill', 'select', 'press'].includes(action)) {
      throw new Error(`Unsupported act action: ${action}`);
    }

    const value = args.value ?? args.text ?? args.option;
    const key = args.key ?? value;
    const submitLike = action === 'press' && (args.submit || (key === 'Enter' && element.closest && element.closest('form')));
    const riskName = riskActionForSnapshotAction(action);
    const risk = classifyElementAction(riskName, element, {
      ...args,
      selector: target.selector,
      submit: Boolean(args.submit || submitLike)
    });

    if (args.riskOnly) {
      return {
        id,
        action,
        snapshotId: target.snapshotId,
        risk,
        element: elementSummary(element)
      };
    }

    const blocked = maybeBlockRisk(risk, args);
    if (blocked) {
      return {
        ...blocked,
        id,
        action,
        snapshotId: target.snapshotId
      };
    }

    if (action === 'click') {
      clickElement(element);
      return {
        acted: true,
        clicked: true,
        id,
        action,
        snapshotId: target.snapshotId,
        risk,
        element: elementSummary(element)
      };
    }

    if (action === 'fill') {
      if (value === undefined || value === null) throw new Error('value is required for act fill');
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      if (typeof element.focus === 'function') element.focus({ preventScroll: true });
      setNativeValue(element, value);
      const submitted = maybeSubmit(element, args.submit);
      return {
        acted: true,
        filled: true,
        id,
        action,
        snapshotId: target.snapshotId,
        valueLength: String(value ?? '').length,
        submitted,
        risk,
        element: elementSummary(element)
      };
    }

    if (action === 'select') {
      if (element.tagName.toLowerCase() !== 'select') {
        throw new Error(`Target is not a select element: ${selectorForElement(element)}`);
      }
      const wanted = normalizeText(value);
      if (!wanted) throw new Error('value is required for act select');
      const exact = Boolean(args.exact);
      const option = [...element.options].find((item) => {
        const optionText = normalizeText(item.textContent);
        const optionValue = normalizeText(item.value);
        return exact
          ? optionText === wanted || optionValue === wanted
          : optionText.toLowerCase().includes(wanted.toLowerCase()) || optionValue.toLowerCase() === wanted.toLowerCase();
      });
      if (!option) throw new Error(`No option matches: ${wanted}`);
      element.value = option.value;
      option.selected = true;
      dispatchInputEvents(element);
      return {
        acted: true,
        selected: true,
        id,
        action,
        snapshotId: target.snapshotId,
        value: option.value,
        text: normalizeText(option.textContent),
        risk,
        element: elementSummary(element)
      };
    }

    const keyText = String(key || '');
    if (!keyText) throw new Error('key is required for act press');
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    if (typeof element.focus === 'function') element.focus({ preventScroll: true });
    const code = args.code || (keyText.length === 1 ? `Key${keyText.toUpperCase()}` : keyText);
    const eventInit = {
      key: keyText,
      code,
      bubbles: true,
      cancelable: true,
      ctrlKey: Boolean(args.ctrlKey),
      altKey: Boolean(args.altKey),
      shiftKey: Boolean(args.shiftKey),
      metaKey: Boolean(args.metaKey)
    };
    const down = element.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    if (keyText.length === 1) element.dispatchEvent(new KeyboardEvent('keypress', eventInit));
    const submitted = keyText === 'Enter' ? maybeSubmit(element, args.submit) : false;
    const up = element.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    return {
      acted: true,
      pressed: true,
      id,
      action,
      snapshotId: target.snapshotId,
      key: keyText,
      keydownAccepted: down,
      keyupAccepted: up,
      submitted,
      risk,
      element: elementSummary(element)
    };
  }

  async function execute(action, args) {
    if (action === 'observe') {
      return observePage(args);
    }

    if (action === 'snapshot') {
      return snapshotPage(args);
    }

    if (action === 'target') {
      return targetAction(args);
    }

    if (action === 'extract') {
      return extractPage(args);
    }

    if (action === 'act') {
      return actOnTarget(args);
    }

    if (action === 'pageText') {
      const maxChars = Number(args.maxChars || 12000);
      const page = observePage({ maxChars, maxElements: 0 });
      return {
        title: page.title,
        url: page.url,
        selection: page.selection,
        text: page.text,
        maxChars,
        truncated: page.truncated,
        headings: page.headings,
        links: page.links
      };
    }

    if (action === 'pageHtml') {
      const maxChars = Number(args.maxChars || 200000);
      const htmlResult = limitText(document.documentElement.outerHTML, maxChars);
      return {
        title: document.title,
        url: location.href,
        html: htmlResult.value,
        maxChars,
        truncated: htmlResult.truncated
      };
    }

    if (action === 'query') {
      const elements = [...document.querySelectorAll(args.selector)].slice(0, 100);
      return {
        selector: args.selector,
        count: document.querySelectorAll(args.selector).length,
        elements: elements.map(elementSummary)
      };
    }

    if (action === 'click') {
      const element = findElement(args.selector);
      const risk = classifyElementAction(action, element, args);
      if (args.riskOnly) return { risk, element: elementSummary(element) };
      const blocked = maybeBlockRisk(risk, args);
      if (blocked) return blocked;
      clickElement(element);
      return {
        clicked: true,
        risk,
        element: elementSummary(element)
      };
    }

    if (action === 'clickText') {
      const element = findTextTarget(args.text, args);
      const risk = classifyElementAction(action, element, args);
      if (args.riskOnly) return { risk, text: args.text, element: elementSummary(element) };
      const blocked = maybeBlockRisk(risk, args);
      if (blocked) return blocked;
      clickElement(element);
      return {
        clicked: true,
        text: args.text,
        risk,
        element: elementSummary(element)
      };
    }

    if (action === 'type') {
      const element = findElement(args.selector);
      const text = String(args.text ?? '');
      const risk = classifyElementAction(action, element, args);
      if (args.riskOnly) return { risk, valueLength: text.length, element: elementSummary(element) };
      const blocked = maybeBlockRisk(risk, args);
      if (blocked) return blocked;
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      if (typeof element.focus === 'function') element.focus({ preventScroll: true });
      setNativeValue(element, text);
      const submitted = maybeSubmit(element, args.submit);

      return {
        typed: true,
        submitted,
        risk,
        element: elementSummary(element)
      };
    }

    if (action === 'fillForm') {
      const fields = args.fields && typeof args.fields === 'object'
        ? Object.entries(args.fields)
        : [[args.field || args.label || args.name || args.selector, args.value]];
      const filled = [];
      const planned = [];
      let lastElement = null;

      for (const [field, value] of fields) {
        const element = findFieldTarget({ ...args, field, selector: args.fields ? '' : args.selector });
        const risk = classifyElementAction(action, element, args);
        planned.push({ field, value, element, risk });
      }

      const highRisk = planned.find((item) => item.risk.requiresConfirmation);
      if (args.riskOnly) {
        return {
          risk: highRisk ? highRisk.risk : riskResult('medium', action, '页面字段修改会改变当前页面状态'),
          planned: planned.map((item) => ({
            field: item.field,
            valueLength: String(item.value ?? '').length,
            risk: item.risk,
            element: elementSummary(item.element)
          }))
        };
      }
      if (highRisk && !args.confirm) return confirmationBlock(highRisk.risk);

      for (const item of planned) {
        const { field, value, element, risk } = item;
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
        if (typeof element.focus === 'function') element.focus({ preventScroll: true });
        setNativeValue(element, value);
        lastElement = element;
        filled.push({
          field,
          valueLength: String(value ?? '').length,
          risk,
          element: elementSummary(element)
        });
      }

      const submitted = lastElement ? maybeSubmit(lastElement, args.submit) : false;
      return {
        filled,
        submitted,
        risk: highRisk ? highRisk.risk : riskResult('medium', action, '页面字段修改会改变当前页面状态')
      };
    }

    if (action === 'selectOption') {
      const element = findFieldTarget(args);
      if (element.tagName.toLowerCase() !== 'select') {
        throw new Error(`Target is not a select element: ${selectorForElement(element)}`);
      }
      const wanted = normalizeText(args.value ?? args.text ?? args.option);
      const exact = Boolean(args.exact);
      let option = [...element.options].find((item) => {
        const optionText = normalizeText(item.textContent);
        const optionValue = normalizeText(item.value);
        return exact
          ? optionText === wanted || optionValue === wanted
          : optionText.toLowerCase().includes(wanted.toLowerCase()) || optionValue.toLowerCase() === wanted.toLowerCase();
      });
      if (!option) throw new Error(`No option matches: ${wanted}`);
      const risk = classifyElementAction(action, element, args);
      if (args.riskOnly) {
        return {
          risk,
          value: option.value,
          text: normalizeText(option.textContent),
          element: elementSummary(element)
        };
      }
      const blocked = maybeBlockRisk(risk, args);
      if (blocked) return blocked;
      element.value = option.value;
      option.selected = true;
      dispatchInputEvents(element);
      return {
        selected: true,
        value: option.value,
        text: normalizeText(option.textContent),
        risk,
        element: elementSummary(element)
      };
    }

    if (action === 'pressKey') {
      const key = String(args.key || '');
      if (!key) throw new Error('key is required');
      const element = args.selector ? findElement(args.selector) : (document.activeElement || document.body);
      const submitLike = args.submit || (key === 'Enter' && element && element.closest && element.closest('form'));
      const risk = classifyElementAction(action, element, { ...args, submit: Boolean(submitLike) });
      if (args.riskOnly) return { risk, key, element: elementSummary(element) };
      const blocked = maybeBlockRisk(risk, args);
      if (blocked) return blocked;
      if (typeof element.focus === 'function') element.focus({ preventScroll: true });
      const code = args.code || (key.length === 1 ? `Key${key.toUpperCase()}` : key);
      const eventInit = {
        key,
        code,
        bubbles: true,
        cancelable: true,
        ctrlKey: Boolean(args.ctrlKey),
        altKey: Boolean(args.altKey),
        shiftKey: Boolean(args.shiftKey),
        metaKey: Boolean(args.metaKey)
      };
      const down = element.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      if (key.length === 1) element.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      const submitted = key === 'Enter' ? maybeSubmit(element, args.submit) : false;
      const up = element.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      return {
        pressed: true,
        key,
        keydownAccepted: down,
        keyupAccepted: up,
        submitted,
        risk,
        element: elementSummary(element)
      };
    }

    if (action === 'scroll') {
      const x = Number(args.x || 0);
      const y = Number(args.y || 0);
      window.scrollBy({ left: x, top: y, behavior: args.smooth ? 'smooth' : 'auto' });
      return {
        x: window.scrollX,
        y: window.scrollY,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      };
    }

    if (action === 'waitForSelector') {
      return waitForSelector(args.selector, args.timeoutMs);
    }

    if (action === 'waitForPageStable') {
      return waitForPageStable(args);
    }

    if (action === 'eval') {
      const risk = riskResult('high', action, '执行页面脚本可以读取或修改页面状态', {
        matchedTerms: ['eval']
      });
      if (args.riskOnly) return { risk };
      const blocked = maybeBlockRisk(risk, args);
      if (blocked) return blocked;
      const code = String(args.code || '');
      const fn = new Function('args', code);
      const value = await fn(args);
      return {
        risk,
        value: JSON.parse(JSON.stringify(value ?? null))
      };
    }

    throw new Error(`Unknown content action: ${action}`);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !['edge-codex-content-v2.6', 'edge-codex-content-v2.5', 'edge-codex-content-v2.4', 'edge-codex-content-v2.3', 'edge-codex-content-v2.2', 'edge-codex-content-v2.1', 'edge-codex-content-v2', 'edge-codex-content'].includes(message.target)) return false;

    execute(message.action, message.args || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));

    return true;
  });
})();
