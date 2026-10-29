import { CustomObjectsApi } from '@kubernetes/client-node';
import { configFor, describeError } from './kube.js';
import { parseCpu, parseMemory } from '../shared/quantity.js';

const SAMPLE_MS = 15000;
const HISTORY_POINTS = 60; // 15 minutes at SAMPLE_MS
const IDLE_STOP_MS = 5 * 60 * 1000;

// One background sampler per context, started on first use and stopped after IDLE_STOP_MS without requests.
// It keeps the latest `kubectl top` snapshot plus a short history for sparklines.
const samplers = new Map();

export async function currentMetrics(context, namespace) {
  const s = await samplerFor(context);
  if (s.podsForbidden && namespace) return namespaceSnapshot(context, namespace, s);
  const pods = namespace ? filterPods(s.latest.pods, namespace) : s.latest.pods;
  return { ...s.latest, pods };
}

export async function metricsHistory(context, target) {
  const s = await samplerFor(context);
  return { intervalMs: SAMPLE_MS, points: s.history.get(target) || [] };
}

// All series whose key starts with prefix, e.g. "namespace/" for every namespace at once.
export async function metricsHistoryByPrefix(context, prefix) {
  const s = await samplerFor(context);
  const series = {};
  for (const [key, points] of s.history) if (key.startsWith(prefix)) series[key.slice(prefix.length)] = points;
  return { intervalMs: SAMPLE_MS, series };
}

async function samplerFor(context) {
  let s = samplers.get(context);
  if (!s) {
    s = { latest: emptySnapshot(), history: new Map(), lastRequest: Date.now(), podsForbidden: false };
    samplers.set(context, s);
    s.ready = sample(context, s);
    s.timer = setInterval(() => {
      if (Date.now() - s.lastRequest > IDLE_STOP_MS) {
        clearInterval(s.timer);
        samplers.delete(context);
        return;
      }
      sample(context, s);
    }, SAMPLE_MS);
  }
  s.lastRequest = Date.now();
  await s.ready;
  return s;
}

// Not client-node's Metrics class: it parses the body as JSON before checking the status, so a cluster
// without metrics-server (plain-text "404 page not found") surfaces as an unreadable 500.
const METRICS_GROUP = { group: 'metrics.k8s.io', version: 'v1beta1' };

function listMetrics(context, plural, namespace) {
  const api = configFor(context).kc.makeApiClient(CustomObjectsApi);
  return namespace
    ? api.listNamespacedCustomObject({ ...METRICS_GROUP, plural, namespace })
    : api.listClusterCustomObject({ ...METRICS_GROUP, plural });
}

async function sample(context, s) {
  const [nodeRes, podRes] = await Promise.allSettled([listMetrics(context, 'nodes'), listMetrics(context, 'pods')]);
  const at = Date.now();
  const snapshot = { available: true, at, error: null, nodes: {}, pods: {} };

  if (nodeRes.status === 'fulfilled') {
    for (const n of nodeRes.value.items) snapshot.nodes[n.metadata.name] = usage(n.usage);
  }
  if (podRes.status === 'fulfilled') {
    s.podsForbidden = false;
    for (const p of podRes.value.items) snapshot.pods[`${p.metadata.namespace}/${p.metadata.name}`] = podUsage(p);
  } else {
    s.podsForbidden = describeError(podRes.reason).status === 403;
  }
  if (nodeRes.status === 'rejected' && podRes.status === 'rejected') {
    const err = describeError(podRes.reason);
    snapshot.available = false;
    snapshot.error = err.status === 404 || err.status === 503 ? 'metrics-server is not installed or not ready in this cluster' : err.message;
  }
  s.latest = snapshot;
  record(s, at, snapshot);
}

function record(s, at, snapshot) {
  const push = (key, u) => {
    const series = s.history.get(key) || [];
    series.push({ t: at, cpu: u.cpu, memory: u.memory });
    if (series.length > HISTORY_POINTS) series.shift();
    s.history.set(key, series);
  };
  const seen = new Set();
  const mark = (key, u) => {
    seen.add(key);
    push(key, u);
  };

  const nodes = Object.entries(snapshot.nodes);
  if (nodes.length) mark('cluster', sum(nodes.map(([, u]) => u)));
  for (const [name, u] of nodes) mark(`node/${name}`, u);

  const byNamespace = {};
  for (const [key, u] of Object.entries(snapshot.pods)) {
    mark(`pod/${key}`, u);
    const ns = key.split('/')[0];
    byNamespace[ns] = sum([byNamespace[ns] || { cpu: 0, memory: 0 }, u]);
  }
  for (const [ns, u] of Object.entries(byNamespace)) mark(`namespace/${ns}`, u);

  // Forget pods/nodes that disappeared so history does not grow forever.
  for (const key of s.history.keys()) if (!seen.has(key)) s.history.delete(key);
}

async function namespaceSnapshot(context, namespace, s) {
  try {
    const res = await listMetrics(context, 'pods', namespace);
    const pods = Object.fromEntries(res.items.map((p) => [`${p.metadata.namespace}/${p.metadata.name}`, podUsage(p)]));
    return { ...s.latest, available: true, error: null, pods };
  } catch (err) {
    return { ...s.latest, available: false, error: describeError(err).message, pods: {} };
  }
}

function podUsage(p) {
  const containers = Object.fromEntries(p.containers.map((c) => [c.name, usage(c.usage)]));
  return { ...sum(Object.values(containers)), containers };
}

function usage(u) {
  return { cpu: parseCpu(u.cpu), memory: parseMemory(u.memory) };
}

function sum(list) {
  return list.reduce((acc, u) => ({ cpu: acc.cpu + u.cpu, memory: acc.memory + u.memory }), { cpu: 0, memory: 0 });
}

function filterPods(pods, namespace) {
  return Object.fromEntries(Object.entries(pods).filter(([key]) => key.startsWith(`${namespace}/`)));
}

function emptySnapshot() {
  return { available: false, at: 0, error: null, nodes: {}, pods: {} };
}
