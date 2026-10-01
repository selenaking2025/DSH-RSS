/** Unknown wire data is normalized here; the reader only consumes these models. */
export type Tweet = {
  id: string;
  username: string;
  text: string | null;
  publishedAt: number | null;
  mediaUrls: string[];
  contentHtml: string | null;
};
export type TwitterUser = { id: string; username: string; name: string };
export type TweetPage = { tweets: Tweet[]; cursor: string | null };

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export const text = (value: unknown): string | null => typeof value === 'string' && value ? value : null;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const identifier = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value);

function userResult(payload: unknown) {
  const result = record(record(record(payload).data).user).result;
  return record(record(result).result ?? result);
}

export function parseTwitterUser(payload: unknown): TwitterUser {
  const result = userResult(payload);
  const legacy = record(result.legacy);
  const core = record(result.core);
  const id = identifier(result.rest_id ?? legacy.id_str);
  const username = text(core.screen_name ?? legacy.screen_name ?? result.screen_name);
  if (!id || !username) throw new Error('WEB_CLI_TWITTER_USER_NOT_FOUND');
  return { id, username, name: text(core.name ?? legacy.name ?? result.name) ?? username };
}

function instructionsAt(input: unknown) {
  const result = record(input);
  const timeline = record(result.timeline);
  const candidates = [
    result.instructions,
    record(record(result.timeline_v2).timeline).instructions,
    record(timeline.timeline).instructions,
    timeline.instructions,
    record(record(result.timeline_response).timeline).instructions,
    record(record(result.timelineResponse).timeline).instructions,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as unknown[];
  }
  return undefined;
}

function timelineEntries(payload: unknown) {
  const root = record(payload);
  const data = record(root.data);
  const targets = [userResult(payload), data.threaded_conversation_with_injections_v2,
    data.threaded_conversation_with_injections, data.threaded_conversation,
    root.threaded_conversation_with_injections_v2, root.threaded_conversation_with_injections, root.threaded_conversation, root];
  const candidates = targets.map(instructionsAt);
  const instructions = candidates.find((items) => items?.length) ?? candidates.find((items) => items !== undefined);
  if (!instructions) throw new Error('WEB_CLI_TWITTER_INVALID_TIMELINE');
  return instructions.flatMap((value) => {
    const instruction = record(value);
    if (instruction.type === 'TimelineAddEntries') return array(instruction.entries);
    return instruction.type === 'TimelinePinEntry' && instruction.entry ? [instruction.entry] : [];
  }).map(record);
}

function unwrapTweet(value: unknown) {
  let tweet = record(value);
  for (let depth = 0; depth < 8; depth++) {
    const next = tweet.tweet ?? tweet.result ?? record(tweet.tweet_results).result;
    if (next === undefined || next === null || typeof next !== 'object') break;
    tweet = record(next);
  }
  return tweet;
}

function parseTweet(value: unknown, fallbackUsername: string): Tweet | null {
  const tweet = unwrapTweet(value);
  const legacy = record(tweet.legacy);
  const id = identifier(tweet.rest_id ?? legacy.id_str);
  if (!id) return null;
  const userWire = record(record(tweet.core).user_results).result;
  const user = record(record(userWire).result ?? userWire);
  const username = text(record(user.core).screen_name ?? record(user.legacy).screen_name) ?? fallbackUsername;
  const note = record(record(tweet.note_tweet).note_tweet_results).result;
  const content = text(record(note).text ?? record(record(note).result).text ?? legacy.full_text ?? legacy.text);
  const published = text(legacy.created_at);
  const date = published ? Date.parse(published) : NaN;
  const media = array(record(legacy.extended_entities).media ?? record(legacy.entities).media);
  const mediaUrls = Array.from(new Set(media.map((item) => {
    const image = record(item);
    return text(image.media_url_https ?? image.media_url);
  }).filter((url): url is string => url !== null)));
  return {
    id, username,
    text: content?.replace(/\r\n/g, '\n').trim() || null,
    publishedAt: Number.isFinite(date) ? date : null,
    mediaUrls,
    contentHtml: null,
  };
}

function bottomCursor(input: unknown, entryId: unknown) {
  const content = record(input);
  const item = record(content.itemContent);
  const type = text(content.cursorType ?? item.cursorType)?.toLowerCase() ?? '';
  return type.includes('bottom') || (text(entryId)?.toLowerCase().includes('cursor-bottom'))
    ? text(content.value ?? item.value) : null;
}

export function parseTwitterTimeline(payload: unknown, fallbackUsername: string): TweetPage {
  const tweets: Tweet[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (const entry of timelineEntries(payload)) {
    const content = record(entry.content);
    cursor ??= bottomCursor(content, entry.entryId);
    const nested = array(content.items).map(record);
    for (const item of nested) {
      const inner = record(item.item);
      cursor ??= bottomCursor(inner.itemContent ?? item.itemContent ?? item.content, item.entryId ?? inner.entryId);
    }
    if (content.entryType !== 'TimelineTimelineItem' && content.entryType !== 'TimelineTimelineModule') continue;
    const direct = record(content.itemContent);
    const directResult = record(direct.tweet_results).result ?? record(direct.tweetResult).result;
    const candidates = directResult ? [directResult] : nested.map((item) => {
      const body = record(record(item.item).itemContent ?? item.itemContent);
      return record(body.tweet_results).result ?? record(body.tweetResult).result;
    });
    for (const value of candidates) {
      const tweet = parseTweet(value, fallbackUsername);
      if (!tweet || seen.has(tweet.id)) continue;
      seen.add(tweet.id);
      tweets.push(tweet);
    }
  }
  return { tweets, cursor };
}
