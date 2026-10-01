import { todayReadingWindow } from '../../../../../electron/contracts/smart-reading';
import { ReadingSearch } from './ReadingSearch';
import type { SmartReadingState } from './useSmartReading';
import { useRequestScope } from '../useRequestScope';

export function ReadingSelectionSettings({ reading, onEditFocus, onService, onShowResults }: {
  reading: SmartReadingState; onEditFocus: () => void; onService: () => void; onShowResults: () => void;
}) {
  const beginNavigation = useRequestScope(null);
  const running = reading.starting || reading.status?.phase === 'running';
  const canRun = reading.focus?.enabled && !reading.focus.archived && (reading.focus.expiresAt === null || reading.focus.expiresAt > Date.now());
  const today = todayReadingWindow();
  const isToday = reading.windowRange.since === today.since && reading.windowRange.until === today.until;
  return <div className="reading-selection-settings">
    <section className="reading-setting-section" aria-labelledby="reading-selection-heading">
      <h3 id="reading-selection-heading">挑选你想读的内容</h3>
      <p className="reading-help">选择关注事项和阅读时间，筛选结果会显示在左侧「精选」中。</p>
      <label className="reading-setting-label">关注事项
        <select aria-label="精选关注事项" value={reading.focusId} onChange={(event) => reading.selectFocus(event.target.value)}>
          {!reading.focusId ? <option value="">选择一个关注事项</option> : null}
          {reading.focus?.ephemeral ? <option value={reading.focus.id}>{reading.focus.title}</option> : null}
          {reading.focuses.filter((focus) => !focus.archived).map((focus) => <option key={focus.id} value={focus.id}>{focus.title}{!focus.enabled ? '（已暂停）' : ''}</option>)}
        </select>
      </label>
      <button className="reading-text-button" onClick={onEditFocus}>{reading.focus?.ephemeral ? '保存为事项' : reading.focus ? '管理关注事项' : '创建关注事项'}</button>
      <div className="reading-budget">
        <label>阅读时间<select aria-label="阅读时间预算" value={reading.customBudget ? 'custom' : reading.budget ?? ''} onChange={(event) => {
          reading.setCustomBudget(event.target.value === 'custom');
          reading.setBudget(event.target.value === 'custom' ? 20 : event.target.value ? Number(event.target.value) : null);
        }}>
          <option value="">不限时间</option><option value="5">5 分钟</option><option value="15">15 分钟</option>
          <option value="30">30 分钟</option><option value="60">60 分钟</option><option value="custom">自定义</option>
        </select></label>
        {reading.customBudget ? <label><input className="reading-custom-minutes" type="number" aria-label="自定义阅读分钟数" min={1} max={480} value={reading.budget ?? 20}
          onChange={(event) => reading.setBudget(Math.max(1, Math.min(480, Math.round(Number(event.target.value) || 1))))} />分钟</label> : null}
        <label className="reading-check"><input type="checkbox" checked={reading.windowRange.onlyUnread}
          onChange={(event) => reading.setWindowRange({ ...reading.windowRange, onlyUnread: event.target.checked })} />只看未读</label>
      </div>
      {reading.snapshot ? <p className="reading-help" role="status">{reading.snapshot.total === 0
        ? reading.windowRange.onlyUnread ? '当前范围没有未读文章，可以取消“只看未读”后重新筛选。' : '当前日期和订阅范围内没有文章，请调整筛选范围。'
        : `当前范围共 ${reading.snapshot.total} 篇文章，${reading.snapshot.pending} 篇待筛选。${reading.windowRange.onlyUnread ? '' : '包含已读文章。'}`}</p> : null}
      {!isToday ? <p className="reading-help">{new Date(reading.windowRange.since).toLocaleDateString()} 至 {new Date(reading.windowRange.until - 1).toLocaleDateString()}</p> : null}
      {reading.budget !== null ? <p className="reading-help">阅读时间为估计值。时长未知的音视频会在「不限时间」中显示。</p> : null}
      {!reading.settings?.enabled ? <p className="reading-help">在 Jev 服务中开启智能筛选后，即可生成精选。<button className="reading-text-button" onClick={onService}>设置 Jev 服务</button></p> : null}
      <div className="reading-selection-actions">
        <button className="modal-button primary" disabled={!canRun || running || !reading.settings?.enabled || reading.snapshot?.total === 0}
          onClick={() => {
            const isCurrent = beginNavigation();
            void reading.start().then((result) => { if (result && isCurrent()) onShowResults(); });
          }}>筛选文章</button>
        {running ? <button className="modal-button" onClick={() => void reading.cancel()}>停止筛选</button> : null}
      </div>
    </section>
    <section className="reading-setting-section" aria-labelledby="reading-query-heading">
      <h3 id="reading-query-heading">用一句话筛选</h3>
      <p className="reading-help">先检查解析出的日期和范围，再开始筛选。</p>
      <ReadingSearch disabled={Boolean(running || !reading.settings?.enabled)} onSearch={async (query) => {
        const isCurrent = beginNavigation();
        if (await reading.search(query) && isCurrent()) onShowResults();
      }} />
    </section>
    {reading.error ? <p className="reader-error" role="alert">{reading.error}</p> : null}
  </div>;
}
