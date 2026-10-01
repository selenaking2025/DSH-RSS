import type { Tweet } from './parse';
export { buildXPostTitle as buildPostTitle } from '../../contracts/article-title';

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildTweetTextHtml(text: string | null) {
  if (!text) return '';
  return `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
}

function buildTweetMediaHtml(mediaUrls: string[]) {
  if (mediaUrls.length === 0) return '';
  return `
    <div class="catpaw-x-media">
      ${mediaUrls.map((url) => `<p><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></p>`).join('')}
    </div>
  `;
}

export function buildBasicTweetContentHtml(tweet: Pick<Tweet, 'text' | 'mediaUrls'>) {
  const textHtml = buildTweetTextHtml(tweet.text);
  const mediaHtml = buildTweetMediaHtml(tweet.mediaUrls);
  const combined = `${textHtml}${mediaHtml}`.trim();
  return combined || null;
}

function formatTweetTimestamp(timestamp: number | null) {
  if (!timestamp) return null;
  return new Date(timestamp).toISOString().replace('.000Z', ' UTC').replace('T', ' ');
}

function buildTweetCardHtml(tweet: Tweet, label: string | null) {
  const metaParts = [
    `<a href="https://x.com/${encodeURIComponent(tweet.username)}/status/${encodeURIComponent(tweet.id)}" target="_blank" rel="noreferrer">@${escapeHtml(tweet.username)}</a>`,
  ];
  const publishedLabel = formatTweetTimestamp(tweet.publishedAt);
  if (publishedLabel) {
    metaParts.push(escapeHtml(publishedLabel));
  }
  const contentHtml = buildBasicTweetContentHtml(tweet) ?? '<p>No captured content.</p>';
  return `
    <article class="catpaw-x-thread-card">
      ${label ? `<div class="catpaw-x-thread-label">${escapeHtml(label)}</div>` : ''}
      <div class="catpaw-x-thread-meta">${metaParts.join(' &middot; ')}</div>
      <div class="catpaw-x-thread-body">${contentHtml}</div>
    </article>
  `;
}

export function buildRichTweetContentHtml(mainTweet: Tweet, threadTweets: Tweet[]) {
  const cards = [buildTweetCardHtml(mainTweet, 'Post')];
  threadTweets.forEach((tweet, index) => {
    cards.push(buildTweetCardHtml(tweet, `Thread ${index + 1}`));
  });
  return `<div class="catpaw-x-thread" data-catpaw-x-thread="1">${cards.join('')}</div>`;
}

export function buildTweetDetailContentHtml(tweets: Tweet[], fallback: Tweet) {
  const focal = tweets.find((tweet) => tweet.id === fallback.id) ?? fallback;
  return buildRichTweetContentHtml(focal, tweets.filter((tweet) => tweet.id !== focal.id && tweet.username === focal.username));
}
