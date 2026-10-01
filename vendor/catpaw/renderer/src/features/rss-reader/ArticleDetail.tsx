import { useEffect, useRef, type RefObject } from 'react';
import { getEntryDisplayTitle } from '../../../../electron/contracts/article-title';
import { buildTweetEmbedUrl } from './utils';
import type { Entry, EntryAnalysis, MediaChapter, SocialThreadItem } from './types';
import { ReaderIcon } from './ReaderIcon';
import { useArticleTranslation } from './translation/useArticleTranslation';
import { TranslationStatus } from './translation/TranslationStatus';
import type { TranslationPreferences } from './translation/useTranslationPreferences';

type ArticleDetailProps = {
  selectedEntry: Entry | null;
  selectedFeedLabel: string;
  selectedTweetId: string | null;
  loadingSocialThread: boolean;
  socialThread: SocialThreadItem[] | null;
  resolvedMedia: { mediaType: string | null; mediaUrl: string | null };
  mediaHostLabel: string | null;
  mediaChapters: MediaChapter[];
  mediaPlayerRef: RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  sanitizedHtml: string | null;
  sanitizedVideoEmbedHtml: string | null;
  hasCapturedContent: boolean;
  fullContentFetchBusy: boolean;
  hasStoredFullContent: boolean;
  fullContentFetchLabel: string;
  fullContentFetchHint: string | null;
  analyzingEntry: boolean;
  entryAnalysis: EntryAnalysis | null;
  onToggleStar: () => void;
  onFetchFullContent: (entryId: string) => void;
  onAnalyzeEntry: () => void;
  onCancelAnalysis: () => void;
  onJumpToChapter: (seconds: number) => void;
  onConfigureTranslation: () => void;
  translationPreferences: TranslationPreferences;
};

