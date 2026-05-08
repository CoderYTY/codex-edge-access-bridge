'use strict';

const http = require('http');
const crypto = require('crypto');

const HOST = process.env.EDGE_CODEX_HOST || '127.0.0.1';
const PORT = Number(process.env.EDGE_CODEX_PORT || 18888);
const TOKEN = process.env.EDGE_CODEX_TOKEN || '';
const LONG_POLL_MS = Number(process.env.EDGE_CODEX_POLL_MS || 25000);
const DEFAULT_COMMAND_TIMEOUT_MS = Number(process.env.EDGE_CODEX_COMMAND_TIMEOUT_MS || 60000);
const MAX_BODY_BYTES = Number(process.env.EDGE_CODEX_MAX_BODY_BYTES || 25 * 1024 * 1024);

const commandQueue = [];
const pendingCommands = new Map();
const extensionWaiters = new Set();
const clients = new Map();

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function log(message) {
  process.stdout.write(`[${nowIso()}] ${message}\n`);
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

function cleanClients() {
  const cutoff = Date.now() - 120000;
  for (const [clientId, client] of clients.entries()) {
    if (client.lastSeen < cutoff) clients.delete(clientId);
  }
}

function getStatus() {
  cleanClients();
  return {
    ok: true,
    host: HOST,
    port: PORT,
    tokenRequired: Boolean(TOKEN),
    queuedCommands: commandQueue.length,
    pendingCommands: pendingCommands.size,
    waitingExtensions: extensionWaiters.size,
    clients: [...clients.values()].map((client) => ({
      clientId: client.clientId,
      lastSeen: new Date(client.lastSeen).toISOString(),
      userAgent: client.userAgent
    }))
  };
}

function enqueueCommand(command) {
  const liveCommand = {
    id: createId('cmd'),
    name: command.name,
    args: command.args || {},
    createdAt: Date.now()
  };

  commandQueue.push(liveCommand);
  flushWaiters();
  return liveCommand;
}

function flushWaiters() {
  for (const waiter of [...extensionWaiters]) {
    const command = commandQueue.shift();
    if (!command) return;

    extensionWaiters.delete(waiter);
    clearTimeout(waiter.timeout);
    sendJson(waiter.res, 200, command);
  }
}

function waitForExtensionCommand(req, res, clientId) {
  clients.set(clientId, {
    clientId,
    lastSeen: Date.now(),
    userAgent: req.headers['user-agent'] || ''
  });

  const command = commandQueue.shift();
  if (command) {
    sendJson(res, 200, command);
    return;
  }

  const waiter = {
    res,
    timeout: setTimeout(() => {
      extensionWaiters.delete(waiter);
      sendJson(res, 204, { ok: true, empty: true });
    }, LONG_POLL_MS)
  };

  res.on('close', () => {
    extensionWaiters.delete(waiter);
    clearTimeout(waiter.timeout);
  });

  extensionWaiters.add(waiter);
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
  const command = enqueueCommand(body);

  log(`queued ${command.name} (${command.id})`);

  const timeout = setTimeout(() => {
    pendingCommands.delete(command.id);
    const index = commandQueue.findIndex((item) => item.id === command.id);
    if (index >= 0) commandQueue.splice(index, 1);
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
}

async function handleExtensionResult(req, res) {
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

  if (!body.id) {
    sendJson(res, 400, { ok: false, error: 'Missing command id' });
    return;
  }

  if (body.clientId) {
    clients.set(body.clientId, {
      clientId: body.clientId,
      lastSeen: Date.now(),
      userAgent: req.headers['user-agent'] || ''
    });
  }

  const pending = pendingCommands.get(body.id);
  if (!pending) {
    sendJson(res, 404, {
      ok: false,
      error: `No pending command for ${body.id}`
    });
    return;
  }

  clearTimeout(pending.timeout);
  pendingCommands.delete(body.id);

  if (body.ok) {
    sendJson(pending.res, 200, {
      ok: true,
      id: body.id,
      result: body.result ?? null
    });
    log(`completed ${pending.command.name} (${body.id})`);
  } else {
    sendJson(pending.res, 500, {
      ok: false,
      id: body.id,
      error: body.error || 'Extension command failed'
    });
    log(`failed ${pending.command.name} (${body.id}): ${body.error || 'unknown error'}`);
  }

  sendJson(res, 200, { ok: true });
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

  if (req.method === 'GET' && url.pathname === '/extension/next') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      return;
    }
    const clientId = url.searchParams.get('clientId') || createId('extension');
    waitForExtensionCommand(req, res, clientId);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/extension/result') {
    handleExtensionResult(req, res).catch((error) => {
      sendJson(res, 500, { ok: false, error: error.message });
    });
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

const server = http.createServer(route);

server.on('clientError', (error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  log(`client error: ${error.message}`);
});

server.listen(PORT, HOST, () => {
  log(`Edge Codex bridge listening on http://${HOST}:${PORT}`);
  log(TOKEN ? 'token auth: enabled' : 'token auth: disabled');
  log('load the extension/ directory in Edge, then keep its dashboard tab open');
});

process.on('SIGINT', () => {
  log('shutting down');
  for (const commandId of pendingCommands.keys()) {
    rejectPending(commandId, 'Bridge server is shutting down');
  }
  server.close(() => process.exit(0));
});
