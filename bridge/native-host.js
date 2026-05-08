'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST = process.env.EDGE_CODEX_HOST || '127.0.0.1';
const PORT = Number(process.env.EDGE_CODEX_PORT || 18888);
const TOKEN = process.env.EDGE_CODEX_TOKEN || '';
const DEFAULT_COMMAND_TIMEOUT_MS = Number(process.env.EDGE_CODEX_COMMAND_TIMEOUT_MS || 60000);
const MAX_BODY_BYTES = Number(process.env.EDGE_CODEX_MAX_BODY_BYTES || 25 * 1024 * 1024);
const MAX_NATIVE_OUTBOUND_BYTES = 1024 * 1024;
const HELLO_TIMEOUT_MS = Number(process.env.EDGE_CODEX_HELLO_TIMEOUT_MS || 15000);
const LOG_FILE = process.env.EDGE_CODEX_NATIVE_LOG || path.resolve(__dirname, '..', 'native', 'native-host.log');

const pendingCommands = new Map();
let nativeInput = Buffer.alloc(0);
let client = null;
let server = null;
let shuttingDown = false;
let helloTimeout = null;
let serverStarted = false;

function nowIso() {
  return new Date().toISOString();
}

function log(message) {
  const line = `[${nowIso()}] ${message}\n`;
  process.stderr.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (_) {
    // stderr remains the fallback for browser-side native messaging logs.
  }
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function sendNativeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.length > MAX_NATIVE_OUTBOUND_BYTES) {
    throw new Error(`Native message exceeds ${MAX_NATIVE_OUTBOUND_BYTES} bytes`);
  }

  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(header);
  process.stdout.write(body);
}

function sendJson(res, statusCode, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, statusCode, body) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function isAuthorized(req) {
  if (!TOKEN) return true;
  const header = req.headers.authorization || '';
  return header === `Bearer ${TOKEN}`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });

    req.on('error', reject);
  });
}

function getStatus() {
  return {
    ok: true,
    mode: 'native',
    host: HOST,
    port: PORT,
    tokenRequired: Boolean(TOKEN),
    pendingCommands: pendingCommands.size,
    nativeConnected: Boolean(client),
    client: client
      ? {
          clientId: client.clientId,
          lastSeen: new Date(client.lastSeen).toISOString(),
          extensionVersion: client.extensionVersion || '',
          userAgent: client.userAgent || ''
        }
      : null
  };
}

function rejectPending(commandId, errorMessage) {
  const pending = pendingCommands.get(commandId);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  pendingCommands.delete(commandId);
  sendJson(pending.res, 504, {
    ok: false,
    error: errorMessage,
    id: commandId
  });
  return true;
}

function rejectAllPending(errorMessage) {
  for (const commandId of pendingCommands.keys()) {
    rejectPending(commandId, errorMessage);
  }
}

async function handleCommand(req, res) {
  if (!isAuthorized(req)) {
    sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
    return;
  }

  if (!body.name || typeof body.name !== 'string') {
    sendJson(res, 400, { ok: false, error: 'Missing command name' });
    return;
  }

  const timeoutMs = Math.max(1000, Number(body.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS));
  const command = {
    id: createId('cmd'),
    name: body.name,
    args: body.args || {},
    createdAt: Date.now()
  };

  const timeout = setTimeout(() => {
    pendingCommands.delete(command.id);
    sendJson(res, 504, {
      ok: false,
      id: command.id,
      error: `Command timed out after ${timeoutMs} ms`
    });
  }, timeoutMs);

  pendingCommands.set(command.id, { res, timeout, command });

  req.on('close', () => {
    if (res.writableEnded) return;
    clearTimeout(timeout);
    pendingCommands.delete(command.id);
  });

  try {
    if (!client) {
      log('sending command before extension hello; native port is assumed to be open');
    }
    sendNativeMessage({
      type: 'command',
      command
    });
    log(`sent ${command.name} (${command.id})`);
  } catch (error) {
    clearTimeout(timeout);
    pendingCommands.delete(command.id);
    sendJson(res, 500, {
      ok: false,
      id: command.id,
      error: error.message
    });
  }
}

