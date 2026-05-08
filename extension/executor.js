window.EdgeCodexExecutor = (function createExecutor() {
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
        target: 'edge-codex-content',
        action,
        args
      });
    } catch (firstError) {
      if (!/Receiving end does not exist|No response/.test(firstError.message)) {
        throw firstError;
      }

      await executeScript(tabId, ['content.js']);
      return sendMessage(tabId, {
        target: 'edge-codex-content',
        action,
        args
      });
    }
  }

  async function execute(command) {
    const name = command.name;
    const args = command.args || {};

    if (name === 'tabs') {
      const tabs = await tabsQuery({});
      return tabs.map(normalizeTab);
    }

    if (name === 'activeTab') {
      const tab = await getTargetTab(args);
      return normalizeTab(tab);
    }

    if (name === 'newTab') {
      if (!args.url) throw new Error('url is required');
      return normalizeTab(await tabsCreate({ url: args.url, active: args.active !== false }));
    }

    if (name === 'closeTab') {
      if (!Number.isFinite(Number(args.tabId))) throw new Error('tabId is required');
      return tabsRemove(Number(args.tabId));
    }

    if (name === 'reload') {
      const tab = await getTargetTab(args);
      await tabsReload(tab.id);
      if (args.wait !== false) {
        await waitForComplete(tab.id, Number(args.timeoutMs || 30000));
      }
      return normalizeTab(await tabsGet(tab.id));
    }

    if (name === 'navigate') {
      if (!args.url) throw new Error('url is required');
      const tab = await getTargetTab(args);
      await tabsUpdate(tab.id, { url: args.url, active: true });
      if (args.wait !== false) {
        await waitForComplete(tab.id, Number(args.timeoutMs || 30000));
      }
      return normalizeTab(await tabsGet(tab.id));
    }

    if (name === 'screenshot') {
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

    const contentActions = new Set([
      'pageText',
      'pageHtml',
      'query',
      'click',
      'type',
      'scroll',
      'waitForSelector',
      'eval'
    ]);

    if (contentActions.has(name)) {
      const tab = await getTargetTab(args);
      const result = await runContent(tab.id, name, args);
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
