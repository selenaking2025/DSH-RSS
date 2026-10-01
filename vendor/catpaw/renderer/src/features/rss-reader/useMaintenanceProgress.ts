import { useEffect, useState } from 'react';
import type { MaintenanceStatus } from '../../../../electron/contracts/maintenance';
const labels = { rebuild: '重建搜索索引', import: '导入订阅', preview: '检查导入内容',
  backup: '保存并检查备份', validate: '检查备份', restore: '准备恢复', applyRestore: '恢复数据' };
export function useMaintenanceProgress(active: boolean) {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  useEffect(() => {
    if (!active) { setStatus(null); return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const status = await window.catpaw!.rss.getMaintenanceStatus(); if (!stopped) setStatus(status); }
      finally { if (!stopped) timer = setTimeout(() => { void poll().catch(() => {}); }, 250); }
    };
    void poll().catch(() => {});
    return () => { stopped = true; clearTimeout(timer); };
  }, [active]);
  if (!status) return '正在处理…';
  if (status.phase === 'waiting') return '等待当前任务完成后继续…';
  return `${labels[status.kind]}${status.total ? `（${status.completed}/${status.total}）` : ''}…`;
}
