import { useMemo, useState } from 'react';
import { Activity, ArrowDown, ArrowUp } from 'lucide-react';
import { api } from '../api.js';
import { KIND_BY_NAME } from '../../shared/kinds.js';
import { parseCpu, parseMemory } from '../../shared/quantity.js';
import { usePoll } from '../hooks.js';
import { kubectl } from '../util.js';
import { METRICS_POLL_MS, Sparkline, UsageMeter, aggregate, fmtCpu, fmtMem, historyPoints, useHistory, workloadOf } from '../usage.jsx';
import KubectlHint from './KubectlHint.jsx';
import ErrorBox from './ErrorBox.jsx';
import UsageSummary from './UsageSummary.jsx';

const GROUPINGS = {
  namespace: { label: 'Namespace', key: (p) => p.metadata.namespace },
  workload: { label: 'Workload', key: (p) => { const w = workloadOf(p); return `${p.metadata.namespace}/${w.kind}/${w.name}`; } },
};

const COLS = [
  { label: 'Pods', value: (g) => g.pods },
  { label: 'CPU used', value: (g) => g.cpu, render: (g) => <UsageMeter used={g.cpu} req={g.reqCpu} lim={g.limCpu} format={fmtCpu} /> },
  { label: 'CPU share', value: (g, t) => g.cpu / (t.cpu || 1), render: (g, t) => share(g.cpu, t.cpu) },
  { label: 'CPU req', value: (g) => g.reqCpu, render: (g) => (g.reqCpu ? fmtCpu(g.reqCpu) : <span className="faint">none</span>) },
  { label: 'CPU limit', value: (g) => g.limCpu, render: (g) => (g.limCpu ? fmtCpu(g.limCpu) : <span className="faint">none</span>) },
  { label: 'Mem used', value: (g) => g.memory, render: (g) => <UsageMeter used={g.memory} req={g.reqMem} lim={g.limMem} format={fmtMem} /> },
  { label: 'Mem share', value: (g, t) => g.memory / (t.memory || 1), render: (g, t) => share(g.memory, t.memory) },
  { label: 'Mem req', value: (g) => g.reqMem, render: (g) => (g.reqMem ? fmtMem(g.reqMem) : <span className="faint">none</span>) },
  { label: 'Mem limit', value: (g) => g.limMem, render: (g) => (g.limMem ? fmtMem(g.limMem) : <span className="faint">none</span>) },
];

function share(v, total) {
  const pct = total ? (v / total) * 100 : 0;
  return <span className="num">{pct < 0.1 && v > 0 ? '<0.1' : pct.toFixed(1)}%</span>;
}

async function load(context) {
  const [pods, metrics, nodes] = await Promise.all([
    api('/resources/pods', { query: { context } }),
    api('/metrics', { query: { context } }),
    api('/resources/nodes', { query: { context } }).catch(() => null),
  ]);
  return { pods, metrics, nodes };
}

