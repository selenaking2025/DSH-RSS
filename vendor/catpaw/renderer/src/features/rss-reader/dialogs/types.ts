import type { Feed, FeedGroup, GroupTreeNode } from '../types';
import type { PrimaryGroupName } from '../constants';
import type { RssResult } from '../../../../../electron/contracts/rss';
import type { TranslationPreferences } from '../translation/useTranslationPreferences';
import type { SummaryPreferences } from '../summary/useSummaryPreferences';
type RefreshSettings = RssResult<'getRefreshSettings'>;
export type OpmlPreviewState = { token: string; fileName: string; newGroupCount: number; reusedGroupCount: number; newFeedCount: number; existingFeedCount: number; duplicateFeedCount: number; invalidFeedCount: number };
export type FeedDiscoveryCandidate = { url: string; title: string | null; siteUrl: string | null; source: 'known-platform' | 'direct-feed' | 'html-alternate' };
type Common = { onClose: () => void; onChanged: () => Promise<void>; notify: (title: string, error?: unknown) => void };
type Groups = { groupOptions: Array<{ id: string | null; label: string }> };
type Categories = Groups & { aiNewsGroupId: string | null; primaryGroupIdByName: Map<PrimaryGroupName, string> };
type FeedDeletion = { onDelete: (id: string) => Promise<RssResult<'deleteFeed'> | null> };
export type DialogProps = {
  import: Common & Categories & { onImported: (ids: string[]) => Promise<unknown> };
  add: Common & Categories;
  'new-folder': Common & Groups & { parentId: string | null };
  'edit-group': Common & Groups & { group: GroupTreeNode; groups: FeedGroup[] };
  'edit-feed': Common & Groups & FeedDeletion & { feed: Feed; onHealth: (id: string) => void };
  health: Common & FeedDeletion & { feedId: string | null; feedById: Map<string, Feed>; onRefresh: (ids: string[]) => Promise<unknown> };
  refresh: Common & { settings: RefreshSettings; onHistoryYearChanged: (year: number) => void };
  maintenance: Common;
  'api-keys': Common;
  translation: Common & { translationPreferences: TranslationPreferences; onSaveTranslationPreferences: (preferences: TranslationPreferences) => void; onConfigureApiKeys: () => void };
  summary: Common & { summaryPreferences: SummaryPreferences; onSaveSummaryPreferences: (preferences: SummaryPreferences) => void; onConfigureApiKeys: () => void };
};
export type ReaderDialog = { kind: 'import' | 'add' | 'maintenance' | 'api-keys' | 'translation' | 'summary' }
  | { kind: 'new-folder'; parentId: string | null }
  | { kind: 'edit-group'; group: GroupTreeNode }
  | { kind: 'edit-feed'; feed: Feed }
  | { kind: 'health'; feedId: string | null }
  | { kind: 'refresh'; settings: RefreshSettings };
