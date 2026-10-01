import type { ReadingItem } from './smart-reading';

export function estimateReadingMinutes(text: string, mediaType?: string | null, mediaUrl?: string | null): number | null {
  if (hasReadingPlayback(mediaType, mediaUrl)) return null;
  if (!text.trim()) return null;
  const chinese = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const words = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length;
  return Math.max(1, Math.ceil(chinese / 350 + words / 220));
}
export function hasReadingPlayback(mediaType?: string | null, mediaUrl?: string | null) {
  return Boolean((mediaUrl && !mediaType) || (mediaType && /audio|video|podcast/i.test(mediaType)));
}

/** Choose whole articles, preserving the caller's relevance order and explicit pins. */
export function arrangeReadingBudget(items: ReadingItem[], minutes: number | null, pinned: string[] = [], skipped: string[] = []) {
  const omitted = new Set(skipped), pins = new Set(pinned), seenEvents = new Set<string>();
  const ordered = [...items.filter((item) => pins.has(item.entry.id)), ...items.filter((item) => !pins.has(item.entry.id))];
  const selected: ReadingItem[] = []; let used = 0;
  for (const item of ordered) {
    if (omitted.has(item.entry.id)) continue;
    const eventIds = [item.entry.id, ...item.relatedIds];
    if (eventIds.some((id) => seenEvents.has(id)) && !pins.has(item.entry.id)) continue;
    if (minutes !== null && (item.minutes === null || used + item.minutes > minutes)) continue;
    selected.push(item); used += item.minutes ?? 0;
    for (const id of eventIds) seenEvents.add(id);
  }
  return { items: selected, minutes: used, excludedPins: pinned.filter((id) => !selected.some((item) => item.entry.id === id)) };
}
