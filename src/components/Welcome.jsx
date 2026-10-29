import { ChevronRight, RefreshCw } from 'lucide-react';
import { colorFor, initials, isProd, shortContext } from '../util.js';
import KubectlHint from './KubectlHint.jsx';
import ErrorBox from './ErrorBox.jsx';

export default function Welcome({ contexts, error, onConnect, onReload }) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="brand"><span className="brand-mark" /> kubeglass</div>
        <div className="welcome-header">
          <div>
            <h1>Clusters</h1>
            <p className="muted" style={{ margin: 0 }}>From your kubeconfig ($KUBECONFIG or ~/.kube/config). Pick one to connect.</p>
          </div>
          <button className="btn" onClick={onReload}><RefreshCw size={14} /> Reload kubeconfig</button>
        </div>
        <KubectlHint command="kubectl config get-contexts" />
        <ErrorBox error={error} />
        {!contexts && !error && <div className="muted">Loading…</div>}
        <div className="cluster-grid">
          {(contexts || []).map((c) => (
            <button key={c.name} className="cluster-card" onClick={() => onConnect(c.name)}>
              <span className="avatar" style={{ background: colorFor(c.name), width: 40, height: 40, borderRadius: 10 }}>{initials(c.name)}</span>
              <span className="cluster-card-body">
                <span className="cluster-card-title">
                  {shortContext(c.name)}
                  {isProd(c) && <span className="badge-prod">PROD</span>}
                  {c.current && <span className="badge">current</span>}
                </span>
                {c.name !== shortContext(c.name) && <span className="muted small" title={c.name}>{c.name}</span>}
                <span className="muted small mono" title={c.server}>{c.server}</span>
                {c.namespace && <span className="muted small">namespace: {c.namespace}</span>}
              </span>
              <ChevronRight size={16} className="card-arrow" />
            </button>
          ))}
        </div>
        {contexts?.length === 0 && <div className="muted">No contexts found in your kubeconfig.</div>}
      </div>
    </div>
  );
}
