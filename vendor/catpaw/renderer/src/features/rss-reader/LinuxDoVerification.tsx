import { useState } from 'react';
import { useRequestScope } from './useRequestScope';
import { friendlyReaderError } from './errors';

export function isLinuxDoSource(input?: string | null) {
  try { const url = new URL(input ?? ''); return url.origin === 'https://linux.do' && !url.username && !url.password; }
  catch { return false; }
}

export function LinuxDoVerification({ url, disabled, onRetry }: { url: string; disabled?: boolean; onRetry: () => Promise<void> }) {
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const begin = useRequestScope(url);
  if (!isLinuxDoSource(url)) return null;
  const verify = async () => {
    if (!window.catpaw || verifying) return;
    const current = begin();
    setVerifying(true); setError('');
    try {
      const result = await window.catpaw.rss.verifyLinuxDo();
      if (!current()) return;
      if (!result.ok) { setError(friendlyReaderError(result.error)); return; }
      await onRetry();
    } catch (cause) { if (current()) setError(friendlyReaderError(cause)); }
    finally { if (current()) setVerifying(false); }
  };
  return <div className="linuxdo-verification">
    <p>{verifying ? '请在新窗口完成验证或登录，然后关闭窗口。关闭后会自动重试。' : '如果 Linux DO 要求验证或登录，请在应用内完成。登录状态仅保存在本机。'}</p>
    <button type="button" className="modal-button ghost" disabled={disabled || verifying} onClick={() => void verify()}>
      {verifying ? '等待完成验证…' : '验证 Linux DO 并重试'}
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