export function ArticleDetail(props: ArticleDetailProps) {
  const {
    selectedEntry,
    selectedFeedLabel,
    selectedTweetId,
    loadingSocialThread,
    socialThread,
    resolvedMedia,
    mediaHostLabel,
    mediaChapters,
    mediaPlayerRef,
    sanitizedHtml,
    sanitizedVideoEmbedHtml,
    hasCapturedContent,
    fullContentFetchBusy,
    hasStoredFullContent,
    fullContentFetchLabel,
    fullContentFetchHint,
    analyzingEntry,
    entryAnalysis,
    onToggleStar,
    onFetchFullContent,
    onAnalyzeEntry,
    onJumpToChapter,
  } = props;
  const detailRef = useRef<HTMLElement>(null);
  const translation = useArticleTranslation({
    entryId: selectedEntry?.id ?? null, title: selectedEntry?.title ?? '无标题', html: sanitizedHtml,
    summary: sanitizedHtml ? null : selectedEntry?.summary ?? null,
    chapters: mediaChapters.map((chapter) => chapter.label), threads: socialThread?.map((item) => item.text) ?? [],
  }, props.translationPreferences);
  const translated = translation.document;
  const displayTitle = getEntryDisplayTitle(selectedEntry && {
    ...selectedEntry, title: translated?.title ?? selectedEntry.title,
  });
  const displayHtml = translated?.html ?? sanitizedHtml;
  useEffect(() => { detailRef.current?.scrollTo({ top: 0 }); }, [selectedEntry?.id]);

  if (!selectedEntry) {
    return (
      <section className="reader-detail" aria-label="文章阅读">
        <div className="reader-empty">
          <ReaderIcon name="book" />
          <h2>选择一篇文章开始阅读。</h2>
          <p>在文章列表中选择，或搜索感兴趣的内容。</p>
        </div>
      </section>
    );
  }

  const showStandaloneTweet = Boolean(selectedTweetId && (!socialThread || socialThread.length === 0));
  const hasTranslatedTweetContent = Boolean(translated?.html || translated?.summary?.trim());
  const showInlineCapturedTweetContent = Boolean(
    selectedTweetId
    && sanitizedHtml
    && /data-[a-z0-9_-]+-x-thread="1"/i.test(sanitizedHtml),
  );

  const openArticleLink = (event: React.MouseEvent<HTMLElement>) => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(target instanceof HTMLAnchorElement)) return;
    const href = target.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    if (href.startsWith('#')) {
      try { detailRef.current?.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ block: 'start' }); }
      catch { /* Invalid source fragments must not navigate the reader. */ }
      return;
    }
    window.open(target.href, '_blank', 'noopener,noreferrer');
  };

  return (
    <section ref={detailRef} className="reader-detail" aria-label="文章阅读" onClick={openArticleLink} onAuxClick={openArticleLink}>
      <div className="reader-detail-header">
        <div className="detail-source-row">
          <div className="detail-source">{selectedFeedLabel}</div>
          <div className="detail-actions">
            {selectedEntry.link && (
              <button type="button" className="detail-icon-button" onClick={() => onFetchFullContent(selectedEntry.id)}
                disabled={fullContentFetchBusy || hasStoredFullContent} aria-busy={fullContentFetchBusy}
                aria-label={fullContentFetchLabel} title={fullContentFetchHint ?? fullContentFetchLabel}>
                <ReaderIcon name="download" />
              </button>
            )}
            <button type="button" className="detail-icon-button" aria-busy={analyzingEntry}
              onClick={analyzingEntry ? props.onCancelAnalysis : onAnalyzeEntry}
              aria-label={analyzingEntry ? '取消生成' : entryAnalysis ? '重新生成摘要' : '生成摘要'}
              title={analyzingEntry ? '正在生成摘要，点击取消' : entryAnalysis ? '重新生成摘要' : '生成摘要'}>
              <ReaderIcon name={analyzingEntry ? 'close' : 'summary'} />
            </button>
            <button type="button" className={`detail-icon-button${translated ? ' translation-active' : ''}${translation.busy ? ' translation-pending' : ''}`}
              aria-label={translation.busy ? '取消翻译' : translated ? '显示原稿' : '翻译文章'}
              title={translation.busy ? '正在翻译，点击取消' : translated ? '显示原稿' : '翻译文章'}
              aria-pressed={Boolean(translated)} aria-busy={translation.busy} onClick={() => void translation.toggle()}>
              <ReaderIcon name="translate" />
            </button>
            {selectedEntry.link && (
              <button
                type="button"
                className="detail-icon-button"
                onClick={() => window.open(selectedEntry.link!, '_blank')}
                aria-label="打开原文"
                title="打开原文"
              >
                <ReaderIcon name="external" />
              </button>
            )}
            <button
              type="button"
              className={`detail-icon-button${selectedEntry.isStarred ? ' active' : ''}`}
              onClick={onToggleStar}
              aria-pressed={selectedEntry.isStarred === 1}
              aria-label={selectedEntry.isStarred ? '取消收藏' : '收藏'}
              title={selectedEntry.isStarred ? '取消收藏' : '收藏'}
            >
              <ReaderIcon name="starred" fill={selectedEntry.isStarred ? 'currentColor' : 'none'} />
            </button>

          </div>
        </div>
        <h2 lang={translation.language ?? undefined}>{displayTitle}</h2>
        <div className="detail-meta">
          <time dateTime={selectedEntry.publishedAt ? new Date(selectedEntry.publishedAt).toISOString() : undefined}>
            {selectedEntry.publishedAt
              ? new Date(selectedEntry.publishedAt).toLocaleString('zh-CN', {
                  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
                })
              : '时间未知'}
          </time>
        </div>
        <TranslationStatus translation={translation} onConfigure={props.onConfigureTranslation} />
        {fullContentFetchHint && <div className="detail-subtle-note">{fullContentFetchHint}</div>}
      </div>
      <div className="reader-detail-body">
        {selectedTweetId && (
          <div className="detail-thread">
            <div className="detail-thread-title">X 讨论串</div>
            {loadingSocialThread && <div className="detail-thread-loading">正在载入讨论串…</div>}
            {!loadingSocialThread && socialThread && socialThread.length > 0 && (
              <div className="detail-thread-list">
                {socialThread.map((item, index) => (
                  <article
                    key={`${item.entryId}:${item.tweetId}`}
                    className={`detail-thread-item${item.entryId === selectedEntry.id ? ' current' : ''}`}
                  >
                    <div className="detail-thread-item-head">
                      <span className="detail-thread-index">{index + 1}</span>
                      <span className="detail-thread-time">
                        {item.publishedAt ? new Date(item.publishedAt).toLocaleString() : '时间未知'}
                      </span>
                      {item.link && (
                        <button type="button" className="detail-thread-open" onClick={() => window.open(item.link, '_blank')}>
                          打开
                        </button>
                      )}
                    </div>
                    {translated?.threads[index]?.trim() ? <p className="detail-thread-translated" lang={translation.language ?? undefined}>{translated.threads[index]}</p> : <div className="detail-thread-embed">
                      <iframe
                        src={buildTweetEmbedUrl(item.tweetId)}
                        frameBorder="0"
                        scrolling="no"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </div>}
                    {!translated && item.text && (
                      <details className="detail-thread-extra">
                        <summary>展开抓取到的文本</summary>
                        <p className="detail-thread-extra-text">{item.text}</p>
                      </details>
                    )}
                  </article>
                ))}
              </div>
            )}
            {!loadingSocialThread && socialThread && socialThread.length === 0 && (
              <div className="detail-thread-loading">本地还没有这条讨论串的上下文。</div>
            )}
          </div>
        )}

        {(resolvedMedia.mediaType === 'video' || resolvedMedia.mediaType === 'audio') && (
          <div className="detail-media-block">
            <div className="detail-media-meta">
              <span className="detail-media-source">{mediaHostLabel ?? '媒体'}</span>
              <span className="detail-media-sep">•</span>
              <span className="detail-media-count">
                {mediaChapters.length > 0 ? `${mediaChapters.length} 个章节` : '未识别到章节'}
              </span>
            </div>
            {mediaChapters.length > 0 && (
              <div className="detail-chapters">
                {mediaChapters.map((chapter, index) => (
                  <button
                    key={`${chapter.seconds}:${chapter.label}`}
                    type="button"
                    className="detail-chapter"
                    onClick={() => onJumpToChapter(chapter.seconds)}
                  >
                    <span className="detail-chapter-time">{chapter.timecode}</span>
                    <span className="detail-chapter-label">{translated?.chapters[index] ?? chapter.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {resolvedMedia.mediaType === 'video' && resolvedMedia.mediaUrl && (
          sanitizedVideoEmbedHtml ? (
            <div className="detail-video" dangerouslySetInnerHTML={{ __html: sanitizedVideoEmbedHtml }} />
          ) : (
            <div className="detail-video-native">
              <video ref={mediaPlayerRef as any} controls preload="metadata" playsInline src={resolvedMedia.mediaUrl} />
            </div>
          )
        )}

        {showStandaloneTweet && !hasTranslatedTweetContent && (
          <div className="detail-tweet">
            <div className="tweet-container">
              <iframe
                src={buildTweetEmbedUrl(selectedTweetId!)}
                frameBorder="0"
                scrolling="no"
                loading="lazy"
                referrerPolicy="no-referrer"
                style={{ width: '100%', minHeight: '560px', border: 'none' }}
              />
            </div>
          </div>
        )}

        {resolvedMedia.mediaType === 'audio' && resolvedMedia.mediaUrl && (
          <div className="detail-audio">
            <audio ref={mediaPlayerRef as any} controls preload="metadata" src={resolvedMedia.mediaUrl} />
          </div>
        )}

        {translated ? (
          displayHtml ? <div className="detail-content" lang={translation.language ?? undefined} dangerouslySetInnerHTML={{ __html: displayHtml }} />
            : translated.summary || !selectedTweetId ? <p lang={translation.language ?? undefined}>{translated.summary ?? '暂无正文。'}</p> : null
        ) : selectedTweetId ? (
          hasCapturedContent ? (
            showInlineCapturedTweetContent ? (
              <div className="detail-content" dangerouslySetInnerHTML={{ __html: sanitizedHtml! }} />
            ) : (
              <details className="detail-captured-collapse">
                <summary>展开抓取到的正文</summary>
                <div className="detail-captured-body">
                  {sanitizedHtml ? (
                    <div className="detail-content" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
                  ) : (
                    <p>{selectedEntry.summary ?? '暂无正文。'}</p>
                  )}
                </div>
              </details>
            )
          ) : null
        ) : sanitizedHtml ? (
          <div className="detail-content" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
        ) : (
          <p>{selectedEntry.summary ?? '暂无正文。'}</p>
        )}

        {entryAnalysis && (
          <div className="detail-analysis">
            <section className="detail-analysis-card" aria-label="文章摘要">
              <div className="detail-analysis-title">摘要</div>
              <p lang="zh-CN">{entryAnalysis.summary}</p>
              <div className="detail-subtle-note">
                {entryAnalysis.sourceKind === 'excerpt' ? '基于订阅节选，未获取到全文 · ' : ''}{entryAnalysis.model}
              </div>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
