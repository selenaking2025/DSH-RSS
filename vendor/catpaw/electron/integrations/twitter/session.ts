import { resolveWebCliCommand, resetWebCliCommandCache } from '../web-cli-command';
import { X_HOSTS } from '../../sources/twitter-metadata';
import { runCommand } from '../../services/run-command';
import { record, text, parseTwitterUser, parseTwitterTimeline, type TwitterUser, type Tweet, type TweetPage } from './parse';

const WEB_CLI_TIMEOUT_MS = 40_000;
const WEB_CLI_TRANSIENT_RETRY_COUNT = 2;
const WEB_CLI_TRANSIENT_RETRY_DELAY_MS = 1_500;
const WEB_CLI_NAVIGATION_WAIT_MS = 15_000;
const WEB_CLI_NAVIGATION_POLL_MS = 500;
const WEB_CLI_TEMPLATE_FALLBACK_HANDLES = ['openai', 'anthropicai', 'newsfromgoogle', 'karpathy'];

type WebCliTab = {
  id?: number | null;
  url?: string | null;
  title?: string | null;
  active?: boolean | null;
  windowId?: number | null;
  status?: string | null;
  lastAccessed?: number | null;
  discarded?: boolean | null;
  frozen?: boolean | null;
};

type WebCliTraceRequest = {
  url?: string;
  status?: number | null;
  timestamp?: number | null;
};

type WebCliPageState = {
  href?: string | null;
  readyState?: string | null;
};

type GraphqlUrlTemplate = {
  path: string;
  staticParams: Array<[string, string]>;
  variables: Record<string, unknown>;
};

type LearnedTwitterApiTemplates = {
  userByScreenName: GraphqlUrlTemplate;
  userTweets: GraphqlUrlTemplate;
  tweetDetail: GraphqlUrlTemplate | null;
};


function readTabs(value: unknown): WebCliTab[] {
  if (!Array.isArray(value)) throw new Error('WEB_CLI_BAD_TABS');
  return value.map((item) => {
    const tab = record(item);
    return { id: typeof tab.id === 'number' ? tab.id : null, url: text(tab.url),
      active: tab.active === true, discarded: tab.discarded === true, frozen: tab.frozen === true,
      status: text(tab.status), lastAccessed: typeof tab.lastAccessed === 'number' ? tab.lastAccessed : null };
  });
}
function readPage(value: unknown): WebCliPageState {
  const page = record(value);
  return { href: text(page.href), readyState: text(page.readyState) };
}
function readTrace(value: unknown): WebCliTraceRequest[] {
  if (!Array.isArray(value)) throw new Error('WEB_CLI_BAD_TRACE');
  return value.flatMap((item) => {
    const url = text(record(item).url); return url ? [{ url }] : [];
  });
}

let cachedTwitterApiTemplates: LearnedTwitterApiTemplates | null = null;
let webCliMutex: Promise<void> = Promise.resolve();

export function resetWebCliTwitterStateForTests() {
  resetWebCliCommandCache();
  cachedTwitterApiTemplates = null;
  webCliMutex = Promise.resolve();
}

function withWebCliLock<T>(work: () => Promise<T>) {
  const next = webCliMutex.then(work, work);
  webCliMutex = next.then(() => undefined, () => undefined);
  return next;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resetTransientWebCliState() {
  cachedTwitterApiTemplates = null;
}

function matchesWebCliErrorCode(message: string, code: string) {
  return message === code || message.startsWith(`${code}:`);
}

function createWebCliStateError(code: string, message: string) {
  return new Error(`${code}: ${message}`);
}

function isWebCliDaemonBootstrapMessage(message: string) {
  return /Daemon not running/i.test(message)
    || /CLI token not found/i.test(message);
}

function isTransientWebCliError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return matchesWebCliErrorCode(message, 'WEB_CLI_EXTENSION_NOT_CONNECTED')
    || matchesWebCliErrorCode(message, 'WEB_CLI_DAEMON_NOT_RUNNING')
    || /Extension disconnected/i.test(message)
    || /extension_unavailable/i.test(message)
    || /No tab with given id/i.test(message)
    || /getView is not a function/i.test(message)
    || /(?:^|\b)timeout(?:\b|$)/i.test(message)
    || /timed out/i.test(message);
}

