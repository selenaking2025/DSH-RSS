import { listFeeds } from '../data/feed-repo';
import { updateFeed } from '../data/feed-write-repo';
import { extractXiaoyuzhouPodcastIdFromUrl, resolveFeedUrlFromInput } from '../sources/rsshub';
import { rssJobManager } from '../rss-job-manager';
import { withHistoryDepthDefaults } from './history-options';
import { enqueueBackfillFeed, enqueueRefreshFeed, toRunOutcome } from './rss-run-service';
import { runWithStorageWriteRetry } from './sqlite-retry';

type AddSubscriptionInput = { url: string; title?: string | null; groupId?: string | null };
type UpdateSubscriptionInput = Parameters<typeof updateFeed>[1] & { id: string };

export async function addSubscription(input: AddSubscriptionInput) {
  try {
    const resolved = resolveFeedUrlFromInput(input.url);
    const refresh = await rssJobManager.enqueue({ kind: 'refresh_url', trigger: 'add_feed',
      refreshInput: { url: resolved.url, title: input.title ?? null, groupId: input.groupId ?? null,
        siteUrl: resolved.siteUrl ?? input.url } });
    const outcome = toRunOutcome(refresh);
    if (outcome.status !== 'completed') return { ok: false, error: outcome.failure.error };
    const firstPage = outcome.feeds[0];
    if (!firstPage?.ok) return { ok: false, error: firstPage?.error ?? 'NO_RESULT' };
    const feed = listFeeds().find((item) => item.url === resolved.url);
    if (feed) {
      void rssJobManager.enqueue({ kind: 'backfill_feed', trigger: 'scheduled', feedId: feed.id,
        options: withHistoryDepthDefaults({ since: extractXiaoyuzhouPodcastIdFromUrl(resolved.url) ? 0 : undefined }),
        metadata: { initialHistory: true },
      }).catch((error) => console.warn('[rss] initial history backfill failed', error));
    }
    return { ok: true, newEntries: firstPage.newEntries };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function updateSubscription(input: UpdateSubscriptionInput, onChanged: () => void) {
  const updated = await runWithStorageWriteRetry('updateFeed', () => updateFeed(input.id, input));
  if (!updated.ok) return updated;
  onChanged();
  if (!updated.urlChanged) return updated;
  try {
    const refresh = toRunOutcome(await enqueueRefreshFeed({ feedId: input.id }));
    if (refresh.status !== 'completed') return { ...updated, warning: refresh.failure.error };
    const history = toRunOutcome(await enqueueBackfillFeed({ feedId: input.id, options: withHistoryDepthDefaults() }));
    return history.status === 'completed' ? updated : { ...updated, warning: history.failure.error };
  } catch (error) { return { ...updated, warning: error instanceof Error ? error.message : String(error) }; }
}
