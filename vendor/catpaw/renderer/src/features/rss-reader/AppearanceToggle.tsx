import { useEffect, useRef, useState } from 'react';
import type { ThemePreference } from '../../../../electron/contracts/appearance';
import { ReaderIcon } from './ReaderIcon';
import { useRequestScope } from './useRequestScope';

const themes = {
  light: { label: '浅色', icon: 'today', next: 'system' },
  system: { label: '跟随系统', icon: 'monitor', next: 'dark' },
  dark: { label: '深色', icon: 'moon', next: 'light' },
} as const;

export function AppearanceToggle() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const beginRequest = useRequestScope('appearance');

  useEffect(() => {
    const rss = window.catpaw?.rss;
    if (!rss) { setBusy(false); return; }
    const current = beginRequest();
    void rss.getThemePreference().then((value) => {
      if (current()) setPreference(value);
    }).catch(() => {
      if (current()) setError('读取外观设置失败，请点击重试。');
    }).finally(() => {
      if (current()) setBusy(false);
    });
  }, [beginRequest]);

  const cycleTheme = async () => {
    const rss = window.catpaw?.rss;
    if (!rss || busy || pending.current) return;
    const current = beginRequest();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const previous = preference ?? await rss.getThemePreference();
      if (!current()) return;
      const saved = await rss.setThemePreference(themes[previous].next);
      if (current()) setPreference(saved);
    } catch {
      if (current()) setError('外观设置未能保存，请点击重试。');
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };

  const theme = preference ? themes[preference] : null;
  const label = theme
    ? `界面外观：${theme.label}，点击切换为${themes[theme.next].label}`
    : '界面外观：点击重试';

  return (
    <div className="reader-appearance">
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        title={busy ? '正在更新界面外观…' : error || label}
        disabled={!window.catpaw?.rss}
        aria-disabled={busy}
        aria-busy={busy}
        onClick={() => void cycleTheme()}
      >
        <ReaderIcon name={theme?.icon ?? 'appearance'} />
      </button>
      {error && <p className="reader-appearance-error" role="alert">{error}</p>}
    </div>
  );
}