async function runWithTransientWebCliRetry<T>(work: () => Promise<T>) {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= WEB_CLI_TRANSIENT_RETRY_COUNT) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (attempt >= WEB_CLI_TRANSIENT_RETRY_COUNT || !isTransientWebCliError(error)) {
        throw error;
      }
      attempt += 1;
      resetTransientWebCliState();
      await sleep(WEB_CLI_TRANSIENT_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runWebCliCommand(args: string[], timeoutMs = WEB_CLI_TIMEOUT_MS) {
  const resolved = await resolveWebCliCommand();
  if (!resolved) {
    throw new Error('WEB_CLI_BIN_NOT_FOUND');
  }

  return runCommand(resolved.command, [...resolved.argsPrefix, ...args], timeoutMs);
}

async function runWebCliJson(args: string[], timeoutMs = WEB_CLI_TIMEOUT_MS) {
  const { stdout } = await runWebCliCommand(args, timeoutMs);
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new Error(`WEB_CLI_BAD_JSON: ${stdout.trim().slice(0, 300)}`);
  }
}

async function ensureWebCliReady() {
  let status: Record<string, unknown> | null = null;

  try {
    status = record(await runWebCliJson(['status']));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isWebCliDaemonBootstrapMessage(message)) {
      await runWebCliCommand(['daemon', '--background'], 15_000);
      status = record(await runWebCliJson(['status']));
    } else {
      throw error;
    }
  }

  if (status.running !== true) {
    throw createWebCliStateError(
      'WEB_CLI_DAEMON_NOT_RUNNING',
      'Start the local web-cli daemon with "web-cli daemon --background".',
    );
  }
  if (status.extensionPaired !== true) {
    throw createWebCliStateError(
      'WEB_CLI_EXTENSION_UNPAIRED',
      'Pair the Chrome extension with "web-cli extension pair", then open the printed auto-pair URL (or finish pairing in the extension options page).',
    );
  }
  if (status.extensionConnected !== true) {
    throw createWebCliStateError(
      'WEB_CLI_EXTENSION_NOT_CONNECTED',
      'The paired web-cli extension is not connected. Reload the extension, keep Chrome open, and try again.',
    );
  }
}

function buildWebCliTabArgs(tabId: number) {
  return ['-t', String(tabId)];
}

