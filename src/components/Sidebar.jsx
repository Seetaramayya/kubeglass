import { Activity, ChevronDown, LayoutDashboard, Waypoints } from 'lucide-react';
import { KINDS } from '../../shared/kinds.js';
import { GROUP_ICONS, KIND_ICONS } from '../icons.js';
import { compact, shortContext, storage, store } from '../util.js';
import { useState } from 'react';

const GROUPS = ['Cluster', 'Workloads', 'Config', 'Network', 'Storage'];
const ICON = 15;

export default function Sidebar({ ctx, prod, kind, view, counts, onKind, onView }) {
  const [collapsed, setCollapsed] = useState(() => storage('collapsedGroups', {}));
  const toggle = (group) => {
    const next = { ...collapsed, [group]: !collapsed[group] };
    setCollapsed(next);
    store('collapsedGroups', next);
  };
  let host = '';
  try {
    host = new URL(ctx.server).host;
  } catch {
    host = ctx.server || '';
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header" title={ctx.name}>
        <div className="sidebar-title">
          <span className="cluster-name">{shortContext(ctx.name)}</span>
          {prod && <span className="badge-prod">PROD</span>}
        </div>
        <div className="cluster-host">{host}</div>
      </div>
      <div className="sidebar-scroll">
        <button className={`nav-item ${view === 'overview' ? 'active' : ''}`} onClick={() => onView('overview')}>
          <LayoutDashboard size={ICON} /> Overview
        </button>
        <button className={`nav-item ${view === 'usage' ? 'active' : ''}`} onClick={() => onView('usage')}>
          <Activity size={ICON} /> Resource Usage
        </button>
        {GROUPS.map((group) => {
          const GroupIcon = GROUP_ICONS[group];
          return (
            <div key={group} className="nav-group">
              <button className={`nav-group-title ${collapsed[group] ? 'collapsed' : ''}`} onClick={() => toggle(group)}>
                <ChevronDown size={13} />
                {group}
                <span className="spacer" />
                <GroupIcon size={12} />
              </button>
              {!collapsed[group] && (
                <>
                  {Object.entries(KINDS)
                    .filter(([, d]) => d.group === group)
                    .map(([key, d]) => {
                      const Icon = KIND_ICONS[key];
                      const count = counts?.[key];
                      return (
                        <button key={key} className={`nav-item ${view === 'resources' && kind === key ? 'active' : ''}`} onClick={() => onKind(key)}>
                          <Icon size={ICON} />
                          {d.label}
                          {count !== undefined && count !== null && <span className="nav-count">{compact(count)}</span>}
                        </button>
                      );
                    })}
                  {group === 'Network' && (
                    <button className={`nav-item ${view === 'portforwards' ? 'active' : ''}`} onClick={() => onView('portforwards')}>
                      <Waypoints size={ICON} /> Port Forwarding
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
