import { useEffect, useMemo, useState } from 'react';
import { ON_MY_MAC_GROUP_NAMES, FEED_DISCOVERY_SOURCE_LABELS } from '../constants';
import { inferPrimaryGroupName } from '../utils';
import type { FeedRunDiagnostic, SourceEndpointHealth, XApiFallbackStatus } from '../types';
import { useDialogFeedback } from './feedback';
import type { DialogProps, OpmlPreviewState, FeedDiscoveryCandidate } from './types';

export function RefreshSettingsDialog(props: DialogProps['refresh']) {
const { settings, onHistoryYearChanged: setEffectiveHistoryStartYear } = props;
const { onClose, onChanged, notify } = props;
const { reportError, clearError, error } = useDialogFeedback(notify);
const [refreshSettingsEnabled, setRefreshSettingsEnabled] = useState(settings.enabled);
const [refreshSettingsDailyTime, setRefreshSettingsDailyTime] = useState(settings.dailyTime);
const [refreshSettingsCatchUp, setRefreshSettingsCatchUp] = useState(settings.catchUpMissed);
const [historyStartYear, setHistoryStartYear] = useState(String(settings.historyStartYear));
const [historyMaxPagesPerFeed, setHistoryMaxPagesPerFeed] = useState(String(settings.historyMaxPagesPerFeed));
const [savingRefreshSettings, setSavingRefreshSettings] = useState(false);
const handleSaveRefreshSettings = async () => {
    if (!window.catpaw || savingRefreshSettings) return;
    if (!Number.isInteger(Number(historyStartYear)) || Number(historyStartYear) < 1990 || Number(historyStartYear) > new Date().getFullYear()) { reportError('保存刷新设置失败', 'REFRESH_HISTORY_START_YEAR_INVALID'); return; }
    if (!Number.isInteger(Number(historyMaxPagesPerFeed)) || Number(historyMaxPagesPerFeed) < 1 || Number(historyMaxPagesPerFeed) > 300) { reportError('保存刷新设置失败', 'REFRESH_HISTORY_MAX_PAGES_INVALID'); return; }
    setSavingRefreshSettings(true);
    clearError();
    try {
      const result = await window.catpaw.rss.updateRefreshSettings({
        enabled: refreshSettingsEnabled,
        dailyTime: refreshSettingsDailyTime,
        catchUpMissed: refreshSettingsCatchUp,
        historyStartYear: Number(historyStartYear),
        historyMaxPagesPerFeed: Number(historyMaxPagesPerFeed),
      });
      if (!result.ok) {
        reportError('保存刷新设置失败', result.error);
        return;
      }
      if (result.settings) {
        setEffectiveHistoryStartYear(result.settings.historyStartYear);
      }
      onClose();
    } catch (error) {
      reportError('保存刷新设置失败', error);
    } finally {
      setSavingRefreshSettings(false);
    }
  };

return (
<div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card refresh-settings-modal">
{error && <div className="reader-error" role="alert">{error}</div>}
            <div className="modal-body">
              <div className="refresh-settings-heading">
                <h2>刷新设置</h2>
                <p>控制后台刷新。已暂停的订阅源仍然可以手动刷新。</p>
              </div>
              <label className="modal-row">
                <span>定时:</span>
                <span className="modal-checkbox-line">
                  <input
                    type="checkbox"
                    checked={refreshSettingsEnabled}
                    onChange={(event) => setRefreshSettingsEnabled(event.target.checked)}
                  />
                  启用定时刷新
                </span>
              </label>
              <label className="modal-row">
                <span>每日时间:</span>
                <input
                  type="time"
                  value={refreshSettingsDailyTime}
                  onChange={(event) => setRefreshSettingsDailyTime(event.target.value)}
                  disabled={!refreshSettingsEnabled}
                />
              </label>
              <label className="modal-row">
                <span>补跑:</span>
                <span className="modal-checkbox-line">
                  <input
                    type="checkbox"
                    checked={refreshSettingsCatchUp}
                    onChange={(event) => setRefreshSettingsCatchUp(event.target.checked)}
                    disabled={!refreshSettingsEnabled}
                  />
                  启动或唤醒后，补跑错过的每日刷新或单个订阅源刷新
                </span>
              </label>
              <label className="modal-row">
                <span>历史起始:</span>
                <input
                  type="number"
                  min={1990}
                  max={new Date().getFullYear()}
                  step={1}
                  value={historyStartYear}
                  onChange={(event) => setHistoryStartYear(event.target.value)}
                />
              </label>
              <label className="modal-row">
                <span>单源页数:</span>
                <input
                  type="number"
                  min={1}
                  max={300}
                  step={1}
                  value={historyMaxPagesPerFeed}
                  onChange={(event) => setHistoryMaxPagesPerFeed(event.target.value)}
                />
              </label>
              <div className="refresh-settings-note">
                单个订阅源的刷新间隔可以在该订阅源的编辑面板里设置。暂停某个订阅源后，它不再参与定时刷新和「全部刷新」，但直接手动刷新仍然有效。
              </div>
              <div className="refresh-settings-note">
                历史回补会走到设定年份为止，每个订阅源最多翻这么多页。多数 RSS 源本身不提供翻页，只能取到当前这一页；能真正翻到更早内容的主要是小宇宙、X 以及部分支持分页的镜像源。
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-button ghost"
                onClick={() => onClose()}
                disabled={savingRefreshSettings}
              >
                取消
              </button>
              <button
                type="button"
                className="modal-button primary"
                onClick={handleSaveRefreshSettings}
                disabled={savingRefreshSettings || !refreshSettingsDailyTime}
              >
                {savingRefreshSettings ? '正在保存…' : '保存设置'}
              </button>
            </div>
          </div>
        </div>
);
}
