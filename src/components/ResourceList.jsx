import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FileText, Inbox, RotateCw, Scale, Search, SquareTerminal, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { KINDS, RESTARTABLE, SCALABLE } from '../../shared/kinds.js';
import { COLUMNS, DEFAULT_SORT } from '../columns.jsx';
import { KIND_ICONS } from '../icons.js';
import { usePoll } from '../hooks.js';
import { kubectl, nsFlag } from '../util.js';
import { aggregate, useMetrics, workloadOf } from '../usage.jsx';
import KubectlHint from './KubectlHint.jsx';
import ErrorBox from './ErrorBox.jsx';

const SKELETON_ROWS = 8;
const WORKLOAD_KINDS = new Set(['deployments', 'statefulsets', 'daemonsets']);

export default function ResourceList({ context, kind, namespace, selected, actions, refreshSignal }) {
  const def = KINDS[kind];
  const Icon = KIND_ICONS[kind];
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(DEFAULT_SORT[kind] || { col: 'Name', dir: 1 });
  const searchRef = useRef(null);
  const ns = def.namespaced ? namespace : '';

  const { data, error, loading, refresh } = usePoll(() => api(`/resources/${kind}`, { query: { context, namespace: ns } }), [context, kind, ns]);
  useEffect(() => {
    if (refreshSignal) refresh();
  }, [refreshSignal, refresh]);

  // Workload tables sum the usage of their pods, so they need the pod list too.
  const metrics = useMetrics();
  const isWorkload = WORKLOAD_KINDS.has(kind);
  const pods = usePoll(() => api('/resources/pods', { query: { context, namespace: ns } }), [context, ns], { enabled: isWorkload });
  const ctx = useMemo(() => {
    if (!isWorkload || !pods.data) return { metrics };
    const groups = aggregate(pods.data, metrics, (p) => {
      const w = workloadOf(p);
      return `${w.kind}/${p.metadata.namespace}/${w.name}`;
    });
    return { metrics, workloads: new Map(groups.map((g) => [g.key, g])) };
  }, [metrics, isWorkload, pods.data]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !e.target.closest?.('.xterm')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const columns = useMemo(() => COLUMNS[kind].filter((c) => c.label !== 'Namespace' || (def.namespaced && !ns)), [kind, def, ns]);
  const rows = useMemo(() => {
    if (!data) return [];
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = terms.length
      ? data.filter((o) => {
          const text = columns.filter((c) => !c.usage).map((c) => String(c.value(o, ctx))).join(' ').toLowerCase();
          return terms.every((t) => text.includes(t));
        })
      : data;
    const col = columns.find((c) => c.label === sort.col) || columns[0];
    return [...filtered].sort((a, b) => compare(col.value(a, ctx), col.value(b, ctx)) * sort.dir);
  }, [data, search, sort, columns, ctx]);

  const toggleSort = (label) => setSort((s) => ({ col: label, dir: s.col === label ? -s.dir : 1 }));
  const hasActions = kind === 'pods' || SCALABLE.has(kind) || RESTARTABLE.has(kind);
  const colCount = columns.length + (hasActions ? 1 : 0);

  return (
    <section className="page">
      <header className="page-header">
        <h1>
          <Icon size={18} className="title-icon" />
          {def.label}
          {data && <span className="count-pill">{rows.length}</span>}
        </h1>
        <div className="filter">
          <Search size={14} />
          <input ref={searchRef} placeholder={`Filter ${def.label.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setSearch('')} />
          {!search && <kbd>/</kbd>}
        </div>
      </header>
      <KubectlHint command={kubectl(context, 'get', kind, def.namespaced ? nsFlag(ns) : '', kind === 'pods' ? '-o wide' : '')} />
      {(kind === 'pods' || kind === 'nodes') && <KubectlHint command={kubectl(context, 'top', kind === 'pods' ? 'pods' : 'nodes', kind === 'pods' ? nsFlag(ns) : '', '--sort-by=cpu')} />}
      {metrics && !metrics.available && metrics.error && (kind === 'pods' || kind === 'nodes' || isWorkload) && <ErrorBox error={{ message: `Usage unavailable: ${metrics.error}` }} />}
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.label} onClick={() => toggleSort(c.label)} className={sort.col === c.label ? 'sorted' : ''}>
                  {c.label}
                  {sort.col === c.label && <span className="sort-arrow">{sort.dir > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</span>}
                </th>
              ))}
              {hasActions && <th className="actions-col" />}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <tr key={i} className="skeleton-row">
                  {Array.from({ length: colCount }, (_, j) => <td key={j} />)}
                </tr>
              ))}
            {rows.map((o) => {
              const isSel = selected?.kind === kind && selected?.name === o.metadata.name && selected?.namespace === o.metadata.namespace;
              return (
                <tr key={o.metadata.uid || `${o.metadata.namespace}/${o.metadata.name}`} className={isSel ? 'selected' : ''} onClick={() => actions.select(kind, o.metadata.namespace, o.metadata.name)}>
                  {columns.map((c) => (
                    <td key={c.label} className={c.mono ? 'mono' : c.num ? 'num' : ''}>{c.render ? c.render(o, ctx) : c.value(o, ctx)}</td>
                  ))}
                  {hasActions && (
                    <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                      <RowActions kind={kind} obj={o} actions={actions} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && data && rows.length === 0 && (
          <div className="empty">
            <Inbox size={28} />
            {search ? `No ${def.label.toLowerCase()} match "${search}"` : `No ${def.label.toLowerCase()}${ns ? ` in ${ns}` : ''}`}
          </div>
        )}
      </div>
    </section>
  );
}

function RowActions({ kind, obj, actions }) {
  if (kind === 'pods') {
    const container = obj.spec.containers[0]?.name;
    return (
      <span className="row-actions">
        <button className="btn-ghost" title="Logs" onClick={() => actions.openLogs(obj, container)}><FileText size={15} /></button>
        <button className="btn-ghost" title="Shell" onClick={() => actions.openShell(obj, container)}><SquareTerminal size={15} /></button>
        <button className="btn-ghost danger" title="Delete" onClick={() => actions.remove(kind, obj)}><Trash2 size={15} /></button>
      </span>
    );
  }
  return (
    <span className="row-actions">
      {SCALABLE.has(kind) && <button className="btn-ghost" title="Scale" onClick={() => actions.scale(kind, obj)}><Scale size={15} /></button>}
      {RESTARTABLE.has(kind) && <button className="btn-ghost" title="Rollout restart" onClick={() => actions.restart(kind, obj)}><RotateCw size={15} /></button>}
    </span>
  );
}

function compare(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}
