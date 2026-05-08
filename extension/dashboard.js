(function initDashboard() {
  const DEFAULT_HOST_NAME = 'com.codex.edge_bridge';
  const DEFAULT_SERVER_URL = 'http://127.0.0.1:18888';

  const elements = {
    statusBadge: document.getElementById('statusBadge'),
    serverUrl: document.getElementById('serverUrl'),
    hostName: document.getElementById('hostName'),
    saveButton: document.getElementById('saveButton'),
    startButton: document.getElementById('startButton'),
    stopButton: document.getElementById('stopButton'),
    clientId: document.getElementById('clientId'),
    lastSeen: document.getElementById('lastSeen'),
    lastCommand: document.getElementById('lastCommand'),
    log: document.getElementById('log')
  };

  let clientId = '';
  let nativePort = null;
  let running = false;
  let reconnectTimer = null;
  let manualDisconnect = false;

  function setStatus(status, detail) {
    elements.statusBadge.textContent = status;
    elements.statusBadge.dataset.status = status;
    if (detail) appendLog(detail);
  }

  function appendLog(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    elements.log.textContent = `${line}\n${elements.log.textContent}`.slice(0, 12000);
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
  }

  async function loadSettings() {
    const stored = await storageGet(['serverUrl', 'hostName']);
    elements.serverUrl.value = stored.serverUrl || DEFAULT_SERVER_URL;
    elements.hostName.value = stored.hostName || DEFAULT_HOST_NAME;
    await ensureClientId();
  }

  async function saveSettings() {
    await storageSet({
      serverUrl: elements.serverUrl.value.trim() || DEFAULT_SERVER_URL,
      hostName: elements.hostName.value.trim() || DEFAULT_HOST_NAME
    });
    appendLog('Settings saved');
  }

  function postNativeMessage(message) {
    if (!nativePort) {
      throw new Error('Native port is not connected');
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
    if (status.host && status.port) {
      elements.serverUrl.value = `http://${status.host}:${status.port}`;
    }
    elements.lastSeen.textContent = new Date().toLocaleTimeString();
  }

  async function handleCommand(command) {
    elements.lastCommand.textContent = `${command.name} (${command.id})`;
    appendLog(`Executing ${command.name}`);

    try {
      const result = await window.EdgeCodexExecutor.execute(command);
      postNativeMessage({
        type: 'result',
        id: command.id,
        ok: true,
        result
      });
      appendLog(`Completed ${command.name}`);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      postNativeMessage({
        type: 'result',
        id: command.id,
        ok: false,
        error: message
      });
      appendLog(`Failed ${command.name}: ${message}`);
    }
  }

  function handleNativeMessage(message) {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'ready' || message.type === 'pong') {
      updateFromStatus(message.status);
      setStatus('connected', 'Native host is ready');
      return;
    }

    if (message.type === 'hostError') {
      updateFromStatus(message.status);
      setStatus('error', message.error || 'Native host error');
      return;
    }

    if (message.type === 'command') {
      updateFromStatus(null);
      handleCommand(message.command).catch((error) => {
        appendLog(`Command handler failed: ${error.message}`);
      });
      return;
    }

    appendLog(`Ignored native message: ${message.type || '(missing type)'}`);
  }

  function connectNative() {
    if (nativePort) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    manualDisconnect = false;

    const hostName = elements.hostName.value.trim() || DEFAULT_HOST_NAME;
    try {
      nativePort = chrome.runtime.connectNative(hostName);
    } catch (error) {
      setStatus('error', error.message);
      nativePort = null;
      running = false;
      return;
    }

    running = true;
    setStatus('connecting', `Connecting native host: ${hostName}`);

    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      const message = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Native host disconnected';
      nativePort = null;
      running = false;
      setStatus('paused', message);
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
    setStatus('paused', 'Native host paused');
  }

  elements.saveButton.addEventListener('click', () => {
    saveSettings().catch((error) => appendLog(`Save failed: ${error.message}`));
  });
  elements.startButton.addEventListener('click', () => {
    if (!running) connectNative();
  });
  elements.stopButton.addEventListener('click', disconnectNative);

  loadSettings()
    .then(connectNative)
    .catch((error) => {
      setStatus('error', `Initialization failed: ${error.message}`);
    });
})();
