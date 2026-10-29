import { CircleAlert } from 'lucide-react';

// Explains the most common reasons a cluster call fails, since raw exec-plugin errors are cryptic.
function hintFor(message) {
  if (/sso|token has expired|ExpiredToken|refresh failed|InvalidClientTokenId/i.test(message)) return 'Your AWS credentials look expired. Run `aws sso login` (or refresh your AWS profile), then wait a few seconds.';
  if (/ENOTFOUND|no such host|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/i.test(message)) return 'The cluster API server is unreachable. Check VPN/network, or that the local cluster is running.';
  if (/metrics-server is not installed/i.test(message)) return '`kubectl top` needs metrics-server. On EKS add it with `aws eks create-addon --cluster-name <name> --addon-name metrics-server`, elsewhere `kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml`. Everything else works without it.';
  if (/forbidden/i.test(message)) return 'Your user lacks RBAC permission for this. Pick a namespace you have access to.';
  if (/ENOENT|executable file not found|spawn/i.test(message)) return 'The auth plugin from your kubeconfig (e.g. aws, gke-gcloud-auth-plugin) is not on PATH for the kubeglass process.';
  return null;
}

export default function ErrorBox({ error }) {
  if (!error) return null;
  const hint = hintFor(error.message || '');
  return (
    <div className="error-box">
      <CircleAlert size={15} />
      <div>
        <div>{error.message}</div>
        {hint && <div className="error-hint">{hint}</div>}
      </div>
    </div>
  );
}
