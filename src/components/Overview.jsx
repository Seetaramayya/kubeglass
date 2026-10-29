import { useState } from 'react';
import { CircleCheck, LayoutDashboard, TriangleAlert } from 'lucide-react';
import { api } from '../api.js';
import { KINDS } from '../../shared/kinds.js';
import { KIND_ICONS } from '../icons.js';
import { Status, eventTime, nodeStatus, restarts } from '../columns.jsx';
import { usePoll } from '../hooks.js';
import { age, kubectl, nsFlag, podStatus, statusTone } from '../util.js';
import KubectlHint from './KubectlHint.jsx';
import ErrorBox from './ErrorBox.jsx';
import UsageSummary from './UsageSummary.jsx';
import { UsageMeter, aggregate, fmtCpu, fmtMem, historyPoints, podResources, podUsage, useHistory, useMetrics } from '../usage.jsx';
import { parseCpu, parseMemory } from '../../shared/quantity.js';

const POLL_MS = 10000;
const MAX_ROWS = 10;
const RESTART_ALERT = 5;
const TONE_ORDER = { critical: 0, warning: 1, good: 2, neutral: 3 };
const POD_GROUPS = [
  { tone: 'good', label: 'Running' },
  { tone: 'warning', label: 'Pending' },
  { tone: 'critical', label: 'Failing' },
  { tone: 'neutral', label: 'Completed' },
];

async function loadOverview(context, namespace) {
  const list = (kind, extra = {}) => api(`/resources/${kind}`, { query: { context, namespace: KINDS[kind].namespaced ? namespace : undefined, ...extra } });
  const [pods, nodes, deployments, statefulsets, daemonsets, jobs, warnings] = await Promise.all([
    list('pods'),
    list('nodes').catch(() => null), // node listing is often forbidden for namespace-scoped users
    list('deployments'),
    list('statefulsets'),
    list('daemonsets'),
    list('jobs'),
    list('events', { fieldSelector: 'type=Warning' }),
  ]);
  return { pods, nodes, deployments, statefulsets, daemonsets, jobs, warnings };
}

export default function Overview({ context, namespace, actions, onKind }) {
  const { data, error } = usePoll(() => loadOverview(context, namespace), [context, namespace], { interval: POLL_MS });

  return (
    <div className="overview-page">
      <header className="page-header">
        <h1><LayoutDashboard size={18} className="title-icon" /> Overview</h1>
        <span className="muted small">{namespace ? `Namespace ${namespace}` : 'All namespaces'} · refreshes every {POLL_MS / 1000}s</span>
      </header>
      <ErrorBox error={error} />
      {!data && !error && <div className="muted">Loading cluster state…</div>}
      {data && <Dashboard data={data} context={context} namespace={namespace} actions={actions} onKind={onKind} />}
    </div>
  );
}

