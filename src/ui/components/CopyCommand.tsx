import { useState } from 'react';

export function CopyCommand({ command, label }: { command: string; label: string }) {
  const [status, setStatus] = useState('');
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setStatus('Скопировано'); }
    catch { setStatus('Не удалось скопировать. Выделите команду и скопируйте вручную.'); }
  };
  return <div className="telegram-copy-command">
    <div className="telegram-copy-row"><input aria-label={label} readOnly value={command} onFocus={e => e.target.select()} onClick={() => void copy()}/><button type="button" onClick={() => void copy()}>Копировать</button></div>
    <p className="hint" role="status">{status || 'Нажмите на команду, чтобы скопировать.'}</p>
  </div>;
}
