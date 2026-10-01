import { useEffect, useState } from 'react';
import type { DecisionSettings, SaveDecisionSettings } from '../../../../../electron/contracts/decision';
import { unwrapReading } from './useSmartReading';

export function ReadingServiceSettings() {
  const [settings, setSettings] = useState<DecisionSettings | null>(null), [key, setKey] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [usage, setUsage] = useState(0);
  useEffect(() => { let active = true;
    void window.catpaw!.rss.getReadingSettings().then((result) => {
      if (!active) return; const value = unwrapReading(result); setSettings(value.settings); setUsage(value.usage.inputTokens);
    }).catch((reason) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);
  async function save(test = false) {
    if (!settings) return; setBusy(true); setError(''); setNotice('');
    try {
      const { revision: _revision, keyConfigured: _configured, ...fields } = settings;
      const input: SaveDecisionSettings = { ...fields, ...(key ? { apiKey: key } : {}) };
      const result = unwrapReading(await window.catpaw!.rss.saveReadingSettings(input)); setSettings(result); setKey('');
      if (test) { const tested = unwrapReading(await window.catpaw!.rss.testReadingConnection()); setNotice(`连接正常，当前模型 ${tested.model}。`); }
      else setNotice('Jev 服务设置已保存。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试。'); }
    finally { setBusy(false); }
  }
  return <div className="reading-settings-fields">
    <p className="reading-help">Jev 用于筛选和比较文章。开启后，会将所选订阅的文章内容和关注条件发送给配置的服务，判断结果保存在本机。</p>
    {error ? <p className="reader-error" role="alert">{error}</p> : null}
    {notice ? <p className="reading-notice" role="status">{notice}</p> : null}
    {!settings ? <p>正在读取设置…</p> : <>
      <label className="reading-check"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />开启智能筛选</label>
      <label className="modal-row"><span>服务地址</span><input aria-label="Jev 服务地址" value={settings.baseUrl} onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} /></label>
      <label className="modal-row"><span>模型版本</span><input aria-label="Jev 模型版本" value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></label>
      <label className="modal-row"><span>API Key {settings.keyConfigured ? '· 已保存' : ''}</span><input aria-label="Jev API Key" type="password" autoComplete="new-password"
        value={key} placeholder={settings.keyConfigured ? '留空保留现有密钥' : '填写 TypeSafe API Key'} onChange={(event) => setKey(event.target.value)} /></label>
      <label className="modal-row"><span>每日输入 token 上限</span><input type="number" aria-label="每日输入 token 上限" min={10000} max={100000000}
        value={settings.dailyTokenLimit} onChange={(event) => setSettings({ ...settings, dailyTokenLimit: Number(event.target.value) })} /></label>
      <p className="reading-help">今天已使用或预留 {usage.toLocaleString()} token。上限覆盖文章评分与比较；连接测试单独执行。</p>
      <label className="reading-check"><input type="checkbox" checked={settings.autoFetch} onChange={(event) => setSettings({ ...settings, autoFetch: event.target.checked })} />信息不足时自动获取全文</label>
      <label className="reading-check"><input type="checkbox" checked={settings.groupEvents} onChange={(event) => setSettings({ ...settings, groupEvents: event.target.checked })} />合并同一事件的报道</label>
      <label className="reading-check"><input type="checkbox" checked={settings.trackProgress} onChange={(event) => setSettings({ ...settings, trackProgress: event.target.checked })} />记录阅读并追踪新进展</label>
      <div className="reading-actions"><button className="modal-button" disabled={busy} onClick={() => void save(true)}>保存并测试连接</button>
        <button className="modal-button primary" disabled={busy} onClick={() => void save()}>保存服务设置</button></div>
    </>}
  </div>;
}
