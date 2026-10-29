import { Sparkline, tone } from '../usage.jsx';

// Bullet-style card: used (fill) against capacity (track) with a marker at requested.
export default function UsageSummary({ label, used, requested, limits, capacity, format, points }) {
  const scale = capacity || Math.max(used || 0, requested || 0, limits || 0) || 1;
  const pct = (v) => Math.min(100, ((v || 0) / scale) * 100);
  const usedPct = capacity ? (used / capacity) * 100 : 0;
  return (
    <section className="card usage-card">
      <div className="usage-head">
        <div>
          <div className="tile-label">{label}</div>
          <div className="tile-value">
            {used === null ? '–' : format(used)}
            {capacity ? <span className="of"> / {format(capacity)}</span> : null}
          </div>
          <div className="tile-sub">{capacity ? `${Math.round(usedPct)}% of allocatable in use` : 'in use by these pods'}</div>
        </div>
        {points !== undefined && <Sparkline points={points} format={format} />}
      </div>
      <div className="bullet" title={`used ${format(used || 0)} · requested ${format(requested || 0)}${capacity ? ` · allocatable ${format(capacity)}` : ''}`}>
        <div className={`bullet-fill ${capacity ? tone(usedPct) : 'normal'}`} style={{ width: `${pct(used)}%` }} />
        {requested > 0 && <div className="bullet-marker" style={{ left: `${pct(requested)}%` }} />}
      </div>
      <div className="legend">
        <span className="legend-item"><i className="legend-swatch usage-used" />Used <b>{format(used || 0)}</b></span>
        <span className="legend-item"><i className="legend-swatch usage-req" />Requested <b>{format(requested || 0)}</b>{capacity ? ` (${Math.round(pct(requested))}%)` : ''}</span>
        <span className="legend-item">Limits <b>{limits ? format(limits) : 'none'}</b>{capacity && limits ? ` (${Math.round((limits / capacity) * 100)}%)` : ''}</span>
        {capacity ? <span className="legend-item">Allocatable <b>{format(capacity)}</b></span> : null}
      </div>
    </section>
  );
}
