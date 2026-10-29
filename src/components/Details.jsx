import { useEffect, useState } from 'react';
import { dump } from 'js-yaml';
import { ArrowRightLeft, Bell, Code, Copy, Eye, EyeOff, FileText, History, Info, RotateCw, Scale, SquareTerminal, Terminal, Trash2, TriangleAlert, X } from 'lucide-react';
import { KIND_ICONS } from '../icons.js';
import { api, resourcePath } from '../api.js';
import { KINDS, KIND_BY_NAME, RESTARTABLE, SCALABLE } from '../../shared/kinds.js';
import { COLUMNS, Status, eventTime } from '../columns.jsx';
import { usePoll } from '../hooks.js';
import { age, decodeBase64, kubectl, podStatus, selectorString } from '../util.js';
import KubectlHint from './KubectlHint.jsx';
import ErrorBox from './ErrorBox.jsx';
import UsageSummary from './UsageSummary.jsx';
import { Sparkline, UsageMeter, aggregate, containerResources, fmtCpu, fmtMem, historyPoints, podUsage, useHistory, useMetrics } from '../usage.jsx';
import { parseCpu, parseMemory } from '../../shared/quantity.js';

export default function Details({ context, item, actions, refreshSignal }) {
  const def = KINDS[item.kind];
  const [tab, setTab] = useState('overview');
  const { data: obj, error, refresh } = usePoll(() => api(resourcePath(item.kind, item.namespace, item.name), { query: { context } }), [context, item.kind, item.namespace, item.name]);
  useEffect(() => {
    if (refreshSignal) refresh();
  }, [refreshSignal, refresh]);

  const nsArg = item.namespace ? `-n ${item.namespace}` : '';
  const tabs = item.kind === 'events' ? ['overview', 'yaml'] : ['overview', 'yaml', 'events', 'kubectl'];
  const Icon = KIND_ICONS[item.kind];

  return (
    <aside className="drawer">
      <header className="drawer-header">
        <span className="kind-icon"><Icon size={17} /></span>
        <div className="drawer-title">
          <div className="kind">{def.kind}{item.namespace ? ` · ${item.namespace}` : ''}</div>
          <div className="name" title={item.name}>{item.name}</div>
        </div>
        <div className="drawer-actions">
          {obj && SCALABLE.has(item.kind) && <button className="btn" onClick={() => actions.scale(item.kind, obj)}><Scale size={14} /> Scale</button>}
          {obj && RESTARTABLE.has(item.kind) && <button className="btn" onClick={() => actions.restart(item.kind, obj)}><RotateCw size={14} /> Restart</button>}
          {obj && item.kind !== 'events' && <button className="btn btn-danger" onClick={() => actions.remove(item.kind, obj)}><Trash2 size={14} /> Delete</button>}
          <button className="btn-ghost" title="Close (Esc)" onClick={actions.close}><X size={16} /></button>
        </div>
      </header>
      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {TAB_META[t].icon}
            {TAB_META[t].label}
          </button>
        ))}
      </nav>
      <div className="drawer-body">
        <ErrorBox error={error} />
        {!obj && !error && <div className="muted pad">Loading…</div>}
        {obj && tab === 'overview' && <Overview context={context} kind={item.kind} obj={obj} actions={actions} />}
        {obj && tab === 'yaml' && (
          <>
            <KubectlHint command={kubectl(context, 'get', def.kubectl, item.name, nsArg, '-o yaml')} />
            <Yaml text={dump(obj, { lineWidth: -1, noRefs: true })} />
          </>
        )}
        {obj && tab === 'events' && <ObjectEvents context={context} obj={obj} />}
        {tab === 'kubectl' && <KubectlCheatsheet context={context} kind={item.kind} item={item} obj={obj} />}
      </div>
    </aside>
  );
}

const TAB_META = {
  overview: { label: 'Overview', icon: <Info size={14} /> },
  yaml: { label: 'YAML', icon: <Code size={14} /> },
  events: { label: 'Events', icon: <Bell size={14} /> },
  kubectl: { label: 'kubectl', icon: <Terminal size={14} /> },
};