function Dashboard({ data, context, namespace, actions, onKind }) {
  const { pods, nodes, deployments, statefulsets, daemonsets, jobs, warnings } = data;
  const podTones = pods.map((p) => ({ pod: p, status: podStatus(p), tone: statusTone(podStatus(p)) }));
  const countTone = (tone) => podTones.filter((p) => p.tone === tone).length;

  const workloads = [
    ...deployments.map((o) => ({ kind: 'deployments', o, ready: o.status?.readyReplicas || 0, want: o.spec.replicas ?? 0 })),
    ...statefulsets.map((o) => ({ kind: 'statefulsets', o, ready: o.status?.readyReplicas || 0, want: o.spec.replicas ?? 0 })),
    ...daemonsets.map((o) => ({ kind: 'daemonsets', o, ready: o.status?.numberReady || 0, want: o.status?.desiredNumberScheduled || 0 })),
  ];
  const degraded = workloads.filter((w) => w.ready < w.want);
  const healthy = (kind) => workloads.filter((w) => w.kind === kind && w.ready >= w.want).length;

  const badPods = podTones
    .filter((p) => p.tone === 'critical' || p.tone === 'warning' || restarts(p.pod) >= RESTART_ALERT)
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || restarts(b.pod) - restarts(a.pod));
  const recentWarnings = [...warnings].sort((a, b) => new Date(eventTime(b)) - new Date(eventTime(a)));
  const failedJobs = jobs.filter((j) => (j.status?.conditions || []).some((c) => c.type === 'Failed' && c.status === 'True')).length;
  const readyNodes = nodes?.filter((n) => nodeStatus(n).startsWith('Ready')).length;

  // Usage: whole cluster (node metrics vs allocatable) or, with a namespace selected, just its pods.
  const metrics = useMetrics();
  const history = useHistory(context, namespace ? `namespace/${namespace}` : 'cluster');
  const totals = aggregate(pods, metrics, () => 'all')[0] || { cpu: 0, memory: 0, reqCpu: 0, reqMem: 0, limCpu: 0, limMem: 0 };
  const nodeUsage = !namespace && metrics?.nodes ? Object.values(metrics.nodes) : [];
  const used = nodeUsage.length ? nodeUsage.reduce((s, u) => ({ cpu: s.cpu + u.cpu, memory: s.memory + u.memory }), { cpu: 0, memory: 0 }) : totals;
  const capacity = !namespace && nodes ? {
    cpu: nodes.reduce((s, n) => s + parseCpu(n.status?.allocatable?.cpu), 0),
    memory: nodes.reduce((s, n) => s + parseMemory(n.status?.allocatable?.memory), 0),
  } : null;
  const topBy = (key) => pods.filter((p) => podUsage(metrics, p)).sort((a, b) => podUsage(metrics, b)[key] - podUsage(metrics, a)[key]).slice(0, MAX_ROWS);

  return (
    <>
      <div className="tiles">
        {nodes && (
          <Tile kind="nodes" onKind={onKind} value={readyNodes} of={nodes.length}
            sub={readyNodes === nodes.length ? <Status tone="good" value="All ready" /> : <Status tone="critical" value={`${nodes.length - readyNodes} not ready`} />} />
        )}
        <Tile kind="pods" onKind={onKind} value={countTone('good')} of={pods.length}
          sub={countTone('critical') ? <Status tone="critical" value={`${countTone('critical')} failing`} /> : countTone('warning') ? <Status tone="warning" value={`${countTone('warning')} pending`} /> : <span>running</span>} />
        <Tile kind="deployments" onKind={onKind} value={healthy('deployments')} of={deployments.length} sub={<span>available</span>} />
        <Tile kind="statefulsets" onKind={onKind} value={healthy('statefulsets')} of={statefulsets.length} sub={<span>ready</span>} />
        <Tile kind="daemonsets" onKind={onKind} value={healthy('daemonsets')} of={daemonsets.length} sub={<span>ready</span>} />
        <Tile kind="jobs" onKind={onKind} value={jobs.length} sub={failedJobs ? <Status tone="critical" value={`${failedJobs} failed`} /> : <span>none failed</span>} />
      </div>

      {metrics?.available ? (
        <div className="usage-summary">
          <UsageSummary label={namespace ? `CPU · ${namespace}` : 'Cluster CPU'} used={metrics ? used.cpu : null} requested={totals.reqCpu} limits={totals.limCpu} capacity={capacity?.cpu} format={fmtCpu} points={historyPoints(history.data, 'cpu')} />
          <UsageSummary label={namespace ? `Memory · ${namespace}` : 'Cluster memory'} used={metrics ? used.memory : null} requested={totals.reqMem} limits={totals.limMem} capacity={capacity?.memory} format={fmtMem} points={historyPoints(history.data, 'memory')} />
        </div>
      ) : metrics?.error ? (
        <ErrorBox error={{ message: `Resource usage unavailable: ${metrics.error}` }} />
      ) : null}

      <div className="panels">
        {metrics?.available && <TopPods title="Top pods by CPU" pods={topBy('cpu')} usageKey="cpu" metrics={metrics} namespace={namespace} actions={actions} command={kubectl(context, 'top', 'pods', nsFlag(namespace), '--sort-by=cpu')} />}
        {metrics?.available && <TopPods title="Top pods by memory" pods={topBy('memory')} usageKey="memory" metrics={metrics} namespace={namespace} actions={actions} command={kubectl(context, 'top', 'pods', nsFlag(namespace), '--sort-by=memory')} />}
        <section className="card panel">
          <div className="panel-head"><h3>Pod status</h3><span className="count-pill">{pods.length}</span></div>
          <div className="panel-body">
            <StackedBar groups={POD_GROUPS.map((g) => ({ ...g, count: countTone(g.tone) }))} />
            <div className="legend">
              {POD_GROUPS.map((g) => (
                <span key={g.tone} className="legend-item">
                  <i className={`legend-swatch tone-${g.tone}`} />
                  {g.label} <b>{countTone(g.tone)}</b>
                </span>
              ))}
            </div>
          </div>
          <KubectlHint command={kubectl(context, 'get', 'pods', nsFlag(namespace), "--field-selector=status.phase!=Running")} />
        </section>

        <section className="card panel">
          <div className="panel-head"><h3>Workloads not fully ready</h3>{degraded.length > 0 && <span className="count-pill">{degraded.length}</span>}</div>
          {degraded.length === 0 ? (
            <div className="all-good"><CircleCheck size={16} /> All {workloads.length} workloads have every replica ready</div>
          ) : (
            <table className="table compact">
              <thead><tr><th style={{ width: '42%' }}>Name</th><th>Kind</th><th style={{ width: 80 }}>Ready</th>{!namespace && <th>Namespace</th>}</tr></thead>
              <tbody>
                {degraded.slice(0, MAX_ROWS).map((w) => (
                  <tr key={w.o.metadata.uid} onClick={() => actions.select(w.kind, w.o.metadata.namespace, w.o.metadata.name)}>
                    <td className="name">{w.o.metadata.name}</td>
                    <td>{KINDS[w.kind].kind}</td>
                    <td className="num"><Status tone={w.ready === 0 ? 'critical' : 'warning'} value={`${w.ready}/${w.want}`} /></td>
                    {!namespace && <td>{w.o.metadata.namespace}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card panel">
          <div className="panel-head"><h3>Pods needing attention</h3>{badPods.length > 0 && <span className="count-pill">{badPods.length}</span>}</div>
          {badPods.length === 0 ? (
            <div className="all-good"><CircleCheck size={16} /> No failing, pending or frequently restarting pods</div>
          ) : (
            <table className="table compact">
              <thead><tr><th style={{ width: '46%' }}>Name</th><th>Status</th><th style={{ width: 80 }}>Restarts</th><th style={{ width: 64 }}>Age</th></tr></thead>
              <tbody>
                {badPods.slice(0, MAX_ROWS).map(({ pod, status }) => (
                  <tr key={pod.metadata.uid} onClick={() => actions.select('pods', pod.metadata.namespace, pod.metadata.name)}>
                    <td className="name" title={`${pod.metadata.namespace}/${pod.metadata.name}`}>{pod.metadata.name}</td>
                    <td><Status value={status} /></td>
                    <td className="num">{restarts(pod)}</td>
                    <td className="num">{age(pod.metadata.creationTimestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card panel">
          <div className="panel-head"><h3>Recent warnings</h3>{recentWarnings.length > 0 && <span className="count-pill">{recentWarnings.length}</span>}</div>
          {recentWarnings.length === 0 ? (
            <div className="all-good"><CircleCheck size={16} /> No warning events in the last hour</div>
          ) : (
            <table className="table compact">
              <thead><tr><th style={{ width: '24%' }}>Reason</th><th style={{ width: '30%' }}>Object</th><th>Message</th><th style={{ width: 64 }}>Seen</th></tr></thead>
              <tbody>
                {recentWarnings.slice(0, MAX_ROWS).map((e) => (
                  <tr key={e.metadata.uid} onClick={() => actions.select('events', e.metadata.namespace, e.metadata.name)}>
                    <td><span className="status"><TriangleAlert size={13} style={{ color: 'var(--warning)' }} />{e.reason}</span></td>
                    <td title={`${e.involvedObject.kind}/${e.involvedObject.name}`}>{e.involvedObject.name}</td>
                    <td className="muted" title={e.message}>{e.message}</td>
                    <td className="num">{age(eventTime(e))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

function TopPods({ title, pods, usageKey, metrics, namespace, actions, command }) {
  const format = usageKey === 'cpu' ? fmtCpu : fmtMem;
  return (
    <section className="card panel">
      <div className="panel-head"><h3>{title}</h3></div>
      <table className="table compact">
        <thead><tr><th style={{ width: '50%' }}>Pod</th>{!namespace && <th>Namespace</th>}<th style={{ width: 170 }}>{usageKey === 'cpu' ? 'CPU' : 'Memory'} (% of limit)</th></tr></thead>
        <tbody>
          {pods.map((p) => {
            const r = podResources(p);
            const [req, lim] = usageKey === 'cpu' ? [r.reqCpu, r.limCpu] : [r.reqMem, r.limMem];
            return (
              <tr key={p.metadata.uid} onClick={() => actions.select('pods', p.metadata.namespace, p.metadata.name)}>
                <td className="name" title={p.metadata.name}>{p.metadata.name}</td>
                {!namespace && <td>{p.metadata.namespace}</td>}
                <td><UsageMeter used={podUsage(metrics, p)[usageKey]} req={req} lim={lim} format={format} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <KubectlHint command={command} />
    </section>
  );
}

function Tile({ kind, value, of, sub, onKind }) {
  const Icon = KIND_ICONS[kind];
  return (
    <button className="card tile" onClick={() => onKind(kind)}>
      <div className="tile-label"><Icon size={14} /> {KINDS[kind].label}</div>
      <div className="tile-value">
        {value}
        {of !== undefined && <span className="of"> / {of}</span>}
      </div>
      <div className="tile-sub">{sub}</div>
    </button>
  );
}

// Proportional bar of pod states with a per-segment hover tooltip.
function StackedBar({ groups }) {
  const [hover, setHover] = useState(null);
  const total = groups.reduce((s, g) => s + g.count, 0);
  if (total === 0) return <div className="muted small">No pods</div>;
  let offset = 0;
  return (
    <div className="stack" onMouseLeave={() => setHover(null)}>
      {groups.filter((g) => g.count > 0).map((g) => {
        const pct = (g.count / total) * 100;
        const center = offset + pct / 2;
        offset += pct;
        return <div key={g.tone} className={`stack-seg tone-${g.tone}`} style={{ flexGrow: g.count }} onMouseEnter={() => setHover({ ...g, center, pct })} />;
      })}
      {hover && (
        <div className="tooltip" style={{ left: `${hover.center}%` }}>
          {hover.label}: <b>{hover.count}</b> ({Math.round(hover.pct)}%)
        </div>
      )}
    </div>
  );
}
