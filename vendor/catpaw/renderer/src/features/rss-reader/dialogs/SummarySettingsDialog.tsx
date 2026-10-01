import { ModelSettingsDialog } from '../model-providers/ModelSettingsDialog';
import type { DialogProps } from './types';

export function SummarySettingsDialog({ summaryPreferences, onSaveSummaryPreferences, onConfigureApiKeys, onClose }: DialogProps['summary']) {
  return (
    <ModelSettingsDialog kind="summary" modelKey={summaryPreferences.modelKey}
      description="为摘要独立选择供应商和模型。保存后，生成或重新生成摘要时使用新选择，已有摘要会继续保留。"
      onSave={(modelKey) => onSaveSummaryPreferences({ modelKey })}
      onConfigureApiKeys={onConfigureApiKeys} onClose={onClose} />
  );
}
