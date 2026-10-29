import { useState } from 'react';
import { ShieldAlert, TriangleAlert } from 'lucide-react';
import KubectlHint from './KubectlHint.jsx';

function Modal({ title, danger, children, onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${danger ? 'danger' : ''}`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>{danger && <TriangleAlert size={17} />}{title}</h3>
        {children}
      </div>
    </div>
  );
}

// On production contexts the user must type the resource name to confirm.
export function ConfirmDialog({ title, message, command, prod, confirmWord, actionLabel = 'Confirm', danger, onResult }) {
  const [typed, setTyped] = useState('');
  const needsTyping = prod && confirmWord;
  const ok = !needsTyping || typed === confirmWord;
  return (
    <Modal title={title} danger={danger} onClose={() => onResult(false)}>
      {prod && <div className="prod-warning"><ShieldAlert size={15} /> Production cluster. Double-check before you continue.</div>}
      <p>{message}</p>
      {command && <KubectlHint command={command} />}
      {needsTyping && (
        <label className="field">
          Type <b>{confirmWord}</b> to confirm
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && onResult(true)} />
        </label>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={() => onResult(false)}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={!ok} autoFocus={!needsTyping} onClick={() => onResult(true)}>
          {actionLabel}
        </button>
      </div>
    </Modal>
  );
}

export function PromptDialog({ title, label, initial, type = 'text', prod, commandFor, actionLabel = 'OK', onResult }) {
  const [value, setValue] = useState(String(initial ?? ''));
  const submit = () => onResult(value);
  return (
    <Modal title={title} onClose={() => onResult(null)}>
      {prod && <div className="prod-warning"><ShieldAlert size={15} /> Production cluster. Double-check before you continue.</div>}
      <label className="field">
        {label}
        <input autoFocus type={type} min={type === 'number' ? 0 : undefined} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </label>
      {commandFor && <KubectlHint command={commandFor(value)} />}
      <div className="modal-actions">
        <button className="btn" onClick={() => onResult(null)}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>{actionLabel}</button>
      </div>
    </Modal>
  );
}
