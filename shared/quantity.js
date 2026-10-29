// Kubernetes resource.Quantity parsing. CPU is returned in millicores, memory in bytes.
const BINARY = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60 };
const DECIMAL = { n: 1e-9, u: 1e-6, m: 1e-3, '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };

export function parseQuantity(q) {
  if (q === undefined || q === null || q === '') return 0;
  if (typeof q === 'number') return q;
  const m = String(q).trim().match(/^([+-]?[\d.]+(?:[eE][+-]?\d+)?)([a-zA-Z]*)$/);
  if (!m) return 0;
  const [, num, suffix] = m;
  const factor = BINARY[suffix] ?? DECIMAL[suffix];
  return factor === undefined ? 0 : Number(num) * factor;
}

export const parseCpu = (q) => parseQuantity(q) * 1000;
export const parseMemory = (q) => parseQuantity(q);
