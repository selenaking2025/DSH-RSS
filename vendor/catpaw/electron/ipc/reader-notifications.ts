import type { ReaderStateChange } from '../contracts/reader-events';
import { readerJobManager } from '../reader-job-manager';
import { rssJobManager } from '../rss-job-manager';
import { smartReading } from '../services/smart-reading';
import { notifyReaderStateChanged } from './register';

export function registerReaderNotifications() {
  let notification: ReturnType<typeof setTimeout> | null = null;
  const scopes = new Set<ReaderStateChange['scopes'][number]>();
  const changed = (next: ReaderStateChange['scopes']) => {
    for (const scope of next) scopes.add(scope);
    if (!notification) notification = setTimeout(() => {
      notification = null; notifyReaderStateChanged([...scopes]); scopes.clear();
    }, 150);
  };
  rssJobManager.subscribe(() => changed(['jobs']));
  readerJobManager.subscribe(() => changed(['jobs']));
  rssJobManager.subscribeDataChanges(() => { changed(['entries', 'subscriptions', 'counts']); smartReading.schedule(); });
  readerJobManager.subscribeDataChanges(() => { changed(['entries']); smartReading.schedule(); });
}
