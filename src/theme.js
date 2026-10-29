import { useEffect, useState } from 'react';
import { storage, store } from './util.js';

const MODES = ['system', 'light', 'dark'];
const media = window.matchMedia('(prefers-color-scheme: dark)');

const resolve = (mode) => (mode === 'system' ? (media.matches ? 'dark' : 'light') : mode);

// Theme preference ('system' | 'light' | 'dark'), applied as <html data-theme="light|dark">.
export function useTheme() {
  const [mode, setMode] = useState(() => storage('theme', 'system'));
  const [resolved, setResolved] = useState(() => resolve(mode));

  useEffect(() => {
    const apply = () => {
      const r = resolve(mode);
      document.documentElement.dataset.theme = r;
      setResolved(r);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode]);

  const cycle = () => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    setMode(next);
    store('theme', next);
  };
  return { mode, resolved, cycle };
}
