import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, resourcePath } from './api.js';
import { KINDS } from '../shared/kinds.js';
import { isProd, kubectl, shortContext, storage, store } from './util.js';
import { usePoll } from './hooks.js';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useTheme } from './theme.js';
import Rail from './components/Rail.jsx';
import Topbar from './components/Topbar.jsx';
import Overview from './components/Overview.jsx';
import Palette from './components/Palette.jsx';
import ResourceUsage from './components/ResourceUsage.jsx';
import { METRICS_POLL_MS, MetricsContext } from './usage.jsx';
import Sidebar from './components/Sidebar.jsx';
import Welcome from './components/Welcome.jsx';
import ResourceList from './components/ResourceList.jsx';
import Details from './components/Details.jsx';
import Dock from './components/Dock.jsx';
import PortForwards from './components/PortForwards.jsx';
import { ConfirmDialog, PromptDialog } from './components/Dialogs.jsx';

const TOAST_MS = 5000;
const NAMESPACE_POLL_MS = 30000;
const COUNTS_POLL_MS = 30000;

export default function App() {
  const [contexts, setContexts] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [contextName, setContextName] = useState(() => storage('context', null));
  const [kind, setKind] = useState(() => storage('kind', 'pods'));
  const [view, setView] = useState('overview');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const theme = useTheme();
  const [namespace, setNamespaceState] = useState('');
  const [selected, setSelected] = useState(null);
  const [dock, setDock] = useState({ tabs: [], active: null });
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const loadContexts = useCallback(async (reload = false) => {
    try {
      setContexts(await api(reload ? '/contexts/reload' : '/contexts', { method: reload ? 'POST' : 'GET' }));
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }, []);
  useEffect(() => {
    loadContexts();
  }, [loadContexts]);

  const ctx = useMemo(() => contexts?.find((c) => c.name === contextName) || null, [contexts, contextName]);
  const prod = isProd(ctx);

  useEffect(() => {
    if (ctx) setNamespaceState(storage(`ns.${ctx.name}`, ctx.namespace || ''));
    setSelected(null);
  }, [ctx]);

  const namespaces = usePoll(
    async () => (await api('/resources/namespaces', { query: { context: contextName } })).map((n) => n.metadata.name).sort(),
    [contextName],
    { enabled: !!ctx, interval: NAMESPACE_POLL_MS },
  );
  const metrics = usePoll(() => api('/metrics', { query: { context: contextName, namespace } }), [contextName, namespace], { enabled: !!ctx, interval: METRICS_POLL_MS });
  const counts = usePoll(() => api('/counts', { query: { context: contextName, namespace } }), [contextName, namespace], { enabled: !!ctx, interval: COUNTS_POLL_MS });

  const connect = (name) => {
    setContextName(name);
    store('context', name);
    setView('overview');
  };
  const chooseKind = (k) => {
    setKind(k);
    store('kind', k);
    setView('resources');
    setSelected(null);
  };
  const setNamespace = (ns) => {
    setNamespaceState(ns);
    store(`ns.${contextName}`, ns);
  };

  const toast = useCallback((text, type = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  const ask = (Component, props) =>
    new Promise((resolve) =>
      setDialog(
        <Component
          {...props}
          prod={prod}
          onResult={(v) => {
            setDialog(null);
            resolve(v);
          }}
        />,
      ),
    );

  const run = async (label, fn) => {
    try {
      await fn();
      toast(label);
      setRefreshSignal((n) => n + 1);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const ref = (k, obj) => ({ kindKey: k, ns: obj.metadata.namespace, name: obj.metadata.name, def: KINDS[k] });
  const target = (r) => `${r.def.kubectl}/${r.name}`;
  const nsArg = (r) => (r.ns ? `-n ${r.ns}` : '');

  const actions = {
    select: (k, ns, name) => setSelected({ kind: k, namespace: ns, name }),
    close: () => setSelected(null),

    async remove(k, obj) {
      const r = ref(k, obj);
      const ok = await ask(ConfirmDialog, {
        title: `Delete ${r.def.kind}`,
        message: `Delete ${r.def.kind} "${r.name}"${r.ns ? ` in namespace "${r.ns}"` : ''}?`,
        command: kubectl(contextName, 'delete', r.def.kubectl, r.name, nsArg(r)),
        confirmWord: r.name,
        actionLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      await run(`Deleted ${r.def.kind} ${r.name}`, () => api(resourcePath(k, r.ns, r.name), { method: 'DELETE', query: { context: contextName } }));
      setSelected((s) => (s?.name === r.name && s?.kind === k ? null : s));
    },

    async scale(k, obj) {
      const r = ref(k, obj);
      const value = await ask(PromptDialog, {
        title: `Scale ${r.def.kind} ${r.name}`,
        label: 'Replicas',
        type: 'number',
        initial: obj.spec.replicas ?? 0,
        actionLabel: 'Scale',
        commandFor: (v) => kubectl(contextName, 'scale', target(r), `--replicas=${v}`, nsArg(r)),
      });
      if (value === null) return;
      await run(`Scaled ${r.name} to ${value}`, () =>
        api(`${resourcePath(k, r.ns, r.name)}/scale`, { method: 'POST', body: { replicas: Number(value) }, query: { context: contextName } }));
    },

    async restart(k, obj) {
      const r = ref(k, obj);
      const ok = await ask(ConfirmDialog, {
        title: `Restart ${r.def.kind}`,
        message: `Rolling restart of "${r.name}". Pods are replaced one by one.`,
        command: kubectl(contextName, 'rollout', 'restart', target(r), nsArg(r)),
        actionLabel: 'Restart',
      });
      if (!ok) return;
      await run(`Restarted ${r.name}`, () => api(`${resourcePath(k, r.ns, r.name)}/restart`, { method: 'POST', query: { context: contextName } }));
    },

    openLogs(pod, container, previous = false) {
      addTab({ type: 'logs', pod: pod.metadata.name, namespace: pod.metadata.namespace, container, previous, containers: pod.spec.containers.map((c) => c.name) });
    },

    async openShell(pod, container) {
      if (prod) {
        const ok = await ask(ConfirmDialog, {
          title: 'Open shell on production',
          message: `Open an interactive shell in ${pod.metadata.name} / ${container}?`,
          command: kubectl(contextName, 'exec', '-it', pod.metadata.name, `-c ${container}`, `-n ${pod.metadata.namespace}`, '--', 'sh'),
          actionLabel: 'Open shell',
        });
        if (!ok) return;
      }
      addTab({ type: 'shell', pod: pod.metadata.name, namespace: pod.metadata.namespace, container });
    },

    async portForward(k, obj, port) {
      const r = ref(k, obj);
      const value = await ask(PromptDialog, {
        title: `Port forward ${r.def.kind} ${r.name}:${port}`,
        label: 'Local port (if busy, the next free one is used)',
        type: 'number',
        initial: port,
        actionLabel: 'Start',
        commandFor: (v) => kubectl(contextName, 'port-forward', target(r), `${v}:${port}`, nsArg(r)),
      });
      if (value === null) return;
      try {
        const fwd = await api('/portforwards', { method: 'POST', body: { context: contextName, namespace: r.ns, kind: k, name: r.name, port, localPort: Number(value) } });
        toast(`Forwarding localhost:${fwd.localPort} → ${r.name}:${port}`);
        window.open(`http://localhost:${fwd.localPort}`, '_blank', 'noopener');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  };

  const paletteCommands = {
    view: setView,
    kind: chooseKind,
    namespace: setNamespace,
    context: connect,
    select: actions.select,
    theme: theme.cycle,
    reload: () => loadContexts(true),
  };

  function addTab(tab) {
    const id = `${tab.type}-${Date.now()}`;
    setDock((d) => ({ tabs: [...d.tabs, { ...tab, id, context: contextName }], active: id }));
  }

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === 'Escape' && !dialog && !paletteOpen) setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, paletteOpen]);

  useEffect(() => {
    const onUnauthorized = () => setLoadError({ status: 401 });
    window.addEventListener('kubeglass:unauthorized', onUnauthorized);
    return () => window.removeEventListener('kubeglass:unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    document.title = ctx ? `${shortContext(ctx.name)} · kubeglass` : 'kubeglass';
  }, [ctx]);

  if (loadError?.status === 401) {
    return (
      <div className="fullscreen-message">
        <h2>kubeglass</h2>
        <p>This browser session is not logged in. Open the link printed in the terminal where kubeglass is running.</p>
      </div>
    );
  }

  return (
    <MetricsContext.Provider value={metrics.data}>
    <div className="app">
      <Rail contexts={contexts || []} active={ctx ? contextName : null} onSelect={connect} onHome={() => setContextName(null)} theme={theme} onPalette={() => setPaletteOpen(true)} />
      {ctx ? (
        <>
          <Sidebar ctx={ctx} prod={prod} kind={kind} view={view} counts={counts.data} onKind={chooseKind} onView={setView} />
          <main className="main">
            <Topbar ctx={ctx} view={view} kind={kind} namespace={namespace} namespaces={namespaces} onNamespace={setNamespace} onPalette={() => setPaletteOpen(true)} />
            <div className="content">
              {view === 'portforwards' && <PortForwards toast={toast} />}
              {view === 'usage' && <ResourceUsage context={contextName} onNamespace={(ns) => { setNamespace(ns); chooseKind('pods'); }} actions={actions} />}
              {view === 'overview' && <Overview context={contextName} namespace={namespace} actions={actions} onKind={chooseKind} />}
              {view === 'resources' && (
                <ResourceList
                  key={`${contextName}/${kind}`}
                  context={contextName}
                  kind={kind}
                  namespace={namespace}
                  selected={selected}
                  actions={actions}
                  refreshSignal={refreshSignal}
                />
              )}
              {selected && (
                <Details key={`${selected.kind}/${selected.namespace}/${selected.name}`} context={contextName} item={selected} actions={actions} refreshSignal={refreshSignal} />
              )}
            </div>
            <Dock dock={dock} setDock={setDock} />
          </main>
        </>
      ) : (
        <Welcome contexts={contexts} error={loadError} onConnect={connect} onReload={() => loadContexts(true)} />
      )}
      {dialog}
      {paletteOpen && (
        <Palette
          context={ctx ? contextName : null}
          contexts={contexts}
          namespace={namespace}
          namespaces={namespaces.data}
          onClose={() => setPaletteOpen(false)}
          commands={paletteCommands}
        />
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'error' ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
            {t.text}
          </div>
        ))}
      </div>
    </div>
    </MetricsContext.Provider>
  );
}
