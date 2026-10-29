import { createContext, useContext, useState } from 'react';
import { api } from './api.js';
import { usePoll } from './hooks.js';
import { parseCpu, parseMemory } from '../shared/quantity.js';

export const METRICS_POLL_MS = 15000;
const MILLI = 1000;
const GI = 2 ** 30;
const MI = 2 ** 20;
const WARN_PCT = 75;
const CRITICAL_PCT = 90;

// Latest `kubectl top` snapshot for the active context, shared by every view.
export const MetricsContext = createContext(null);
export const useMetrics = () => useContext(MetricsContext);

export function useHistory(context, target) {
  return usePoll(() => api('/metrics/history', { query: { context, target } }), [context, target], { interval: METRICS_POLL_MS, enabled: !!target });
}

export function podUsage(metrics, pod) {
  return metrics?.pods?.[`${pod.metadata.namespace}/${pod.metadata.name}`] || null;
}

export function fmtCpu(m) {
  if (m === null || m === undefined) return '–';
  return m < MILLI ? `${Math.round(m)}m` : `${(m / MILLI).toFixed(m < 10 * MILLI ? 2 : 1)} cores`;
}

export function fmtMem(b) {
  if (b === null || b === undefined) return '–';
  return b >= GI ? `${(b / GI).toFixed(1)}Gi` : `${Math.round(b / MI)}Mi`;
}

export const FORMAT = { cpu: fmtCpu, memory: fmtMem };

// Sum of container requests/limits. A limit of 0 means "no limit set" for at least one container.
export function containerResources(c) {
  const r = c.resources || {};
  return {
    reqCpu: parseCpu(r.requests?.cpu),
    reqMem: parseMemory(r.requests?.memory),
    limCpu: parseCpu(r.limits?.cpu),
    limMem: parseMemory(r.limits?.memory),
  };
}

export function podResources(pod) {
  return pod.spec.containers.map(containerResources).reduce(
    (a, c) => ({ reqCpu: a.reqCpu + c.reqCpu, reqMem: a.reqMem + c.reqMem, limCpu: a.limCpu + c.limCpu, limMem: a.limMem + c.limMem }),
    { reqCpu: 0, reqMem: 0, limCpu: 0, limMem: 0 },
  );
}

const isActive = (pod) => !['Succeeded', 'Failed'].includes(pod.status?.phase);

// Which workload owns a pod. ReplicaSet owners are folded into their Deployment via the pod-template-hash label.
export function workloadOf(pod) {
  const owner = pod.metadata.ownerReferences?.find((o) => o.controller) || pod.metadata.ownerReferences?.[0];
  if (!owner) return { kind: 'Pod', name: pod.metadata.name };
  const hash = pod.metadata.labels?.['pod-template-hash'];
  if (owner.kind === 'ReplicaSet' && hash && owner.name.endsWith(`-${hash}`)) return { kind: 'Deployment', name: owner.name.slice(0, -hash.length - 1) };
  return { kind: owner.kind, name: owner.name };
}

// Aggregates usage, requests and limits of pods grouped by keyFn(pod).
export function aggregate(pods, metrics, keyFn) {
  const groups = new Map();
  for (const pod of pods) {
    if (!isActive(pod)) continue;
    const key = keyFn(pod);
    const g = groups.get(key) || { key, pods: 0, cpu: 0, memory: 0, reqCpu: 0, reqMem: 0, limCpu: 0, limMem: 0, sample: pod };
    const u = podUsage(metrics, pod);
    const r = podResources(pod);
    g.pods++;
    g.cpu += u?.cpu || 0;
    g.memory += u?.memory || 0;
    g.reqCpu += r.reqCpu;
    g.reqMem += r.reqMem;
    g.limCpu += r.limCpu;
    g.limMem += r.limMem;
    groups.set(key, g);
  }
  return [...groups.values()];
}

export function tone(pct) {
  if (pct >= CRITICAL_PCT) return 'critical';
  if (pct >= WARN_PCT) return 'warning';
  return 'normal';
}

// Inline usage: value text plus a small bar against `max` (limit, request or allocatable).
export function Meter({ value, max, format, title }) {
  if (value === null || value === undefined) return <span className="faint">–</span>;
  const pct = max > 0 ? (value / max) * 100 : null;
  return (
    <span className="meter" title={title}>
      <span className="meter-value">{format(value)}</span>
      {pct !== null && (
        <span className="meter-track">
          <span className={`meter-fill ${tone(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </span>
      )}
      {pct !== null && <span className="meter-pct">{Math.round(pct)}%</span>}
    </span>
  );
}

// Usage of a pod/container against its limit (or request when no limit), as `kubectl top` plus context.
export function UsageMeter({ used, req, lim, format }) {
  const max = lim || req;
  const title = `${format(used)} used · request ${req ? format(req) : 'none'} · limit ${lim ? format(lim) : 'none'}${max ? ` · % of ${lim ? 'limit' : 'request'}` : ''}`;
  return <Meter value={used} max={max} format={format} title={title} />;
}

const SPARK_W = 120;
const SPARK_H = 30;
const PAD = 3;

// Small trend line with a hover readout. `points` are [{t, value}].
export function Sparkline({ points, format, width = SPARK_W, height = SPARK_H }) {
  const [hover, setHover] = useState(null);
  if (!points || points.length < 2) return <span className="sparkline-empty faint small">collecting…</span>;
  const max = Math.max(...points.map((p) => p.value)) || 1;
  const t0 = points[0].t;
  const span = points.at(-1).t - t0 || 1;
  const x = (p) => PAD + ((p.t - t0) / span) * (width - PAD * 2);
  const y = (p) => height - PAD - (p.value / max) * (height - PAD * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const last = points.at(-1);
  const shown = hover ?? last;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    setHover(points.reduce((best, p) => (Math.abs(x(p) - px) < Math.abs(x(best) - px) ? p : best), points[0]));
  };

  return (
    <span className="sparkline">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <path d={`${d} L${x(last).toFixed(1)},${height - PAD} L${PAD},${height - PAD} Z`} className="spark-area" />
        <path d={d} className="spark-line" />
        {hover && <line x1={x(hover)} x2={x(hover)} y1={PAD} y2={height - PAD} className="spark-cursor" />}
        <circle cx={x(shown)} cy={y(shown)} r={3} className="spark-dot" />
      </svg>
      <span className="spark-readout">
        {format(shown.value)}
        <span className="faint"> {hover ? `${Math.round((Date.now() - hover.t) / 60000)}m ago` : 'now'}</span>
      </span>
    </span>
  );
}

export function historyPoints(history, key) {
  return (history?.points || []).map((p) => ({ t: p.t, value: p[key] }));
}
