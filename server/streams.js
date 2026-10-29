import net from 'node:net';
import { PassThrough, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { Exec, Log, PortForward, CoreV1Api } from '@kubernetes/client-node';
import { configFor, describeError, httpError } from './kube.js';

const DEFAULT_TAIL_LINES = 500;
const SHELL = ['sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'];

// Browser <-> pod log stream. Binary frames carry log chunks; text frames are JSON control messages (end/error).
export async function streamLogs(ws, params) {
  const { context, namespace, pod, container } = params;
  const previous = params.previous === 'true';
  const out = new Writable({
    write(chunk, _enc, done) {
      if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
      done();
    },
  });
  out.on('finish', () => sendControl(ws, { type: 'end' }));
  // client-node pipes the HTTP body into `out` without an error handler; aborting it on close would crash the process.
  out.on('pipe', (src) => src.on('error', () => {}));
  try {
    const abort = await new Log(configFor(context).kc).log(namespace, pod, container, out, {
      follow: !previous,
      previous,
      tailLines: Number(params.tailLines) || DEFAULT_TAIL_LINES,
      timestamps: params.timestamps === 'true',
    });
    ws.on('close', () => abort.abort());
  } catch (err) {
    sendControl(ws, { type: 'error', message: describeError(err).message });
    ws.close();
  }
}

// Interactive shell. Browser sends JSON {type:'stdin',data} / {type:'resize',cols,rows}; pod output goes back as binary frames.
export async function streamExec(ws, params) {
  const { context, namespace, pod, container } = params;
  const stdin = new PassThrough();
  const stdout = new Writable({
    write(chunk, _enc, done) {
      if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
      done();
    },
  });
  // client-node treats stdout as a TTY when it has rows/columns and emits resize through it.
  Object.assign(stdout, { rows: Number(params.rows) || 24, columns: Number(params.cols) || 80 });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'stdin') stdin.write(msg.data);
    if (msg.type === 'resize') {
      Object.assign(stdout, { rows: msg.rows, columns: msg.cols });
      stdout.emit('resize');
    }
  });

  try {
    const conn = await new Exec(configFor(context).kc).exec(namespace, pod, container, SHELL, stdout, stdout, stdin, true, (status) => {
      sendControl(ws, { type: 'exit', status: status.status, message: status.message });
      ws.close();
    });
    conn.on('close', () => ws.close());
    ws.on('close', () => {
      stdin.end();
      conn.close();
    });
  } catch (err) {
    sendControl(ws, { type: 'error', message: describeError(err).message });
    ws.close();
  }
}

const forwards = new Map();

export function listPortForwards() {
  return [...forwards.values()].map(publicForward);
}

// Listens on 127.0.0.1:localPort and tunnels every connection to the pod (or a ready pod behind the service).
export async function startPortForward({ context, namespace, kind, name, port, localPort }) {
  const { kc } = configFor(context);
  const target = await resolveTarget(kc, namespace, kind, name, Number(port));
  const pf = new PortForward(kc);
  const fwd = { id: randomUUID(), context, namespace, kind, name, port: Number(port), targetPort: target.port, localPort: 0, connections: 0, lastError: null };

  const server = net.createServer(async (socket) => {
    fwd.connections++;
    socket.on('close', () => fwd.connections--);
    socket.on('error', () => socket.destroy());
    try {
      const podName = kind === 'services' ? (await resolveTarget(kc, namespace, kind, name, Number(port))).pod : target.pod;
      const conn = await pf.portForward(namespace, podName, [target.port], socket, null, socket);
      socket.on('close', () => conn.close());
    } catch (err) {
      fwd.lastError = describeError(err).message;
      socket.destroy();
    }
  });

  fwd.localPort = await listenWithFallback(server, Number(localPort) || target.port);
  fwd.server = server;
  forwards.set(fwd.id, fwd);
  return publicForward(fwd);
}

export function stopPortForward(id) {
  const fwd = forwards.get(id);
  if (!fwd) throw httpError(404, 'Port forward not found');
  fwd.server.close();
  forwards.delete(id);
}

export function stopAllPortForwards() {
  for (const id of forwards.keys()) stopPortForward(id);
}

async function resolveTarget(kc, namespace, kind, name, port) {
  if (kind === 'pods') return { pod: name, port };
  if (kind !== 'services') throw httpError(400, 'Port forward supports pods and services');

  const core = kc.makeApiClient(CoreV1Api);
  const svc = await core.readNamespacedService({ name, namespace });
  const selector = svc.spec?.selector;
  if (!selector || Object.keys(selector).length === 0) throw httpError(400, `Service ${name} has no selector`);
  const labelSelector = Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(',');
  const pods = await core.listNamespacedPod({ namespace, labelSelector });
  const pod = pods.items.find((p) => p.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True'));
  if (!pod) throw httpError(409, `No ready pod behind service ${name}`);

  const svcPort = svc.spec.ports?.find((p) => p.port === port);
  if (!svcPort) throw httpError(400, `Service ${name} has no port ${port}`);
  const targetPort = svcPort.targetPort ?? svcPort.port;
  if (typeof targetPort === 'number' || /^\d+$/.test(targetPort)) return { pod: pod.metadata.name, port: Number(targetPort) };

  const named = pod.spec.containers.flatMap((c) => c.ports || []).find((p) => p.name === targetPort);
  if (!named) throw httpError(400, `Named port "${targetPort}" not found on pod ${pod.metadata.name}`);
  return { pod: pod.metadata.name, port: named.containerPort };
}

// Tries the preferred port, then the next ones, then lets the OS pick. Never fails just because a port is busy.
export function listenWithFallback(server, preferred, host = '127.0.0.1', attempts = 20) {
  return new Promise((resolve, reject) => {
    const tryPort = (port, left) => {
      const onError = (err) => {
        if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') return reject(err);
        tryPort(left > 0 ? port + 1 : 0, left - 1);
      };
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        resolve(server.address().port);
      });
    };
    tryPort(preferred, attempts);
  });
}

function publicForward({ server, ...rest }) {
  return rest;
}

function sendControl(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
