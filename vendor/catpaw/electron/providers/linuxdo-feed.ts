import { browserRequest } from '../browser/client';
import { fetchWithTimeout } from '../network/http';

function failure(status: number, body: string, challenge: string | null) {
  if (status === 429) return 'LINUXDO_RATE_LIMITED';
  if (challenge === 'challenge' || status === 401 || status === 403
    || (!/<rss[\s>]/i.test(body) && /cf-chl-|challenge-platform|just a moment|cloudflare|login-required/i.test(body))) {
    return 'LINUXDO_VERIFICATION_REQUIRED';
  }
  if (status !== 200 && status !== 304) return `LINUXDO_HTTP_${status}`;
  if (status === 200 && !/<rss[\s>]/i.test(body)) return 'LINUXDO_INVALID_FEED';
  return null;
}

/** HTTP stays the cheap path; a challenged request can reuse the user's site session. */
export async function fetchLinuxDoFeed(url: string, headers: Record<string, string>, timeout: number) {
  const response = await fetchWithTimeout(url, { headers }, timeout);
  const error = failure(response.status, await response.clone().text(), response.headers.get('cf-mitigated'));
  if (!error) return response;
  if (error !== 'LINUXDO_VERIFICATION_REQUIRED') throw new Error(error);
  const result = await browserRequest({ kind: 'linuxdo-feed', url, headers });
  if (!('body' in result)) throw new Error('BROWSER_INVALID_RESPONSE');
  const browserError = failure(result.status, result.body, result.headers['cf-mitigated'] ?? null);
  if (browserError) throw new Error(browserError);
  const fetched = new Response(result.status === 304 ? null : result.body, { status: result.status, headers: result.headers });
  Object.defineProperty(fetched, 'url', { value: url });
  return fetched;
}