// Colors YAML keys so large manifests are scannable.
function Yaml({ text }) {
  return (
    <pre className="yaml">
      {text.split('\n').map((line, i) => {
        const m = line.match(/^(\s*-?\s*)([^:\s][^:]*?):(\s|$)(.*)$/);
        return (
          <div key={i}>
            {m ? (
              <>
                {m[1]}<span className="k">{m[2]}</span>:{m[3]}{m[4]}
              </>
            ) : line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

function Overview({ context, kind, obj, actions }) {
  const m = obj.metadata;
  return (
    <div className="overview">
      <dl className="props">
        <Prop label="Created">{age(m.creationTimestamp)} ago <span className="muted small">({m.creationTimestamp})</span></Prop>
        {m.namespace && <Prop label="Namespace">{m.namespace}</Prop>}
        {m.ownerReferences?.length > 0 && (
          <Prop label="Controlled by">
            {m.ownerReferences.map((o) => {
              const ownerKind = KIND_BY_NAME[o.kind];
              return ownerKind ? (
                <a key={o.uid} onClick={() => actions.select(ownerKind, m.namespace, o.name)}>{o.kind}/{o.name}</a>
              ) : (
                <span key={o.uid}>{o.kind}/{o.name}</span>
              );
            })}
          </Prop>
        )}
        <Prop label="Labels"><Chips map={m.labels} /></Prop>
        <Prop label="Annotations"><Chips map={m.annotations} collapsible /></Prop>
      </dl>
      <KindSpecific context={context} kind={kind} obj={obj} actions={actions} />
    </div>
  );
}

function KindSpecific({ context, kind, obj, actions }) {
  const ns = obj.metadata.namespace;
  switch (kind) {
    case 'pods':
      return <PodOverview context={context} obj={obj} actions={actions} />;
    case 'deployments':
    case 'statefulsets':
    case 'daemonsets':
    case 'replicasets':
    case 'jobs':
      return (
        <>
          <dl className="props">
            {obj.spec.replicas !== undefined && <Prop label="Replicas">{obj.status?.readyReplicas || 0} ready / {obj.spec.replicas} desired</Prop>}
            {obj.spec.strategy?.type && <Prop label="Strategy">{obj.spec.strategy.type}</Prop>}
            <Prop label="Selector"><Chips map={obj.spec.selector?.matchLabels} /></Prop>
            <Prop label="Images">{obj.spec.template.spec.containers.map((c) => <div key={c.name} className="mono">{c.image}</div>)}</Prop>
          </dl>
          <RelatedPods context={context} namespace={ns} labelSelector={selectorString(obj.spec.selector?.matchLabels)} actions={actions} totals />
        </>
      );
    case 'cronjobs':
      return (
        <dl className="props">
          <Prop label="Schedule"><span className="mono">{obj.spec.schedule}</span></Prop>
          <Prop label="Suspended">{String(!!obj.spec.suspend)}</Prop>
          <Prop label="Last schedule">{age(obj.status?.lastScheduleTime) || 'never'}</Prop>
          <Prop label="Images">{obj.spec.jobTemplate.spec.template.spec.containers.map((c) => <div key={c.name} className="mono">{c.image}</div>)}</Prop>
        </dl>
      );
    case 'services':
      return (
        <>
          <dl className="props">
            <Prop label="Type">{obj.spec.type}</Prop>
            <Prop label="Cluster IP"><span className="mono">{obj.spec.clusterIP}</span></Prop>
            <Prop label="Selector"><Chips map={obj.spec.selector} /></Prop>
            <Prop label="Ports">
              {(obj.spec.ports || []).map((p) => (
                <div key={p.port} className="port-row">
                  <span className="mono">{p.name ? `${p.name}: ` : ''}{p.port} → {p.targetPort}/{p.protocol || 'TCP'}</span>
                  <button className="btn-ghost" onClick={() => actions.portForward('services', obj, p.port)}><ArrowRightLeft size={13} /> Forward</button>
                </div>
              ))}
            </Prop>
          </dl>
          {obj.spec.selector && <RelatedPods context={context} namespace={ns} labelSelector={selectorString(obj.spec.selector)} actions={actions} />}
        </>
      );
    case 'ingresses':
      return (
        <table className="table compact">
          <thead><tr><th>Host</th><th>Path</th><th>Backend</th></tr></thead>
          <tbody>
            {(obj.spec.rules || []).flatMap((r) =>
              (r.http?.paths || []).map((p) => (
                <tr key={`${r.host}${p.path}`}>
                  <td>{r.host || '*'}</td>
                  <td className="mono">{p.path || '/'}</td>
                  <td>
                    {p.backend.service ? (
                      <a onClick={() => actions.select('services', ns, p.backend.service.name)}>{p.backend.service.name}:{p.backend.service.port?.number || p.backend.service.port?.name}</a>
                    ) : '-'}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      );
    case 'configmaps':
      return <DataEntries data={obj.data} />;
    case 'secrets':
      return <DataEntries data={obj.data} secret />;
    case 'nodes':
      return <NodeOverview context={context} obj={obj} actions={actions} />;
    case 'events':
      return (
        <dl className="props">
          <Prop label="Type"><Status value={obj.type || 'Normal'} /></Prop>
          <Prop label="Reason">{obj.reason}</Prop>
          <Prop label="Object">
            {KIND_BY_NAME[obj.involvedObject.kind] ? (
              <a onClick={() => actions.select(KIND_BY_NAME[obj.involvedObject.kind], obj.involvedObject.namespace, obj.involvedObject.name)}>
                {obj.involvedObject.kind}/{obj.involvedObject.name}
              </a>
            ) : `${obj.involvedObject.kind}/${obj.involvedObject.name}`}
          </Prop>
          <Prop label="Message">{obj.message}</Prop>
          <Prop label="Count">{obj.count || 1}</Prop>
          <Prop label="Last seen">{age(eventTime(obj))} ago</Prop>
        </dl>
      );
    default:
      return null;
  }
}

function PodOverview({ context, obj, actions }) {
  const statuses = Object.fromEntries((obj.status?.containerStatuses || []).map((c) => [c.name, c]));
  const metrics = useMetrics();
  const usage = podUsage(metrics, obj);
  const history = useHistory(context, `pod/${obj.metadata.namespace}/${obj.metadata.name}`);
  return (
    <>
      <dl className="props">
        <Prop label="Status"><Status value={podStatus(obj)} /></Prop>
        <Prop label="Node">{obj.spec.nodeName ? <a onClick={() => actions.select('nodes', undefined, obj.spec.nodeName)}>{obj.spec.nodeName}</a> : '-'}</Prop>
        <Prop label="Pod IP"><span className="mono">{obj.status?.podIP || '-'}</span></Prop>
        <Prop label="QoS">{obj.status?.qosClass}</Prop>
        <Prop label="Service account">{obj.spec.serviceAccountName}</Prop>
        <Prop label="Conditions">
          {(obj.status?.conditions || []).map((c) => (
            <span key={c.type} className={`chip ${c.status === 'True' ? 'good' : 'critical'}`}>{c.type}</span>
          ))}
        </Prop>
      </dl>
      {metrics?.available && (
        <>
          <h4 className="section-title">Resource usage</h4>
          <div className="trend-row">
            <span className="trend"><span className="muted small">CPU</span><Sparkline points={historyPoints(history.data, 'cpu')} format={fmtCpu} /></span>
            <span className="trend"><span className="muted small">Memory</span><Sparkline points={historyPoints(history.data, 'memory')} format={fmtMem} /></span>
          </div>
          <KubectlHint command={kubectl(context, 'top', 'pod', obj.metadata.name, '--containers', `-n ${obj.metadata.namespace}`)} />
        </>
      )}
      <h4 className="section-title">Containers</h4>
      {obj.spec.containers.map((c) => {
        const st = statuses[c.name];
        const state = st?.state ? Object.keys(st.state)[0] : 'unknown';
        const reason = st?.state?.[state]?.reason;
        return (
          <div key={c.name} className="card container-card">
            <div className="container-head">
              <Status value={st?.ready ? 'Ready' : reason || state} />
              <b>{c.name}</b>
              <span className="muted small">{state} · {st?.restartCount || 0} restarts</span>
              <span className="spacer" />
              <button className="btn" onClick={() => actions.openLogs(obj, c.name)}><FileText size={14} /> Logs</button>
              {st?.restartCount > 0 && <button className="btn" onClick={() => actions.openLogs(obj, c.name, true)}><History size={14} /> Previous</button>}
              <button className="btn" onClick={() => actions.openShell(obj, c.name)}><SquareTerminal size={14} /> Shell</button>
            </div>
            <dl className="props">
              <Prop label="Image"><span className="mono">{c.image}</span></Prop>
              {metrics?.available && (() => {
                const r = containerResources(c);
                const u = usage?.containers?.[c.name];
                return (
                  <>
                    <Prop label="CPU"><UsageMeter used={u?.cpu} req={r.reqCpu} lim={r.limCpu} format={fmtCpu} /></Prop>
                    <Prop label="Memory"><UsageMeter used={u?.memory} req={r.reqMem} lim={r.limMem} format={fmtMem} /></Prop>
                  </>
                );
              })()}
              {c.ports?.length > 0 && (
                <Prop label="Ports">
                  {c.ports.map((p) => (
                    <div key={p.containerPort} className="port-row">
                      <span className="mono">{p.name ? `${p.name}: ` : ''}{p.containerPort}/{p.protocol || 'TCP'}</span>
                      <button className="btn-ghost" onClick={() => actions.portForward('pods', obj, p.containerPort)}><ArrowRightLeft size={13} /> Forward</button>
                    </div>
                  ))}
                </Prop>
              )}
              {c.resources && Object.keys(c.resources).length > 0 && (
                <Prop label="Resources">
                  <span className="mono small">
                    {['requests', 'limits'].map((k) => c.resources[k] && `${k}: ${Object.entries(c.resources[k]).map(([r, v]) => `${r}=${v}`).join(' ')}`).filter(Boolean).join('  |  ')}
                  </span>
                </Prop>
              )}
              {st?.lastState?.terminated && (
                <Prop label="Last terminated">{st.lastState.terminated.reason} (exit {st.lastState.terminated.exitCode}) {age(st.lastState.terminated.finishedAt)} ago</Prop>
              )}
            </dl>
          </div>
        );
      })}
    </>
  );
}

function NodeOverview({ context, obj, actions }) {
  const info = obj.status?.nodeInfo || {};
  return (
    <>
      <dl className="props">
        <Prop label="Addresses">{(obj.status?.addresses || []).map((a) => <div key={a.type + a.address} className="mono small">{a.type}: {a.address}</div>)}</Prop>
        <Prop label="OS">{info.osImage} ({info.architecture})</Prop>
        <Prop label="Kernel">{info.kernelVersion}</Prop>
        <Prop label="Runtime">{info.containerRuntimeVersion}</Prop>
        <Prop label="Kubelet">{info.kubeletVersion}</Prop>
        <Prop label="Capacity"><Chips map={obj.status?.capacity} /></Prop>
        <Prop label="Allocatable"><Chips map={obj.status?.allocatable} /></Prop>
        <Prop label="Taints">{(obj.spec.taints || []).map((t) => <span key={t.key + t.effect} className="chip">{t.key}{t.value ? `=${t.value}` : ''}:{t.effect}</span>)}</Prop>
        <Prop label="Conditions">
          {(obj.status?.conditions || []).map((c) => {
            const good = c.type === 'Ready' ? c.status === 'True' : c.status === 'False';
            return <span key={c.type} className={`chip ${good ? 'good' : 'critical'}`}>{c.type}</span>;
          })}
        </Prop>
      </dl>
      <RelatedPods
        context={context}
        fieldSelector={`spec.nodeName=${obj.metadata.name}`}
        actions={actions}
        totals
        node={obj.metadata.name}
        capacity={{ cpu: parseCpu(obj.status?.allocatable?.cpu), memory: parseMemory(obj.status?.allocatable?.memory) }}
      />
    </>
  );
}

// Pods of a workload or node. With `totals`, also sums their usage/requests/limits (against `capacity` for nodes).
function RelatedPods({ context, namespace, labelSelector, fieldSelector, actions, totals, node, capacity }) {
  const { data, error } = usePoll(
    () => api('/resources/pods', { query: { context, namespace, labelSelector, fieldSelector } }),
    [context, namespace, labelSelector, fieldSelector],
  );
  const metrics = useMetrics();
  const history = useHistory(context, node ? `node/${node}` : '');
  const ctx = { metrics };
  const cols = COLUMNS.pods.filter((c) => ['Name', 'Namespace', 'Ready', 'Restarts', 'Status', 'CPU', 'Memory', 'Age'].includes(c.label) && (c.label !== 'Namespace' || !namespace));
  const sum = data && totals && metrics?.available ? aggregate(data, metrics, () => 'all')[0] : null;
  // Node usage comes straight from node metrics (includes system daemons), like `kubectl top node`.
  const nodeUsed = node ? metrics?.nodes?.[node] : null;
  return (
    <>
      {sum && (
        <>
          <h4 className="section-title">{node ? 'Node usage' : 'Total usage of these pods'}</h4>
          <div className="usage-summary compact">
            <UsageSummary label="CPU" used={nodeUsed?.cpu ?? sum.cpu} requested={sum.reqCpu} limits={sum.limCpu} capacity={capacity?.cpu} format={fmtCpu} points={node ? historyPoints(history.data, 'cpu') : undefined} />
            <UsageSummary label="Memory" used={nodeUsed?.memory ?? sum.memory} requested={sum.reqMem} limits={sum.limMem} capacity={capacity?.memory} format={fmtMem} points={node ? historyPoints(history.data, 'memory') : undefined} />
          </div>
        </>
      )}
      <h4 className="section-title">Pods {data && <span className="count-pill">{data.length}</span>}</h4>
      <ErrorBox error={error} />
      {data && (
        <div className="table-scroll">
        <table className="table compact">
          <thead><tr>{cols.map((c) => <th key={c.label}>{c.label}</th>)}</tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.metadata.uid} onClick={() => actions.select('pods', p.metadata.namespace, p.metadata.name)}>
                {cols.map((c) => <td key={c.label}>{c.render ? c.render(p, ctx) : c.value(p, ctx)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}

function ObjectEvents({ context, obj }) {
  const m = obj.metadata;
  const fieldSelector = `involvedObject.name=${m.name}${m.uid ? `,involvedObject.uid=${m.uid}` : ''}`;
  const { data, error } = usePoll(() => api('/resources/events', { query: { context, namespace: m.namespace, fieldSelector } }), [context, m.namespace, fieldSelector]);
  const events = (data || []).sort((a, b) => new Date(eventTime(b)) - new Date(eventTime(a)));
  return (
    <>
      <KubectlHint command={kubectl(context, 'events', m.namespace ? `-n ${m.namespace}` : '', `--for ${obj.kind.toLowerCase()}/${m.name}`)} />
      <ErrorBox error={error} />
      {data && events.length === 0 && <div className="muted" style={{ padding: '4px 20px' }}>No events (Kubernetes keeps them for about an hour).</div>}
      {events.map((e) => (
        <div key={e.metadata.uid} className="event">
          {e.type === 'Warning' ? <TriangleAlert size={15} className="event-icon warning" /> : <Info size={15} className="event-icon normal" />}
          <div>
            <div className="event-head">
              {e.reason}
              <span className="muted small">{age(eventTime(e))} ago{e.count > 1 ? ` · ×${e.count}` : ''}</span>
            </div>
            <div className="event-msg">{e.message}</div>
          </div>
        </div>
      ))}
    </>
  );
}

function KubectlCheatsheet({ context, kind, item, obj }) {
  const def = KINDS[kind];
  const ns = item.namespace ? `-n ${item.namespace}` : '';
  const t = `${def.kubectl}/${item.name}`;
  const cmds = [
    ['Describe', kubectl(context, 'describe', def.kubectl, item.name, ns)],
    ['YAML', kubectl(context, 'get', def.kubectl, item.name, ns, '-o yaml')],
    ['Edit', kubectl(context, 'edit', t, ns)],
    ['Delete', kubectl(context, 'delete', t, ns)],
  ];
  if (kind === 'pods' && obj) {
    const c = obj.spec.containers[0]?.name;
    cmds.push(
      ['Logs (follow)', kubectl(context, 'logs', '-f', item.name, `-c ${c}`, ns)],
      ['Previous logs', kubectl(context, 'logs', '--previous', item.name, `-c ${c}`, ns)],
      ['Shell', kubectl(context, 'exec', '-it', item.name, `-c ${c}`, ns, '--', 'sh')],
    );
    const port = obj.spec.containers.flatMap((x) => x.ports || [])[0]?.containerPort;
    if (port) cmds.push(['Port forward', kubectl(context, 'port-forward', `pod/${item.name}`, `${port}:${port}`, ns)]);
  }
  if (SCALABLE.has(kind)) cmds.push(['Scale', kubectl(context, 'scale', t, '--replicas=2', ns)]);
  if (RESTARTABLE.has(kind)) {
    cmds.push(['Rollout restart', kubectl(context, 'rollout', 'restart', t, ns)], ['Rollout status', kubectl(context, 'rollout', 'status', t, ns)]);
  }
  if (kind === 'deployments' || kind === 'statefulsets' || kind === 'daemonsets') cmds.push(['Logs of all pods', kubectl(context, 'logs', '-f', t, '--all-containers', ns)]);
  if (kind === 'services' && obj?.spec.ports?.[0]) {
    const p = obj.spec.ports[0].port;
    cmds.push(['Port forward', kubectl(context, 'port-forward', t, `${p}:${p}`, ns)]);
  }
  if (kind === 'cronjobs') cmds.push(['Run now', kubectl(context, 'create', 'job', `--from=${t}`, `${item.name}-manual`, ns)]);
  if (kind === 'nodes') cmds.push(['Cordon', kubectl(context, 'cordon', item.name)], ['Drain', kubectl(context, 'drain', item.name, '--ignore-daemonsets', '--delete-emptydir-data')]);
  if (kind === 'secrets') cmds.push(['Decode a key', `${kubectl(context, 'get', 'secret', item.name, ns, "-o jsonpath='{.data.KEY}'")} | base64 -d`]);
  return (
    <div className="cheatsheet">
      <p className="muted small">Copy-paste equivalents. kubeglass only runs Delete, Scale and Restart itself; the rest are here for reference.</p>
      {cmds.map(([label, cmd]) => <KubectlHint key={label} label={label} command={cmd} />)}
    </div>
  );
}

function DataEntries({ data, secret }) {
  const entries = Object.entries(data || {});
  if (entries.length === 0) return <div className="muted">No data.</div>;
  return (
    <>
      <h4 className="section-title">Data <span className="count-pill">{entries.length}</span></h4>
      {entries.map(([k, v]) => <DataEntry key={k} name={k} value={v} secret={secret} />)}
    </>
  );
}

function DataEntry({ name, value, secret }) {
  const [shown, setShown] = useState(!secret);
  const text = secret ? decodeBase64(value) : value;
  return (
    <div className="data-entry">
      <div className="data-key">
        <b>{name}</b>
        {secret && <button className="btn-ghost" onClick={() => setShown((s) => !s)}>{shown ? <EyeOff size={14} /> : <Eye size={14} />}{shown ? 'Hide' : 'Reveal'}</button>}
        <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(text)}><Copy size={14} /> Copy</button>
      </div>
      <pre className="data-value">{shown ? text : '••••••••'}</pre>
    </div>
  );
}

function Prop({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Chips({ map, collapsible }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(map || {});
  if (entries.length === 0) return <span className="muted">-</span>;
  if (collapsible && !open) return <a onClick={() => setOpen(true)}>{entries.length} annotation{entries.length > 1 ? 's' : ''} (show)</a>;
  return entries.map(([k, v]) => <span key={k} className="chip" title={`${k}=${v}`}>{k}={v}</span>);
}
