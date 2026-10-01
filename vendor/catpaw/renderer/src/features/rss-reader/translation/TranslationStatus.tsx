import type { useArticleTranslation } from './useArticleTranslation';
import './translation.css';

export function TranslationStatus({ translation, onConfigure }: { translation: ReturnType<typeof useArticleTranslation>; onConfigure(): void }) {
  if (!translation.engaged) return null;
  const { busy, document, error, message, progress } = translation;
  const text = busy ? `正在翻译${progress?.total ? `（${progress.completed}/${progress.total}）` : '…'}`
    : document ? `当前显示${translation.language === 'en' ? '英文' : '中文'}译文，已保存到本地` : message ?? '当前显示原稿';
  return (
    <div className="article-translation-status">
      <div className="article-translation-status-row">
        <span role={error ? 'alert' : 'status'} className={error ? 'article-translation-error' : ''}>{error ?? text}</span>
        {busy || error ? <div className="article-translation-actions">
          <button type="button" onClick={() => void translation.toggle()}>{busy ? '取消翻译' : '重试翻译'}</button>
          {!busy && error ? <button type="button" onClick={onConfigure}>配置 API Key</button> : null}
        </div> : null}
      </div>
    </div>
  );
}
