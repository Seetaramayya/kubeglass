import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ChevronDown, ChevronUp, Download, FileText, Search, SquareTerminal, X } from 'lucide-react';
import { wsUrl } from '../api.js';
import { kubectl, storage, store } from '../util.js';
import KubectlHint from './KubectlHint.jsx';

const MAX_LINES = 20000;
const FLUSH_MS = 200;
const MIN_HEIGHT = 120;
const TAIL_OPTIONS = [100, 500, 1000, 5000, 20000];

// Lens-style bottom panel holding log and shell tabs.
export default function Dock({ dock, setDock }) {
  const [height, setHeight] = useState(() => storage('dockHeight', 320));
  const [minimized, setMinimized] = useState(false);
  if (dock.tabs.length === 0) return null;

  const close = (id) =>
    setDock((d) => {
      const tabs = d.tabs.filter((t) => t.id !== id);
      return { tabs, active: d.active === id ? tabs.at(-1)?.id ?? null : d.active };
    });

  const startResize = (e) => {
    const startY = e.clientY;
    const startH = height;
    const move = (ev) => setHeight(Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 150, startH + startY - ev.clientY)));
    const up = (ev) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      store('dockHeight', Math.max(MIN_HEIGHT, startH + startY - ev.clientY));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="dock" style={{ height: minimized ? undefined : height }}>
      {!minimized && <div className="dock-resizer" onMouseDown={startResize} />}
      <div className="dock-tabs">
        {dock.tabs.map((t) => (
          <div key={t.id} className={`dock-tab ${t.id === dock.active ? 'active' : ''}`} onClick={() => { setDock((d) => ({ ...d, active: t.id })); setMinimized(false); }}>
            {t.type === 'logs' ? <FileText size={14} /> : <SquareTerminal size={14} />}
            {t.pod}
            <button className="btn-ghost" title="Close" onClick={(e) => { e.stopPropagation(); close(t.id); }}><X size={13} /></button>
          </div>
        ))}
        <span className="spacer" />
        <button className="btn-ghost" title={minimized ? 'Expand' : 'Minimize'} onClick={() => setMinimized((m) => !m)}>{minimized ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
      </div>
      {!minimized &&
        dock.tabs.map((t) => (
          <div key={t.id} className="dock-body" style={{ display: t.id === dock.active ? 'flex' : 'none' }}>
            {t.type === 'logs' ? <LogsView tab={t} /> : <ShellView tab={t} visible={t.id === dock.active} />}
          </div>
        ))}
    </div>
  );
}

