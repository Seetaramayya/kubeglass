export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, query = {} } = {}) {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const qs = params.toString();
  const res = await fetch(`/api${path}${qs ? `?${qs}` : ''}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) window.dispatchEvent(new Event('kubeglass:unauthorized'));
  if (!res.ok) throw new ApiError(res.status, data.message || res.statusText);
  return data;
}

export function resourcePath(kind, namespace, name) {
  return `/resources/${kind}/${encodeURIComponent(namespace || '_')}/${encodeURIComponent(name)}`;
}

export function wsUrl(path, params) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}?${new URLSearchParams(params)}`;
}