function normalizeComparableUrl(input: string) {
  try {
    const parsed = new URL(input);
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${pathname}`;
  } catch {
    return input.replace(/\/+$/, '') || input;
  }
}

function matchesExpectedNavigationUrl(actualUrl: string | null | undefined, expectedUrl: string) {
  if (!actualUrl) return false;
  return normalizeComparableUrl(actualUrl) === normalizeComparableUrl(expectedUrl);
}

function compareWebCliBooleans(a: boolean, b: boolean) {
  return Number(a) - Number(b);
}

function compareWebCliNumbers(a: number, b: number) {
  return a - b;
}

function compareWebCliTabsForSelection(a: WebCliTab, b: WebCliTab) {
  return (
    compareWebCliBooleans(Boolean(b.active), Boolean(a.active))
    || compareWebCliBooleans(Boolean(a.discarded), Boolean(b.discarded))
    || compareWebCliBooleans(Boolean(a.frozen), Boolean(b.frozen))
    || compareWebCliBooleans(String(b.status ?? '') === 'complete', String(a.status ?? '') === 'complete')
    || compareWebCliNumbers(Number(b.lastAccessed ?? 0), Number(a.lastAccessed ?? 0))
    || compareWebCliNumbers(Number(b.id ?? 0), Number(a.id ?? 0))
  );
}

function isWebCliXTab(tab: WebCliTab) {
  try {
    const host = new URL(tab.url ?? '').hostname.replace(/^www\./, '').toLowerCase();
    return X_HOSTS.has(host);
  } catch {
    return false;
  }
}

async function selectPinnedWebCliTwitterTab() {
  const tabs = readTabs(await runWebCliJson(['tabs', '--json']));
  const candidates = tabs
    .filter((tab) => typeof tab?.id === 'number' && isWebCliXTab(tab))
    .sort(compareWebCliTabsForSelection);
  const selected = candidates[0];
  if (!selected || typeof selected.id !== 'number') {
    throw new Error('WEB_CLI_TWITTER_TAB_NOT_FOUND');
  }
  return selected.id;
}

async function waitForWebCliNavigation(tabId: number, expectedUrl: string) {
  const deadline = Date.now() + WEB_CLI_NAVIGATION_WAIT_MS;

  while (Date.now() < deadline) {
    const pageState = readPage(await runWebCliJson(
      ['eval', '(() => ({ href: location.href, readyState: document.readyState }))()', ...buildWebCliTabArgs(tabId)],
      15_000,
    ));
    const readyState = typeof pageState?.readyState === 'string' ? pageState.readyState.toLowerCase() : null;
    if (matchesExpectedNavigationUrl(pageState?.href, expectedUrl) && readyState !== 'loading') {
      return;
    }
    await sleep(WEB_CLI_NAVIGATION_POLL_MS);
  }

  throw new Error(`WEB_CLI_TWITTER_NAVIGATION_TIMEOUT: ${expectedUrl}`);
}

async function navigateTabToProfile(tabId: number, handle: string) {
  const profileUrl = `https://x.com/${handle}`;
  await runWebCliJson(['eval', `(() => { location.href = ${JSON.stringify(profileUrl)}; return "ok"; })()`, ...buildWebCliTabArgs(tabId)]);
  await waitForWebCliNavigation(tabId, profileUrl);
}

async function navigateTabToTweet(tabId: number, handle: string, tweetId: string) {
  const tweetUrl = `https://x.com/${handle}/status/${tweetId}`;
  await runWebCliJson(['eval', `(() => { location.href = ${JSON.stringify(tweetUrl)}; return "ok"; })()`, ...buildWebCliTabArgs(tabId)]);
  await waitForWebCliNavigation(tabId, tweetUrl);
}

function extractGraphqlTemplate(url: string) {
  const parsed = new URL(url);
  const variablesJson = parsed.searchParams.get('variables');
  const variables = variablesJson ? record(JSON.parse(variablesJson)) : {};
  const staticParams: Array<[string, string]> = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (key === 'variables') continue;
    staticParams.push([key, value]);
  }
  return {
    path: parsed.pathname,
    staticParams,
    variables,
  } satisfies GraphqlUrlTemplate;
}

function buildGraphqlUrl(template: GraphqlUrlTemplate, variableOverrides: Record<string, unknown>) {
  const params = new URLSearchParams();
  const mergedVariables = {
    ...template.variables,
    ...variableOverrides,
  };
  params.set('variables', JSON.stringify(mergedVariables));
  for (const [key, value] of template.staticParams) {
    params.set(key, value);
  }
  return `https://x.com${template.path}?${params.toString()}`;
}

function findLatestMatchingTraceRequest(requests: WebCliTraceRequest[], matcher: (url: string) => boolean) {
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const url = requests[index]?.url;
    if (typeof url === 'string' && matcher(url)) {
      return url;
    }
  }
  return null;
}

async function learnTwitterApiTemplates(handle: string, tabId: number) {
  if (cachedTwitterApiTemplates) {
    return cachedTwitterApiTemplates;
  }

  const handlesToTry = Array.from(new Set([handle, ...WEB_CLI_TEMPLATE_FALLBACK_HANDLES]));
  let userByScreenNameUrl: string | null = null;
  let userTweetsUrl: string | null = null;

  for (const candidateHandle of handlesToTry) {
    await navigateTabToProfile(tabId, candidateHandle);
    const requests = readTrace(await runWebCliJson(
      ['trace', 'https://x.com/i/api/graphql/', ...buildWebCliTabArgs(tabId), '--duration', '12000'],
      45_000,
    ));

    userByScreenNameUrl ||= findLatestMatchingTraceRequest(
      requests,
      (url) => url.includes('/UserByScreenName'),
    );
    userTweetsUrl ||= findLatestMatchingTraceRequest(
      requests,
      (url) => /\/UserTweets(?:\?|$)/.test(url),
    );

    if (userByScreenNameUrl && userTweetsUrl) {
      break;
    }
  }

  if (!userByScreenNameUrl || !userTweetsUrl) {
    throw new Error('WEB_CLI_TWITTER_TRACE_DID_NOT_FIND_REQUIRED_REQUESTS');
  }

  cachedTwitterApiTemplates = {
    userByScreenName: extractGraphqlTemplate(userByScreenNameUrl),
    userTweets: extractGraphqlTemplate(userTweetsUrl),
    tweetDetail: null,
  };
  return cachedTwitterApiTemplates;
}