function LogsView({ tab }) {
  const [container, setContainer] = useState(tab.container);
  const [previous, setPrevious] = useState(!!tab.previous);
  const [timestamps, setTimestamps] = useState(false);
  const [tail, setTail] = useState(500);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState('connecting');
  const scrollRef = useRef(null);

  useEffect(() => {
    const buffer = { lines: [], partial: '' };
    const decoder = new TextDecoder();
    let dirty = false;
    setLines([]);
    setStatus('connecting');
    const ws = new WebSocket(wsUrl('/ws/logs', { context: tab.context, namespace: tab.namespace, pod: tab.pod, container, previous, timestamps, tailLines: tail }));
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => setStatus('streaming');
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data);
        setStatus(msg.type === 'error' ? `error: ${msg.message}` : 'ended');
        return;
      }
      const parts = (buffer.partial + decoder.decode(e.data, { stream: true })).split('\n');
      buffer.partial = parts.pop();
      buffer.lines.push(...parts);
      if (buffer.lines.length > MAX_LINES) buffer.lines.splice(0, buffer.lines.length - MAX_LINES);
      dirty = true;
    };
    ws.onclose = () => setStatus((s) => (s === 'streaming' || s === 'connecting' ? 'disconnected' : s));
    const timer = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      setLines([...buffer.lines]);
    }, FLUSH_MS);
    return () => {
      clearInterval(timer);
      ws.close();
    };
  }, [tab.context, tab.namespace, tab.pod, container, previous, timestamps, tail]);

  useEffect(() => {
    if (follow && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, follow, filter]);

  const onScroll = () => {
    const el = scrollRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const term = filter.toLowerCase();
  const shown = term ? lines.filter((l) => l.toLowerCase().includes(term)) : lines;

  const download = () => {
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${tab.pod}-${container}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="logs">
      <div className="logs-toolbar">
        {tab.containers.length > 1 && (
          <select value={container} onChange={(e) => setContainer(e.target.value)}>
            {tab.containers.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
        <select value={tail} onChange={(e) => setTail(Number(e.target.value))} title="Lines to load">
          {TAIL_OPTIONS.map((n) => <option key={n} value={n}>last {n}</option>)}
        </select>
        <label><input type="checkbox" checked={previous} onChange={(e) => setPrevious(e.target.checked)} /> previous</label>
        <label><input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} /> timestamps</label>
        <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow</label>
        <div className="filter">
          <Search size={14} />
          <input placeholder="Filter lines…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button className="btn-ghost" onClick={download}><Download size={14} /> Download</button>
        <span className={`muted small ${status.startsWith('error') ? 'bad-text' : ''}`}>{term ? `${shown.length}/${lines.length} lines · ` : `${lines.length} lines · `}{status}</span>
      </div>
      <KubectlHint command={kubectl(tab.context, 'logs', previous ? '--previous' : '-f', tab.pod, `-c ${container}`, `-n ${tab.namespace}`, `--tail=${tail}`, timestamps ? '--timestamps' : '')} />
      <div className="logs-body" ref={scrollRef} onScroll={onScroll}>
        {shown.map((l, i) => (
          <div key={i} className="log-line">{term ? <Highlight text={l} term={term} /> : l}</div>
        ))}
      </div>
    </div>
  );
}

function Highlight({ text, term }) {
  const lower = text.toLowerCase();
  const out = [];
  let from = 0;
  for (let i = lower.indexOf(term); i >= 0; i = lower.indexOf(term, from)) {
    out.push(text.slice(from, i), <mark key={i}>{text.slice(i, i + term.length)}</mark>);
    from = i + term.length;
  }
  out.push(text.slice(from));
  return out;
}

function ShellView({ tab, visible }) {
  const ref = useRef(null);
  const fitRef = useRef(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    const term = new Terminal({ fontSize: 13, fontFamily: '"Geist Mono Variable", Menlo, monospace', cursorBlink: true, theme: { background: '#0b0b0d', cursor: '#22b8d6', selectionBackground: '#22b8d655' } });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(ref.current);
    fit.fit();
    const ws = new WebSocket(wsUrl('/ws/exec', { context: tab.context, namespace: tab.namespace, pod: tab.pod, container: tab.container, cols: term.cols, rows: term.rows }));
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      setStatus('connected');
      term.focus();
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data);
        if (msg.type === 'error') term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        if (msg.type === 'exit') term.write(`\r\n\x1b[90m[session ended${msg.status === 'Failure' ? `: ${msg.message}` : ''}]\x1b[0m\r\n`);
        return;
      }
      term.write(new Uint8Array(e.data));
    };
    ws.onclose = () => setStatus('closed');
    const send = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
    term.onData((data) => send({ type: 'stdin', data }));
    term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
    const observer = new ResizeObserver(() => {
      if (ref.current?.offsetParent) fit.fit();
    });
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      ws.close();
      term.dispose();
    };
  }, [tab.context, tab.namespace, tab.pod, tab.container]);

  useEffect(() => {
    if (visible) requestAnimationFrame(() => fitRef.current?.fit());
  }, [visible]);

  return (
    <div className="shell">
      <KubectlHint label={status} command={kubectl(tab.context, 'exec', '-it', tab.pod, `-c ${tab.container}`, `-n ${tab.namespace}`, '--', 'sh')} />
      <div className="terminal" ref={ref} />
    </div>
  );
}
