import { KubeConfig, KubernetesObjectApi, PatchStrategy } from '@kubernetes/client-node';
import { KINDS } from '../shared/kinds.js';

const LAST_APPLIED = 'kubectl.kubernetes.io/last-applied-configuration';

let base = loadBase();
const clients = new Map();

function loadBase() {
  const kc = new KubeConfig();
  kc.loadFromDefault();
  return kc;
}

export function reloadKubeconfig() {
  base = loadBase();
  clients.clear();
}

export function listContexts() {
  const current = base.getCurrentContext();
  return base.getContexts().map((c) => ({
    name: c.name,
    cluster: c.cluster,
    user: c.user,
    namespace: c.namespace || null,
    server: base.getCluster(c.cluster)?.server || null,
    current: c.name === current,
  }));
}

// A KubeConfig bound to one context. Each context gets its own instance so concurrent requests never race on setCurrentContext.
export function configFor(context) {
  if (!base.getContextObject(context)) throw httpError(404, `Unknown context "${context}"`);
  let entry = clients.get(context);
  if (!entry) {
    const kc = new KubeConfig();
    kc.loadFromDefault();
    kc.setCurrentContext(context);
    entry = { kc, objects: kc.makeApiClient(KubernetesObjectApi) };
    clients.set(context, entry);
  }
  return entry;
}

export function kindDef(key) {
  const def = KINDS[key];
  if (!def) throw httpError(400, `Unknown resource kind "${key}"`);
  return def;
}

export async function listResources(context, key, { namespace, labelSelector, fieldSelector } = {}) {
  const def = kindDef(key);
  const ns = def.namespaced ? namespace || undefined : undefined;
  const res = await configFor(context).objects.list(def.apiVersion, def.kind, ns, undefined, undefined, undefined, fieldSelector, labelSelector);
  return res.items.map((item) => slim({ ...item, apiVersion: def.apiVersion, kind: def.kind }, true));
}

// Cheap per-kind counts: list with limit=1 and read remainingItemCount instead of downloading everything.
export async function countResources(context, namespace) {
  const { objects } = configFor(context);
  const entries = await Promise.all(
    Object.entries(KINDS).map(async ([key, def]) => {
      const ns = def.namespaced ? namespace || undefined : undefined;
      try {
        const res = await objects.list(def.apiVersion, def.kind, ns, undefined, undefined, undefined, undefined, undefined, 1);
        return [key, res.items.length + (res.metadata?.remainingItemCount || 0)];
      } catch {
        return [key, null];
      }
    }),
  );
  return Object.fromEntries(entries);
}

export async function readResource(context, key, namespace, name) {
  const def = kindDef(key);
  const obj = await configFor(context).objects.read(spec(def, namespace, name));
  return slim(obj, false);
}

export async function deleteResource(context, key, namespace, name) {
  const def = kindDef(key);
  await configFor(context).objects.delete(spec(def, namespace, name));
}

export async function scaleResource(context, key, namespace, name, replicas) {
  const def = kindDef(key);
  await mergePatch(context, { ...spec(def, namespace, name), spec: { replicas } });
}

// Same patch `kubectl rollout restart` sends.
export async function restartResource(context, key, namespace, name) {
  const def = kindDef(key);
  const annotations = { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() };
  await mergePatch(context, { ...spec(def, namespace, name), spec: { template: { metadata: { annotations } } } });
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Turns client-node ApiException / exec-plugin errors into { status, message } the UI can show.
export function describeError(err) {
  if (err.status) return { status: err.status, message: err.message };
  if (typeof err.code === 'number' && err.code >= 400) {
    return { status: err.code, message: apiMessage(err.body) || err.message };
  }
  return { status: 502, message: withRootCause(err) };
}

// Node's fetch hides the real reason ("getaddrinfo ENOTFOUND ...") in err.cause.
function withRootCause(err) {
  let root = err;
  while (root.cause instanceof Error) root = root.cause;
  const message = err.message || String(err);
  return root === err || message.includes(root.message) ? message : `${message} (${root.message})`;
}

function apiMessage(body) {
  if (body && typeof body === 'object') return body.message;
  try {
    return JSON.parse(body).message;
  } catch {
    return body ? String(body) : null;
  }
}

function mergePatch(context, body) {
  return configFor(context).objects.patch(body, undefined, undefined, undefined, undefined, PatchStrategy.MergePatch);
}

function spec(def, namespace, name) {
  const metadata = def.namespaced ? { name, namespace } : { name };
  return { apiVersion: def.apiVersion, kind: def.kind, metadata };
}

function slim(obj, forList) {
  if (!obj?.metadata) return obj;
  const metadata = { ...obj.metadata };
  delete metadata.managedFields;
  if (forList && metadata.annotations?.[LAST_APPLIED]) {
    metadata.annotations = { ...metadata.annotations };
    delete metadata.annotations[LAST_APPLIED];
  }
  return { ...obj, metadata };
}
