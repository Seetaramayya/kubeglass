import { ChevronDown, ChevronRight, Folder, Search } from 'lucide-react';
import { KINDS } from '../../shared/kinds.js';
import { shortContext } from '../util.js';

const VIEW_TITLES = { overview: 'Overview', usage: 'Resource Usage', portforwards: 'Port Forwarding' };

export default function Topbar({ ctx, view, kind, namespace, namespaces, onNamespace, onPalette }) {
  const def = KINDS[kind];
  const crumbs = view === 'resources' ? [def.group, def.label] : [VIEW_TITLES[view]];
  const showNs = view === 'overview' || (view === 'resources' && def.namespaced);
  return (
    <header className="topbar">
      <nav className="crumbs">
        <span>{shortContext(ctx.name)}</span>
        {crumbs.map((c, i) => (
          <span key={c} className="crumbs" style={{ gap: 6 }}>
            <ChevronRight size={14} />
            <span className={i === crumbs.length - 1 ? 'current' : ''}>{c}</span>
          </span>
        ))}
      </nav>
      <span className="spacer" />
      {showNs && <NamespacePicker value={namespace} namespaces={namespaces} onChange={onNamespace} />}
      <button className="palette-trigger" onClick={onPalette}>
        <Search size={14} /> Search or jump to…
        <kbd>⌘K</kbd>
      </button>
    </header>
  );
}

function NamespacePicker({ value, namespaces, onChange }) {
  // Without permission to list namespaces, fall back to typing one.
  if (namespaces.error && !namespaces.data) {
    return (
      <div className="ns-picker">
        <Folder size={14} />
        <input placeholder="namespace (empty = all)" defaultValue={value} onKeyDown={(e) => e.key === 'Enter' && onChange(e.target.value.trim())} />
      </div>
    );
  }
  const list = namespaces.data || [];
  return (
    <div className="ns-picker" title="Namespace">
      <Folder size={14} />
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All namespaces</option>
        {value && !list.includes(value) && <option value={value}>{value}</option>}
        {list.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <ChevronDown size={14} className="chev" />
    </div>
  );
}
