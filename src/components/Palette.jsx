import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Folder, LayoutDashboard, Palette as PaletteIcon, RefreshCw, Search, Server, Waypoints } from 'lucide-react';
import { api } from '../api.js';
import { KINDS } from '../../shared/kinds.js';
import { KIND_ICONS } from '../icons.js';
import { shortContext } from '../util.js';

const MAX_RESULTS = 60;
const SEARCHABLE_KINDS = ['pods', 'deployments', 'statefulsets', 'daemonsets', 'services', 'ingresses', 'configmaps', 'secrets', 'cronjobs'];
// Result groups in display order: navigation first, then the most-used resource kinds.
const GROUP_RANK = ['Go to', ...SEARCHABLE_KINDS.map((k) => KINDS[k].label), 'Namespace', 'Switch cluster', 'Actions'];

// Scores a subsequence match; consecutive and word-start hits score higher. Returns null when there is no match.
function fuzzy(query, text) {
  if (!query) return { score: 0, hits: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return { score: 1000 - direct - t.length / 100, hits: Array.from({ length: q.length }, (_, i) => direct + i) };
  const hits = [];
  let score = 0;
  let ti = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    score += found === ti ? 5 : 1;
    if (found === 0 || /[-_./\s]/.test(t[found - 1])) score += 3;
    hits.push(found);
    ti = found + 1;
  }
  return { score, hits };
}

function Highlighted({ text, hits }) {
  if (!hits.length) return text;
  const set = new Set(hits);
  return [...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : ch));
}

export default function Palette({ context, contexts, namespace, namespaces, onClose, commands }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [resources, setResources] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!context) return undefined;
    let cancelled = false;
    Promise.allSettled(SEARCHABLE_KINDS.map((k) => api(`/resources/${k}`, { query: { context, namespace } }).then((items) => items.map((o) => ({ kind: k, o })))))
      .then((results) => {
        if (!cancelled) setResources(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])));
      });
    return () => {
      cancelled = true;
    };
  }, [context, namespace]);

  const items = useMemo(() => {
    const all = [];
    if (context) {
      all.push({ group: 'Go to', label: 'Overview', icon: LayoutDashboard, run: () => commands.view('overview') });
      all.push({ group: 'Go to', label: 'Resource Usage', hint: 'kubectl top', icon: Activity, run: () => commands.view('usage') });
      for (const [key, def] of Object.entries(KINDS)) all.push({ group: 'Go to', label: def.label, hint: def.group, icon: KIND_ICONS[key], run: () => commands.kind(key) });
      all.push({ group: 'Go to', label: 'Port Forwarding', icon: Waypoints, run: () => commands.view('portforwards') });
      all.push({ group: 'Namespace', label: 'All namespaces', icon: Folder, run: () => commands.namespace('') });
      for (const ns of namespaces || []) all.push({ group: 'Namespace', label: ns, hint: ns === namespace ? 'current' : '', icon: Folder, run: () => commands.namespace(ns) });
    }
    for (const c of contexts || []) {
      all.push({ group: 'Switch cluster', label: shortContext(c.name), hint: c.name === context ? 'current' : c.name !== shortContext(c.name) ? c.name : '', icon: Server, run: () => commands.context(c.name) });
    }
    all.push({ group: 'Actions', label: 'Toggle theme', icon: PaletteIcon, run: commands.theme });
    all.push({ group: 'Actions', label: 'Reload kubeconfig', icon: RefreshCw, run: commands.reload });
    for (const { kind, o } of resources || []) {
      all.push({
        group: KINDS[kind].label,
        label: o.metadata.name,
        hint: o.metadata.namespace,
        icon: KIND_ICONS[kind],
        resource: true,
        run: () => commands.select(kind, o.metadata.namespace, o.metadata.name),
      });
    }

    const q = query.trim();
    // Without a query, show navigation and clusters but not every resource.
    if (!q) return all.filter((i) => !i.resource).map((i) => ({ ...i, hits: [] }));
    const matched = all
      .map((i) => {
        const m = fuzzy(q, i.label);
        return m && { ...i, hits: m.hits, score: m.score + (i.resource ? 0 : 50) };
      })
      .filter(Boolean);
    return matched.sort((a, b) => GROUP_RANK.indexOf(a.group) - GROUP_RANK.indexOf(b.group) || b.score - a.score).slice(0, MAX_RESULTS);
  }, [context, contexts, namespace, namespaces, resources, query, commands]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (item) => {
    if (!item) return;
    onClose();
    item.run();
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      choose(items[active]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  let lastGroup = null;
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" onKeyDown={onKey}>
        <div className="palette-input">
          <Search size={17} />
          <input autoFocus placeholder="Jump to a resource, view, namespace or cluster…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="empty" style={{ padding: 28 }}>{resources === null && context ? 'Searching cluster…' : 'No matches'}</div>}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? <div className="palette-group">{item.group}</div> : null;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <div key={`${item.group}/${item.label}/${item.hint}/${i}`}>
                {header}
                <div className={`palette-item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => choose(item)}>
                  <Icon size={15} />
                  <span><Highlighted text={item.label} hits={item.hits} /></span>
                  {item.hint && <span className="hint">{item.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-footer">
          <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
