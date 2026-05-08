(function initCodexEdgeContentScript() {
  if (window.__CODEX_EDGE_CONTENT_SCRIPT__) return;
  window.__CODEX_EDGE_CONTENT_SCRIPT__ = true;

  function limitText(value, maxChars) {
    const text = String(value ?? '');
    const limit = Number(maxChars || 0);
    if (!limit || text.length <= limit) {
      return { value: text, truncated: false };
    }
    return { value: text.slice(0, limit), truncated: true };
  }

  function elementSummary(element) {
    const rect = element.getBoundingClientRect();
    const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      className: typeof element.className === 'string' ? element.className : '',
      name: element.getAttribute('name') || '',
      type: element.getAttribute('type') || '',
      role: element.getAttribute('role') || '',
      ariaLabel: element.getAttribute('aria-label') || '',
      href: element.href || '',
      value: 'value' in element ? String(element.value || '') : '',
      text: text.slice(0, 240),
      visible: rect.width > 0 && rect.height > 0,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
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

  function dispatchInputEvents(element) {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
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

  async function execute(action, args) {
    if (action === 'pageText') {
      const maxChars = Number(args.maxChars || 12000);
      const textResult = limitText(document.body ? document.body.innerText : '', maxChars);
      const selection = String(window.getSelection ? window.getSelection() : '');
      const links = [...document.links].slice(0, 80).map((link) => ({
        text: (link.innerText || link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        href: link.href
      }));
      const headings = [...document.querySelectorAll('h1,h2,h3')]
        .slice(0, 80)
        .map((heading) => ({
          level: heading.tagName.toLowerCase(),
          text: (heading.innerText || heading.textContent || '').replace(/\s+/g, ' ').trim()
        }));

      return {
        title: document.title,
        url: location.href,
        selection,
        text: textResult.value,
        maxChars,
        truncated: textResult.truncated,
        headings,
        links
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
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      element.click();
      return {
        clicked: true,
        element: elementSummary(element)
      };
    }

    if (action === 'type') {
      const element = findElement(args.selector);
      const text = String(args.text ?? '');
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      element.focus();

      if (element.isContentEditable) {
        element.textContent = text;
      } else if ('value' in element) {
        element.value = text;
      } else {
        throw new Error(`Element is not editable: ${args.selector}`);
      }

      dispatchInputEvents(element);

      if (args.submit) {
        const form = element.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          element.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: true
          }));
        }
      }

      return {
        typed: true,
        submitted: Boolean(args.submit),
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

    if (action === 'eval') {
      const code = String(args.code || '');
      const fn = new Function('args', code);
      const value = await fn(args);
      return JSON.parse(JSON.stringify(value ?? null));
    }

    throw new Error(`Unknown content action: ${action}`);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== 'edge-codex-content') return false;

    execute(message.action, message.args || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      }));

    return true;
  });
})();
