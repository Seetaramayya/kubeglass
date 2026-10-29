import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function KubectlHint({ command, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="kubectl-hint" title="Equivalent kubectl command">
      {label ? <span className="hint-label">{label}</span> : <span className="prompt">$</span>}
      <code>{command}</code>
      <button className="btn-ghost" onClick={copy} title="Copy command">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
