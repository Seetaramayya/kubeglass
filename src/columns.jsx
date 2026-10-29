import { age, podStatus, statusTone } from './util.js';
import { Meter, UsageMeter, fmtCpu, fmtMem, podResources, podUsage } from './usage.jsx';
import { parseCpu, parseMemory } from '../shared/quantity.js';

// Each column: label, value(obj, ctx) used for sorting and search, optional render(obj, ctx).
// ctx carries live metrics: { metrics, workloads } (see ResourceList).
const name = { label: 'Name', value: (o) => o.metadata.name, render: (o) => <span className="name">{o.metadata.name}</span> };
const namespace = { label: 'Namespace', value: (o) => o.metadata.namespace || '' };
const created = { label: 'Age', value: (o) => -new Date(o.metadata.creationTimestamp).getTime(), render: (o) => age(o.metadata.creationTimestamp), num: true };

const status = (fn) => ({ label: 'Status', value: fn, render: (o) => <Status value={fn(o)} /> });

export function Status({ value, tone }) {
  return (
    <span className={`status ${tone || statusTone(value)}`}>
      <i className="status-dot" />
      {value}
    </span>
  );
}

const sum = (list, fn) => (list || []).reduce((acc, x) => acc + fn(x), 0);

const podReady = (p) => `${sum(p.status?.containerStatuses, (c) => (c.ready ? 1 : 0))}/${p.spec.containers.length}`;
const restarts = (p) => sum(p.status?.containerStatuses, (c) => c.restartCount || 0);

function jobStatus(j) {
  const cond = (j.status?.conditions || []).find((c) => c.status === 'True' && (c.type === 'Complete' || c.type === 'Failed'));
  if (cond) return cond.type;
  if (j.spec?.suspend) return 'Suspended';
  return j.status?.active ? 'Running' : 'Pending';
}

function nodeStatus(n) {
  const ready = (n.status?.conditions || []).find((c) => c.type === 'Ready');
  const base = ready?.status === 'True' ? 'Ready' : 'NotReady';
  return n.spec?.unschedulable ? `${base},SchedulingDisabled` : base;
}

export const nodeRoles = (n) =>
  Object.keys(n.metadata.labels || {})
    .filter((l) => l.startsWith('node-role.kubernetes.io/'))
    .map((l) => l.split('/')[1])
    .join(',') || '<none>';

