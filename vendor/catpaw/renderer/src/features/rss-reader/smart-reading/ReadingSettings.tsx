import { useState } from 'react';
import type { ReadingFocus } from '../../../../../electron/contracts/smart-reading';
import type { Feed, FeedGroup } from '../types';
import { ReadingDialog } from './ReadingDialog';
import { ReadingServiceSettings } from './ReadingServiceSettings';
import { ReadingFocusEditor } from './ReadingFocusEditor';
import type { SmartReadingState } from './useSmartReading';
import { ReadingSelectionSettings } from './ReadingSelectionSettings';

export type ReadingSettingsTab = 'selection' | 'focus' | 'service';
const tabs: Array<{ id: ReadingSettingsTab; label: string }> = [
  { id: 'selection', label: '筛选条件' }, { id: 'focus', label: '关注事项' }, { id: 'service', label: 'Jev 服务' },
];

export function ReadingSettings({ reading, feeds, groups, initialTab, onClose, onShowResults }: {
  reading: SmartReadingState; feeds: Feed[]; groups: FeedGroup[]; initialTab: ReadingSettingsTab; onClose: () => void; onShowResults: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [focus, setFocus] = useState<ReadingFocus | undefined>(reading.focus), [notice, setNotice] = useState('');
  const focuses = reading.focuses;
  function saved(next: ReadingFocus) {
    setFocus(next); setNotice(`“${next.title}”已保存。`);
    void reading.reloadConfig().then(() => { if (!next.archived) reading.selectFocus(next.id); });
  }
  return <ReadingDialog onClose={onClose}>
    <header className="reading-settings-heading"><h2 id="reading-settings-title">精选设置</h2>
      <button className="modal-button ghost" aria-label="关闭精选设置" onClick={onClose}>关闭</button></header>
    <div className="reading-tabs" role="tablist" aria-label="精选设置分类">
      {tabs.map((item, index) => <button key={item.id} id={`reading-tab-${item.id}`} role="tab" aria-selected={tab === item.id}
        aria-controls="reading-settings-panel" tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
          if (next < 0) return;
          event.preventDefault(); setTab(tabs[next].id); document.getElementById(`reading-tab-${tabs[next].id}`)?.focus();
        }}>{item.label}</button>)}</div>
    <div className="reading-settings-content" id="reading-settings-panel" role="tabpanel" aria-labelledby={`reading-tab-${tab}`}>
      {tab === 'selection' ? <ReadingSelectionSettings reading={reading} onEditFocus={() => { setFocus(reading.focus); setTab('focus'); }}
        onService={() => setTab('service')} onShowResults={onShowResults} /> : tab === 'service' ? <ReadingServiceSettings /> : <>
        <div className="reading-interest-picker"><label>编辑事项<select aria-label="编辑关注事项" value={focus?.id ?? ''} onChange={(event) => { setFocus(focuses.find((item) => item.id === event.target.value)); setNotice(''); }}>
          <option value="">创建新事项</option>{focus?.ephemeral && !focuses.some((item) => item.id === focus.id) ? <option value={focus.id}>{focus.title}</option> : null}
          {focuses.map((item) => <option value={item.id} key={item.id}>{item.title}{item.archived ? '（已归档）' : !item.enabled ? '（已暂停）' : ''}</option>)}</select></label>
          <button className="modal-button" onClick={() => { setFocus(undefined); setNotice(''); }}>新建事项</button></div>
        {notice ? <p role="status" className="reading-notice">{notice}</p> : null}
        <ReadingFocusEditor key={`${focus?.id ?? 'new'}:${focus?.revision ?? 0}`} focus={focus} feeds={feeds} groups={groups} onSaved={saved} />
      </>}
    </div>
    <footer className="reading-settings-footer"><p className="reading-help">结果在左侧「精选」中查看</p>
      <button className="modal-button" onClick={onShowResults}>查看精选</button></footer>
  </ReadingDialog>;
}
