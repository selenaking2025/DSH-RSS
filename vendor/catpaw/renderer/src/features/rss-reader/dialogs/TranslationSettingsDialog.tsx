import { useState } from 'react';
import type { TranslationLanguagePreference } from '../translation/document';
import { ModelSettingsDialog } from '../model-providers/ModelSettingsDialog';
import type { DialogProps } from './types';

export function TranslationSettingsDialog({ translationPreferences, onSaveTranslationPreferences, onConfigureApiKeys, onClose }: DialogProps['translation']) {
  const [language, setLanguage] = useState(translationPreferences.language);
  return (
    <ModelSettingsDialog kind="translation" modelKey={translationPreferences.modelKey}
      description="选择目标语言和模型，保存后点击文章右上角的翻译按钮即可使用。"
      onSave={(modelKey) => onSaveTranslationPreferences({ language, modelKey })}
      onConfigureApiKeys={onConfigureApiKeys} onClose={onClose}>
      <label className="modal-row">
        <span>目标语言</span>
        <select aria-label="翻译目标语言" value={language} onChange={(event) => setLanguage(event.target.value as TranslationLanguagePreference)}>
          <option value="auto">自动中英互译</option><option value="zh-CN">简体中文</option><option value="en">English</option>
        </select>
      </label>
    </ModelSettingsDialog>
  );
}
