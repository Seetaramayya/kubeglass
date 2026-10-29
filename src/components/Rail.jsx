import { LayoutGrid, Monitor, Moon, Search, Sun } from 'lucide-react';
import { colorFor, initials, isProd } from '../util.js';

const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon };

// Lens-style hotbar: one tile per kubeconfig context.
export default function Rail({ contexts, active, onSelect, onHome, theme, onPalette }) {
  const ThemeIcon = THEME_ICONS[theme.mode];
  return (
    <nav className="rail">
      <button className={`rail-btn ${active ? '' : 'active'}`} title="All clusters" onClick={onHome}>
        <LayoutGrid size={18} />
      </button>
      <div className="rail-sep" />
      <div className="rail-list">
        {contexts.map((c) => (
          <div key={c.name} className={`rail-item ${c.name === active ? 'active' : ''}`}>
            <button className="avatar" style={{ background: colorFor(c.name) }} title={`${c.name}${isProd(c) ? ' (production)' : ''}`} onClick={() => onSelect(c.name)}>
              {initials(c.name)}
              {isProd(c) && <span className="prod-dot" />}
            </button>
          </div>
        ))}
      </div>
      <button className="rail-btn" title="Search (⌘K)" onClick={onPalette}>
        <Search size={17} />
      </button>
      <button className="rail-btn" title={`Theme: ${theme.mode} (click to change)`} onClick={theme.cycle}>
        <ThemeIcon size={17} />
      </button>
    </nav>
  );
}