function handleExtensionResult(message) {
  if (!message.id) {
    log('ignored result without id');
    return;
  }

  if (client) client.lastSeen = Date.now();

  const pending = pendingCommands.get(message.id);
  if (!pending) {
    log(`no pending command for ${message.id}`);
    return;
  }

  clearTimeout(pending.timeout);
  pendingCommands.delete(message.id);

  if (message.ok) {
    sendJson(pending.res, 200, {
      ok: true,
      id: message.id,
      result: message.result ?? null
    });
    log(`completed ${pending.command.name} (${message.id})`);
  } else {
    sendJson(pending.res, 500, {
      ok: false,
      id: message.id,
      error: message.error || 'Extension command failed'
    });
    log(`failed ${pending.command.name} (${message.id}): ${message.error || 'unknown error'}`);
  }
}

function handleNativeMessage(message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'hello') {
    if (helloTimeout) {
      clearTimeout(helloTimeout);
      helloTimeout = null;
    }
    client = {
      clientId: message.clientId || createId('extension'),
      extensionVersion: message.extensionVersion || '',
      userAgent: message.userAgent || '',
      lastSeen: Date.now()
    };
    log(`extension connected: ${client.clientId}`);
    startServer();
    return;
  }

  if (message.type === 'ping') {
    if (client) client.lastSeen = Date.now();
    sendNativeMessage({
      type: 'pong',
      at: Date.now(),
      status: getStatus()
    });
    return;
  }

  if (message.type === 'result') {
    handleExtensionResult(message);
    return;
  }

  log(`ignored native message type: ${message.type || '(missing)'}`);
}

function handleNativeData(chunk) {
  nativeInput = Buffer.concat([nativeInput, chunk]);

  while (nativeInput.length >= 4) {
    const length = nativeInput.readUInt32LE(0);
    if (length > MAX_BODY_BYTES) {
      log(`native message too large: ${length}`);
      shutdown(1);
      return;
    }
    if (nativeInput.length < length + 4) return;

    const body = nativeInput.slice(4, length + 4).toString('utf8');
    nativeInput = nativeInput.slice(length + 4);

    try {
      handleNativeMessage(JSON.parse(body));
    } catch (error) {
      log(`invalid native message: ${error.message}`);
    }
  }
}

function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === 'OPTIONS') {
    sendText(res, 204, '');
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    sendJson(res, 200, getStatus());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/command') {
    handleCommand(req, res).catch((error) => {
      sendJson(res, 500, { ok: false, error: error.message });
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
}

function startServer() {
  if (serverStarted) {
    sendNativeMessage({
      type: 'ready',
      status: getStatus()
    });
    return;
  }
  serverStarted = true;
  server = http.createServer(route);

  server.on('clientError', (error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    log(`client error: ${error.message}`);
  });

  server.on('error', (error) => {
    log(`server error: ${error.message}`);
    try {
      sendNativeMessage({
        type: 'hostError',
        error: error.message,
        status: getStatus()
      });
    } catch (_) {
      // The browser may already have closed the native port.
    }
    shutdown(1);
  });

  server.listen(PORT, HOST, () => {
    log(`native host HTTP bridge listening on http://${HOST}:${PORT}`);
    try {
      sendNativeMessage({
        type: 'ready',
        status: getStatus()
      });
    } catch (_) {
      // The extension sends hello immediately after connectNative; if this fails,
      // stdin close handling below will stop the process.
    }
  });
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (helloTimeout) {
    clearTimeout(helloTimeout);
    helloTimeout = null;
  }
  rejectAllPending('Native host is shutting down');
  if (server) {
    server.close(() => process.exit(exitCode));
    setTimeout(() => process.exit(exitCode), 1000).unref();
  } else {
    process.exit(exitCode);
  }
}

process.stdin.on('data', handleNativeData);
process.stdin.on('end', () => shutdown(0));
process.stdin.on('error', (error) => {
  log(`stdin error: ${error.message}`);
  shutdown(1);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (error) => {
  log(`uncaught exception: ${error.stack || error.message}`);
  shutdown(1);
});

helloTimeout = setTimeout(() => {
  log(`no extension hello received in ${HELLO_TIMEOUT_MS} ms`);
  shutdown(1);
}, HELLO_TIMEOUT_MS);