export default function ResourceUsage({ context, onNamespace, actions }) {
  const [groupBy, setGroupBy] = useState('namespace');
  const [sort, setSort] = useState({ col: 'CPU used', dir: -1 });
  const { data, error } = usePoll(() => load(context), [context], { interval: METRICS_POLL_MS });
  const nsHistory = usePoll(() => api('/metrics/history', { query: { context, prefix: 'namespace/' } }), [context], { interval: METRICS_POLL_MS });
  const cluster = useHistory(context, 'cluster');

  const groups = useMemo(() => (data ? aggregate(data.pods, data.metrics, GROUPINGS[groupBy].key) : []), [data, groupBy]);
  const total = useMemo(() => groups.reduce((t, g) => ({ cpu: t.cpu + g.cpu, memory: t.memory + g.memory, reqCpu: t.reqCpu + g.reqCpu, reqMem: t.reqMem + g.reqMem, limCpu: t.limCpu + g.limCpu, limMem: t.limMem + g.limMem }), { cpu: 0, memory: 0, reqCpu: 0, reqMem: 0, limCpu: 0, limMem: 0 }), [groups]);
  const nodeUsage = data?.metrics?.nodes && Object.values(data.metrics.nodes);
  const capacity = data?.nodes && {
    cpu: data.nodes.reduce((s, n) => s + parseCpu(n.status?.allocatable?.cpu), 0),
    memory: data.nodes.reduce((s, n) => s + parseMemory(n.status?.allocatable?.memory), 0),
  };
  const clusterUsed = nodeUsage?.length ? nodeUsage.reduce((s, u) => ({ cpu: s.cpu + u.cpu, memory: s.memory + u.memory }), { cpu: 0, memory: 0 }) : total;

  const col = COLS.find((c) => c.label === sort.col);
  const rows = [...groups].sort((a, b) => (col ? (col.value(a, total) - col.value(b, total)) * sort.dir : a.key.localeCompare(b.key) * sort.dir));
  const toggleSort = (label) => setSort((s) => ({ col: label, dir: s.col === label ? -s.dir : -1 }));

  const open = (g) => {
    if (groupBy === 'namespace') return onNamespace(g.key);
    const w = workloadOf(g.sample);
    const kindKey = KIND_BY_NAME[w.kind];
    return kindKey ? actions.select(kindKey, g.sample.metadata.namespace, w.name) : actions.select('pods', g.sample.metadata.namespace, g.sample.metadata.name);
  };

  return (
    <section className="page usage-page">
      <header className="page-header">
        <h1><Activity size={18} className="title-icon" /> Resource Usage</h1>
        <div className="segmented">
          {Object.entries(GROUPINGS).map(([key, g]) => (
            <button key={key} className={groupBy === key ? 'active' : ''} onClick={() => setGroupBy(key)}>By {g.label.toLowerCase()}</button>
          ))}
        </div>
      </header>
      <KubectlHint command={kubectl(context, 'top', 'pods', '-A', '--sort-by=cpu')} />
      <ErrorBox error={error} />
      {data && !data.metrics.available && <ErrorBox error={{ message: `Usage unavailable: ${data.metrics.error || 'no metrics yet'}` }} />}
      {data && (
        <div className="usage-summary">
          <UsageSummary label="Cluster CPU" used={clusterUsed.cpu} requested={total.reqCpu} limits={total.limCpu} capacity={capacity?.cpu} format={fmtCpu} points={historyPoints(cluster.data, 'cpu')} />
          <UsageSummary label="Cluster memory" used={clusterUsed.memory} requested={total.reqMem} limits={total.limMem} capacity={capacity?.memory} format={fmtMem} points={historyPoints(cluster.data, 'memory')} />
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th onClick={() => toggleSort('Name')} className={sort.col === 'Name' ? 'sorted' : ''}>{GROUPINGS[groupBy].label}{arrow(sort, 'Name')}</th>
              {groupBy === 'workload' && <th>Namespace</th>}
              {COLS.map((c) => (
                <th key={c.label} onClick={() => toggleSort(c.label)} className={sort.col === c.label ? 'sorted' : ''}>{c.label}{arrow(sort, c.label)}</th>
              ))}
              {groupBy === 'namespace' && <th>CPU trend</th>}
              {groupBy === 'namespace' && <th>Memory trend</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const [ns, kind, name] = groupBy === 'workload' ? g.key.split('/') : [g.key];
              const series = nsHistory.data?.series?.[g.key];
              return (
                <tr key={g.key} onClick={() => open(g)} title={groupBy === 'namespace' ? 'Show pods in this namespace' : 'Open details'}>
                  <td className="name">{groupBy === 'workload' ? <>{name} <span className="faint small">{kind}</span></> : g.key}</td>
                  {groupBy === 'workload' && <td>{ns}</td>}
                  {COLS.map((c) => <td key={c.label} className="num">{c.render ? c.render(g, total) : c.value(g, total)}</td>)}
                  {groupBy === 'namespace' && <td><Sparkline points={(series || []).map((p) => ({ t: p.t, value: p.cpu }))} format={fmtCpu} width={90} height={24} /></td>}
                  {groupBy === 'namespace' && <td><Sparkline points={(series || []).map((p) => ({ t: p.t, value: p.memory }))} format={fmtMem} width={90} height={24} /></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data && !error && <div className="muted pad">Loading usage…</div>}
      </div>
    </section>
  );
}

function arrow(sort, label) {
  if (sort.col !== label) return null;
  return <span className="sort-arrow">{sort.dir > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</span>;
}
