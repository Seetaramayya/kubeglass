const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function age(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < MINUTE) return `${s}s`;
  if (s < HOUR) return `${Math.floor(s / MINUTE)}m`;
  if (s < DAY) return `${Math.floor(s / HOUR)}h`;
  return `${Math.floor(s / DAY)}d`;
}

export function compact(n) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function shortContext(name) {
  const arn = name.match(/^arn:aws:eks:[^:]+:\d+:cluster\/(.+)$/);
  return arn ? arn[1] : name;
}

export function initials(name) {
  const parts = shortContext(name).split(/[-_.\s/]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase();
}

export function isProd(ctx) {
  return /prod/i.test(ctx?.name || '') || /prod/i.test(ctx?.cluster || '');
}

const PALETTE = ['#3d90ce', '#7a5ac8', '#2fa37f', '#d0782a', '#c94f7c', '#4a9fa8', '#9a8a2b', '#5c6bc0'];
export function colorFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Builds a copy-pasteable kubectl command for the given context.
export function kubectl(context, ...args) {
  return ['kubectl', ...args.filter(Boolean), '--context', quote(context)].join(' ');
}

export function nsFlag(namespace) {
  return namespace ? `-n ${quote(namespace)}` : '-A';
}

function quote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function podStatus(pod) {
  if (pod.metadata.deletionTimestamp) return 'Terminating';
  const st = pod.status || {};
  let reason = st.reason || st.phase || 'Unknown';
  for (const cs of st.initContainerStatuses || []) {
    if (cs.state?.terminated?.exitCode === 0) continue;
    if (cs.state?.waiting?.reason && cs.state.waiting.reason !== 'PodInitializing') return `Init:${cs.state.waiting.reason}`;
    if (cs.state?.terminated) return `Init:${cs.state.terminated.reason || 'Error'}`;
    if (cs.state?.waiting || cs.state?.running) return 'Init';
  }
  for (const cs of st.containerStatuses || []) {
    if (cs.state?.waiting?.reason) reason = cs.state.waiting.reason;
    else if (cs.state?.terminated?.reason && reason !== 'Running') reason = cs.state.terminated.reason;
  }
  return reason;
}

// Maps a status string onto the four reserved status tones.
export function statusTone(status) {
  const s = String(status).toLowerCase();
  if (/^(running|ready|active|bound|available|complete|true|normal)$/.test(s)) return 'good';
  if (/^(completed|succeeded|terminating|released)$/.test(s)) return 'neutral';
  if (/(pending|init|containercreating|podinitializing|suspended|progressing|scheduling)/.test(s)) return 'warning';
  return 'critical';
}

export function decodeBase64(value) {
  try {
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}

export function storage(key, fallback) {
  try {
    const v = localStorage.getItem(`kubeglass.${key}`);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function store(key, value) {
  try {
    localStorage.setItem(`kubeglass.${key}`, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode); preferences just won't persist
  }
}

export function selectorString(matchLabels) {
  return Object.entries(matchLabels || {}).map(([k, v]) => `${k}=${v}`).join(',');
}
