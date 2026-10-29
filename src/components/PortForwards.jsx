import { ExternalLink, Square, Waypoints } from 'lucide-react';
import { api } from '../api.js';
import { usePoll } from '../hooks.js';
import { kubectl, shortContext } from '../util.js';
import { KINDS } from '../../shared/kinds.js';
import KubectlHint from './KubectlHint.jsx';
import ErrorBox from './ErrorBox.jsx';

const POLL_MS = 2000;

export default function PortForwards({ toast }) {
  const { data, error, refresh } = usePoll(() => api('/portforwards'), [], { interval: POLL_MS });
  const stop = async (id) => {
    try {
      await api(`/portforwards/${id}`, { method: 'DELETE' });
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <section className="page">
      <header className="page-header">
        <h1><Waypoints size={18} className="title-icon" /> Port Forwarding {data && <span className="count-pill">{data.length}</span>}</h1>
      </header>
      <p className="muted" style={{ margin: '0 24px 12px' }}>Open a pod or service and click <b>Forward</b> next to a port. Forwards stop when kubeglass exits.</p>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Local</th><th>Target</th><th>Namespace</th><th>Cluster</th><th>Connections</th><th>Last error</th><th /></tr></thead>
          <tbody>
            {(data || []).map((f) => (
              <tr key={f.id}>
                <td><a href={`http://localhost:${f.localPort}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>localhost:{f.localPort} <ExternalLink size={12} /></a></td>
                <td>{KINDS[f.kind].kubectl}/{f.name}:{f.port}{f.targetPort !== f.port ? ` → ${f.targetPort}` : ''}</td>
                <td>{f.namespace}</td>
                <td>{shortContext(f.context)}</td>
                <td>{f.connections}</td>
                <td className="bad-text small">{f.lastError || ''}</td>
                <td className="actions-col"><button className="btn-ghost danger" onClick={() => stop(f.id)}><Square size={13} /> Stop</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <div className="empty"><Waypoints size={28} />No active port forwards</div>}
        <div style={{ height: 12 }} />
        {(data || []).map((f) => (
          <KubectlHint key={f.id} command={kubectl(f.context, 'port-forward', `${KINDS[f.kind].kubectl}/${f.name}`, `${f.localPort}:${f.port}`, `-n ${f.namespace}`)} />
        ))}
      </div>
    </section>
  );
}