async function learnTweetDetailTemplate(handle: string, tweetId: string, tabId: number) {
  if (cachedTwitterApiTemplates?.tweetDetail) {
    return cachedTwitterApiTemplates.tweetDetail;
  }

  await navigateTabToTweet(tabId, handle, tweetId);
  const requests = readTrace(await runWebCliJson(
    ['trace', 'https://x.com/i/api/graphql/', ...buildWebCliTabArgs(tabId), '--duration', '12000'],
    45_000,
  ));

  const tweetDetailUrl = findLatestMatchingTraceRequest(
    requests,
    (url) => /\/TweetDetail(?:\?|$)/.test(url),
  );
  if (!tweetDetailUrl) {
    throw new Error('WEB_CLI_TWITTER_TRACE_DID_NOT_FIND_TWEET_DETAIL');
  }

  const template = extractGraphqlTemplate(tweetDetailUrl);
  if (cachedTwitterApiTemplates) {
    cachedTwitterApiTemplates = {
      ...cachedTwitterApiTemplates,
      tweetDetail: template,
    };
  }
  return template;
}

async function fetchJsonViaWebCli(url: string, tabId: number) {
  const result = record(await runWebCliJson(
    ['fetch', url, ...buildWebCliTabArgs(tabId)],
    45_000,
  ));

  if (typeof result.error === 'string') {
    throw new Error(result.error);
  }

  if ((typeof result.status === 'number' ? result.status : 200) >= 400) {
    const body = typeof result.body === 'string'
      ? result.body
      : JSON.stringify(result.body ?? null);
    throw new Error(`WEB_CLI_HTTP_${result.status}: ${body.slice(0, 300)}`);
  }

  return result.body;
}


function buildTweetDetailVariableOverrides(template: GraphqlUrlTemplate, tweetId: string) {
  const overrides: Record<string, unknown> = {};
  let matched = false;

  for (const [key, value] of Object.entries(template.variables)) {
    if (!/tweetid/i.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      overrides[key] = tweetId;
      matched = true;
    }
  }

  if (!matched) {
    overrides.focalTweetId = tweetId;
  }

  return overrides;
}


export type TwitterSession = {
  user: TwitterUser;
  timeline: (options: { count: number; cursor?: string | null }) => Promise<TweetPage>;
  detail: (tweetId: string) => Promise<Tweet[]>;
};

export function withTwitterSession<T>(handle: string, work: (session: TwitterSession) => Promise<T>) {
  return withWebCliLock(() => runWithTransientWebCliRetry(async () => {
    await ensureWebCliReady();
    const tabId = await selectPinnedWebCliTwitterTab();
    const templates = await learnTwitterApiTemplates(handle, tabId);
    const user = parseTwitterUser(await fetchJsonViaWebCli(buildGraphqlUrl(templates.userByScreenName,
      { screen_name: handle }), tabId));
    let detailTemplate: Promise<GraphqlUrlTemplate> | null = null;
    return work({ user,
      timeline: async ({ count, cursor }) => parseTwitterTimeline(await fetchJsonViaWebCli(
        buildGraphqlUrl(templates.userTweets, { userId: user.id, count, includePromotedContent: false,
          ...(cursor ? { cursor } : {}) }), tabId), user.username),
      detail: async (tweetId) => {
        const template = await (detailTemplate ??= learnTweetDetailTemplate(handle, tweetId, tabId));
        return parseTwitterTimeline(await fetchJsonViaWebCli(buildGraphqlUrl(template,
          buildTweetDetailVariableOverrides(template, tweetId)), tabId), user.username).tweets;
      },
    });
  }));
}