const svcPorts = (s) => (s.spec.ports || []).map((p) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ''}/${p.protocol || 'TCP'}`).join(', ');
const lbAddress = (o) => (o.status?.loadBalancer?.ingress || []).map((i) => i.hostname || i.ip).join(', ');

export { podReady, restarts, jobStatus, nodeStatus };

// CPU/memory usage columns (kubectl top). Sorting uses raw usage; missing metrics sort last.
const podUsageCol = (label, key, format) => ({
  label,
  usage: true,
  value: (o, ctx) => podUsage(ctx?.metrics, o)?.[key] ?? -1,
  render: (o, ctx) => {
    const r = podResources(o);
    const [req, lim] = key === 'cpu' ? [r.reqCpu, r.limCpu] : [r.reqMem, r.limMem];
    return <UsageMeter used={podUsage(ctx?.metrics, o)?.[key]} req={req} lim={lim} format={format} />;
  },
});

const nodeUsageCol = (label, key, format, parse) => ({
  label,
  usage: true,
  value: (o, ctx) => ctx?.metrics?.nodes?.[o.metadata.name]?.[key] ?? -1,
  render: (o, ctx) => {
    const alloc = parse(o.status?.allocatable?.[key]);
    return <Meter value={ctx?.metrics?.nodes?.[o.metadata.name]?.[key]} max={alloc} format={format} title={`of ${format(alloc)} allocatable`} />;
  },
});

const workloadUsageCol = (label, key, format) => ({
  label,
  usage: true,
  value: (o, ctx) => ctx?.workloads?.get(`${o.kind}/${o.metadata.namespace}/${o.metadata.name}`)?.[key] ?? -1,
  render: (o, ctx) => {
    const g = ctx?.workloads?.get(`${o.kind}/${o.metadata.namespace}/${o.metadata.name}`);
    if (!g || !ctx?.metrics?.available) return <span className="faint">–</span>;
    const [req, lim] = key === 'cpu' ? [g.reqCpu, g.limCpu] : [g.reqMem, g.limMem];
    return <UsageMeter used={g[key]} req={req} lim={lim} format={format} />;
  },
});

const CPU_POD = podUsageCol('CPU', 'cpu', fmtCpu);
const MEM_POD = podUsageCol('Memory', 'memory', fmtMem);
const CPU_NODE = nodeUsageCol('CPU used', 'cpu', fmtCpu, parseCpu);
const MEM_NODE = nodeUsageCol('Memory used', 'memory', fmtMem, parseMemory);
const CPU_WL = workloadUsageCol('CPU', 'cpu', fmtCpu);
const MEM_WL = workloadUsageCol('Memory', 'memory', fmtMem);

export const eventTime = (e) => e.lastTimestamp || e.eventTime || e.metadata.creationTimestamp;

export const COLUMNS = {
  pods: [
    name, namespace,
    { label: 'Ready', value: podReady, num: true },
    { label: 'Restarts', value: restarts, num: true, render: (o) => <span className={restarts(o) > 0 ? 'warn-text' : ''}>{restarts(o)}</span> },
    status(podStatus),
    CPU_POD,
    MEM_POD,
    { label: 'Node', value: (o) => o.spec.nodeName || '' },
    { label: 'IP', value: (o) => o.status?.podIP || '', mono: true },
    created,
  ],
  deployments: [
    name, namespace,
    { label: 'Ready', value: (o) => `${o.status?.readyReplicas || 0}/${o.spec.replicas ?? 0}` },
    { label: 'Up-to-date', value: (o) => o.status?.updatedReplicas || 0 },
    { label: 'Available', value: (o) => o.status?.availableReplicas || 0 },
    CPU_WL,
    MEM_WL,
    created,
  ],
  statefulsets: [
    name, namespace,
    { label: 'Ready', value: (o) => `${o.status?.readyReplicas || 0}/${o.spec.replicas ?? 0}` },
    CPU_WL,
    MEM_WL,
    created,
  ],
  daemonsets: [
    name, namespace,
    { label: 'Desired', value: (o) => o.status?.desiredNumberScheduled || 0 },
    { label: 'Current', value: (o) => o.status?.currentNumberScheduled || 0 },
    { label: 'Ready', value: (o) => o.status?.numberReady || 0 },
    { label: 'Available', value: (o) => o.status?.numberAvailable || 0 },
    CPU_WL,
    MEM_WL,
    created,
  ],
  replicasets: [
    name, namespace,
    { label: 'Desired', value: (o) => o.spec.replicas ?? 0 },
    { label: 'Current', value: (o) => o.status?.replicas || 0 },
    { label: 'Ready', value: (o) => o.status?.readyReplicas || 0 },
    created,
  ],
  jobs: [
    name, namespace,
    { label: 'Completions', value: (o) => `${o.status?.succeeded || 0}/${o.spec.completions ?? 1}` },
    status(jobStatus),
    created,
  ],
  cronjobs: [
    name, namespace,
    { label: 'Schedule', value: (o) => o.spec.schedule, mono: true },
    { label: 'Suspend', value: (o) => String(!!o.spec.suspend) },
    { label: 'Active', value: (o) => (o.status?.active || []).length },
    { label: 'Last schedule', value: (o) => o.status?.lastScheduleTime || '', render: (o) => age(o.status?.lastScheduleTime) },
    created,
  ],
  configmaps: [
    name, namespace,
    { label: 'Keys', value: (o) => Object.keys({ ...o.data, ...o.binaryData }).length },
    created,
  ],
  secrets: [
    name, namespace,
    { label: 'Type', value: (o) => o.type },
    { label: 'Keys', value: (o) => Object.keys(o.data || {}).length },
    created,
  ],
  hpas: [
    name, namespace,
    { label: 'Target', value: (o) => `${o.spec.scaleTargetRef.kind}/${o.spec.scaleTargetRef.name}` },
    { label: 'Min', value: (o) => o.spec.minReplicas ?? 1 },
    { label: 'Max', value: (o) => o.spec.maxReplicas },
    { label: 'Replicas', value: (o) => o.status?.currentReplicas ?? 0 },
    created,
  ],
  services: [
    name, namespace,
    { label: 'Type', value: (o) => o.spec.type },
    { label: 'Cluster IP', value: (o) => o.spec.clusterIP || '', mono: true },
    { label: 'Ports', value: svcPorts, mono: true },
    { label: 'External', value: lbAddress },
    created,
  ],
  ingresses: [
    name, namespace,
    { label: 'Class', value: (o) => o.spec.ingressClassName || '' },
    { label: 'Hosts', value: (o) => (o.spec.rules || []).map((r) => r.host || '*').join(', ') },
    { label: 'Address', value: lbAddress },
    created,
  ],
  pvcs: [
    name, namespace,
    status((o) => o.status?.phase || ''),
    { label: 'Capacity', value: (o) => o.status?.capacity?.storage || o.spec.resources?.requests?.storage || '' },
    { label: 'Storage class', value: (o) => o.spec.storageClassName || '' },
    { label: 'Volume', value: (o) => o.spec.volumeName || '' },
    created,
  ],
  pvs: [
    name,
    { label: 'Capacity', value: (o) => o.spec.capacity?.storage || '' },
    status((o) => o.status?.phase || ''),
    { label: 'Claim', value: (o) => (o.spec.claimRef ? `${o.spec.claimRef.namespace}/${o.spec.claimRef.name}` : '') },
    { label: 'Storage class', value: (o) => o.spec.storageClassName || '' },
    { label: 'Reclaim', value: (o) => o.spec.persistentVolumeReclaimPolicy || '' },
    created,
  ],
  storageclasses: [
    name,
    { label: 'Provisioner', value: (o) => o.provisioner },
    { label: 'Reclaim', value: (o) => o.reclaimPolicy || '' },
    { label: 'Binding', value: (o) => o.volumeBindingMode || '' },
    { label: 'Default', value: (o) => (o.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true' ? 'yes' : '') },
    created,
  ],
  nodes: [
    name,
    status(nodeStatus),
    { label: 'Roles', value: nodeRoles },
    { label: 'Version', value: (o) => o.status?.nodeInfo?.kubeletVersion || '' },
    { label: 'Instance', value: (o) => o.metadata.labels?.['node.kubernetes.io/instance-type'] || '' },
    CPU_NODE,
    MEM_NODE,
    created,
  ],
  namespaces: [name, status((o) => o.status?.phase || ''), created],
  events: [
    { label: 'Type', value: (o) => o.type || '', render: (o) => <Status value={o.type || 'Normal'} /> },
    { label: 'Reason', value: (o) => o.reason || '' },
    { label: 'Object', value: (o) => `${o.involvedObject.kind}/${o.involvedObject.name}` },
    namespace,
    { label: 'Message', value: (o) => o.message || '', render: (o) => <span className="message">{o.message}</span> },
    { label: 'Count', value: (o) => o.count || 1 },
    { label: 'Last seen', value: (o) => -new Date(eventTime(o)).getTime(), render: (o) => age(eventTime(o)) },
  ],
};

export const DEFAULT_SORT = { events: { col: 'Last seen', dir: 1 } };
