import http from 'node:http';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import {
  listContexts, reloadKubeconfig, listResources, countResources, readResource, deleteResource,
  scaleResource, restartResource, describeError, httpError,
} from './kube.js';
import {
  streamLogs, streamExec, listPortForwards, startPortForward, stopPortForward,
  stopAllPortForwards, listenWithFallback,
} from './streams.js';
import { currentMetrics, metricsHistory, metricsHistoryByPrefix } from './metrics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const COOKIE = 'kubeglass_session';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Starts the kubeglass server on 127.0.0.1. Every /api and /ws call needs the session cookie, which is only handed out
 * via the one-time login URL printed/opened at startup, so other websites in your browser cannot drive your clusters.
 */
export async function startServer({ port, dev = false } = {}) {
  const token = randomBytes(24).toString('hex');
  const app = express();
  const server = http.createServer(app);

  app.disable('x-powered-by');
  app.use(rejectForeignHosts);
  app.use(express.json());

  app.get('/login', (req, res) => {
    if (!sameToken(req.query.token, token)) return res.status(403).send('Invalid or expired link. Restart kubeglass and use the new link.');
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/' });
    res.redirect('/');
  });

  const api = express.Router();
  api.use((req, res, next) => {
    if (!sameToken(readCookie(req), token)) return res.status(401).json({ message: 'Not logged in. Open the link printed in the terminal.' });
    if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ message: 'Cross-origin request blocked' });
    next();
  });

  api.get('/contexts', (_req, res) => res.json(listContexts()));
  api.post('/contexts/reload', (_req, res) => {
    reloadKubeconfig();
    res.json(listContexts());
  });
  api.get('/metrics', handle((req) => currentMetrics(req.query.context, req.query.namespace)));
  api.get('/metrics/history', handle((req) =>
    req.query.prefix ? metricsHistoryByPrefix(req.query.context, req.query.prefix) : metricsHistory(req.query.context, req.query.target)));
  api.get('/counts', handle((req) => countResources(req.query.context, req.query.namespace)));
  api.get('/resources/:kind', handle((req) => listResources(req.query.context, req.params.kind, req.query)));
  api.get('/resources/:kind/:namespace/:name', handle((req) => readResource(req.query.context, req.params.kind, ns(req), req.params.name)));
  api.delete('/resources/:kind/:namespace/:name', handle(async (req) => {
    await deleteResource(req.query.context, req.params.kind, ns(req), req.params.name);
    return { ok: true };
  }));
  api.post('/resources/:kind/:namespace/:name/scale', handle(async (req) => {
    const replicas = Number(req.body.replicas);
    if (!Number.isInteger(replicas) || replicas < 0) throw httpError(400, 'replicas must be a non-negative integer');
    await scaleResource(req.query.context, req.params.kind, ns(req), req.params.name, replicas);
    return { ok: true };
  }));
  api.post('/resources/:kind/:namespace/:name/restart', handle(async (req) => {
    await restartResource(req.query.context, req.params.kind, ns(req), req.params.name);
    return { ok: true };
  }));
  api.get('/portforwards', (_req, res) => res.json(listPortForwards()));
  api.post('/portforwards', handle((req) => startPortForward(req.body)));
  api.delete('/portforwards/:id', handle(async (req) => {
    stopPortForward(req.params.id);
    return { ok: true };
  }));
  app.use('/api', api);

  const wss = new WebSocketServer({ noServer: true });
  const streams = { '/ws/logs': streamLogs, '/ws/exec': streamExec };
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const handler = streams[url.pathname];
    if (!handler) return; // not ours (e.g. Vite HMR in dev mode)
    if (!isLocalHost(req.headers.host) || !sameOrigin(req) || !sameToken(readCookie(req), token)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => handler(ws, Object.fromEntries(url.searchParams)));
  });

  if (dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
  }

  const actualPort = await listenWithFallback(server, port);
  const url = `http://localhost:${actualPort}`;
  const close = () => {
    stopAllPortForwards();
    server.close();
  };
  return { url, loginUrl: `${url}/login?token=${token}`, port: actualPort, close };
}

function handle(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      const { status, message } = describeError(err);
      res.status(status).json({ message });
    }
  };
}

function ns(req) {
  return req.params.namespace === '_' ? undefined : req.params.namespace;
}

// Blocks DNS-rebinding: a page on evil.example resolving to 127.0.0.1 still sends Host: evil.example.
function rejectForeignHosts(req, res, next) {
  if (!isLocalHost(req.headers.host)) return res.status(403).send('kubeglass only answers on localhost');
  next();
}

function isLocalHost(host) {
  if (!host) return false;
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOCAL_HOSTS.has(hostname);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readCookie(req) {
  const match = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  return match ? match.slice(COOKIE.length + 1) : '';
}

function sameToken(given, token) {
  if (typeof given !== 'string' || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}
