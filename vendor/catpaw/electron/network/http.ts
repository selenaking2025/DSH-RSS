import { acquireNetworkSlot } from './request-slots';
import type { BackgroundJobPriority } from '../contracts/background-jobs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

const MAX_PROXY_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const FEED_FETCH_USER_AGENT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
let cachedHttpProxyAgent: { proxyUrl: string; agent: HttpProxyAgent<string> } | null = null;
let cachedHttpsProxyAgent: { proxyUrl: string; agent: HttpsProxyAgent<string> } | null = null;
type BufferedSocketReader = {
  dispose: () => void;
  readExactly: (size: number) => Promise<Buffer<ArrayBufferLike>>;
};

type RequestBudget = { deadlineAt?: number; shouldStop?: () => boolean; perHostConcurrency?: number; priority?: BackgroundJobPriority };
const budgets = new AsyncLocalStorage<RequestBudget>();
export function currentRequestBudget() { return budgets.getStore(); }

export function withRequestBudget<T>(budget: RequestBudget, task: () => T): T {
  const parent = budgets.getStore();
  return budgets.run({
    perHostConcurrency: budget.perHostConcurrency ?? parent?.perHostConcurrency,
    priority: budget.priority ?? parent?.priority,
    deadlineAt: Math.min(budget.deadlineAt ?? Infinity, parent?.deadlineAt ?? Infinity),
    shouldStop: () => Boolean(budget.shouldStop?.() || parent?.shouldStop?.()),
  }, task);
}

type BoundedRequestInit = RequestInit & { maxBytes?: number };
function parseNoProxyRules() {
  const raw = process.env.NO_PROXY || process.env.no_proxy || '';
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function shouldBypassProxy(url: string) {
  const rules = parseNoProxyRules();
  if (rules.length === 0) return false;
  let hostname = '';
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return false;
  }

  for (const rule of rules) {
    if (rule === '*') return true;
    const normalizedRule = rule.replace(/^www\./, '');
    if (hostname === normalizedRule) return true;
    if (normalizedRule.startsWith('.')) {
      const suffix = normalizedRule.slice(1);
      if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return true;
      continue;
    }
    if (hostname.endsWith(`.${normalizedRule}`)) return true;
  }
  return false;
}

function getProxyUrlForRequest(url: string) {
  const value = (
    process.env.CATPAW_HTTP_PROXY
    || process.env.HTTPS_PROXY
    || process.env.https_proxy
    || process.env.HTTP_PROXY
    || process.env.http_proxy
    || process.env.ALL_PROXY
    || process.env.all_proxy
    || ''
  ).trim();
  if (!value) return null;
  if (shouldBypassProxy(url)) return null;
  return value;
}

function getProxyAgent(url: string) {
  const proxyUrl = getProxyUrlForRequest(url);
  if (!proxyUrl) return null;
  const proxyProtocol = new URL(proxyUrl).protocol.toLowerCase();
  if (proxyProtocol.startsWith('socks')) {
    return null;
  }
  const protocol = new URL(url).protocol;
  if (protocol === 'http:') {
    if (!cachedHttpProxyAgent || cachedHttpProxyAgent.proxyUrl !== proxyUrl) {
      cachedHttpProxyAgent = {
        proxyUrl,
        agent: new HttpProxyAgent(proxyUrl),
      };
    }
    return cachedHttpProxyAgent.agent;
  }
  if (!cachedHttpsProxyAgent || cachedHttpsProxyAgent.proxyUrl !== proxyUrl) {
    cachedHttpsProxyAgent = {
      proxyUrl,
      agent: new HttpsProxyAgent(proxyUrl),
    };
  }
  return cachedHttpsProxyAgent.agent;
}

function isSocks5ProxyUrl(url: string) {
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return protocol === 'socks:' || protocol === 'socks5:' || protocol === 'socks5h:';
  } catch {
    return false;
  }
}

function createAbortError() {
  const abortError = new Error('The operation was aborted');
  (abortError as Error & { name: string }).name = 'AbortError';
  return abortError;
}

function createBufferedSocketReader(socket: net.Socket | tls.TLSSocket, signal: AbortSignal): BufferedSocketReader {
  let failure: Error | undefined;
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const waiters: Array<{
    size: number;
    resolve: (value: Buffer<ArrayBufferLike>) => void;
    reject: (error: Error) => void;
  }> = [];

  const flush = () => {
    while (waiters.length > 0 && buffer.length >= waiters[0]!.size) {
      const waiter = waiters.shift()!;
      const chunk = buffer.subarray(0, waiter.size);
      buffer = buffer.subarray(waiter.size);
      waiter.resolve(chunk);
    }
  };

  const rejectPending = (error: Error) => {
    failure ??= error;
    while (waiters.length > 0) {
      waiters.shift()!.reject(error);
    }
  };

  const handleData = (chunk: Buffer) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    flush();
  };
  const handleError = (error: Error) => {
    rejectPending(error);
  };
  const handleClose = () => {
    rejectPending(new Error('Socket closed before proxy handshake completed'));
  };

  const handleAbort = () => rejectPending(createAbortError());
  signal.addEventListener('abort', handleAbort, { once: true });
  if (signal.aborted) handleAbort();
  socket.on('data', handleData);
  socket.on('error', handleError);
  socket.on('close', handleClose);

  return {
    dispose() {
      signal.removeEventListener('abort', handleAbort);
      rejectPending(new Error('Proxy handshake reader disposed'));
      socket.off('data', handleData);
      socket.off('error', handleError);
      socket.off('close', handleClose);
    },
    async readExactly(size: number) {
      if (failure) throw failure;
      if (buffer.length >= size) {
        const chunk = buffer.subarray(0, size);
        buffer = buffer.subarray(size);
        return chunk;
      }

      return await new Promise<Buffer>((resolve, reject) => {
        waiters.push({ size, resolve, reject });
      });
    },
  };
}

function buildSocks5TargetAddress(hostname: string) {
  if (net.isIPv4(hostname)) {
    return Buffer.from([0x01, ...hostname.split('.').map((part) => Number(part))]);
  }
  const encoded = Buffer.from(hostname, 'utf8');
  return Buffer.concat([Buffer.from([0x03, encoded.length]), encoded]);
}

function socks5ReplyMessage(code: number) {
  switch (code) {
    case 0x01:
      return 'SOCKS proxy reported a general failure';
    case 0x02:
      return 'SOCKS proxy denied the connection';
    case 0x03:
      return 'SOCKS proxy reported a network issue';
    case 0x04:
      return 'SOCKS proxy reported the target host is unreachable';
    case 0x05:
      return 'SOCKS proxy reported the target connection was refused';
    case 0x06:
      return 'SOCKS proxy reported the connection TTL expired';
    case 0x07:
      return 'SOCKS proxy does not support this command';
    case 0x08:
      return 'SOCKS proxy does not support this address type';
    default:
      return `SOCKS proxy failed with code ${code}`;
  }
}

function destroySocket(socket: net.Socket) {
  if (socket.closed) return Promise.resolve();
  return new Promise<void>((resolve) => { socket.once('close', resolve); socket.destroy(); });
}

async function waitForSocketConnect(socket: net.Socket, signal: AbortSignal, event = 'connect') {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off(event, handleConnect);
      socket.off('error', handleError);
      socket.off('close', handleClose);
      signal.removeEventListener('abort', handleAbort);
    };
    const handleConnect = () => { cleanup(); resolve(); };
    const handleError = (error: Error) => { cleanup(); reject(error); };
    const handleClose = () => handleError(signal.aborted ? createAbortError() : new Error('Socket closed during connection'));
    const handleAbort = () => handleError(createAbortError());
    socket.once(event, handleConnect);
    socket.once('error', handleError);
    socket.once('close', handleClose);
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}

async function connectViaSocks5Proxy(url: string, proxyUrl: string, signal: AbortSignal) {
  if (signal.aborted) throw createAbortError();
  const target = new URL(url);
  const proxy = new URL(proxyUrl);
  const proxyPort = proxy.port ? Number.parseInt(proxy.port, 10) : 1080;
  const socket = net.connect({
    host: proxy.hostname,
    port: proxyPort,
  });
  // The creator owns cancellation until the raw/TLS connection actually closes,
  // including the interval before the caller has received the socket.
  const owned = new Set<net.Socket>();
  const ignoreError = () => {};
  const own = (connection: net.Socket) => {
    owned.add(connection);
    connection.on('error', ignoreError);
    connection.once('close', () => {
      connection.off('error', ignoreError);
      owned.delete(connection);
      if (!owned.size) signal.removeEventListener('abort', abort);
    });
  };
  const abort = () => { for (const connection of owned) connection.destroy(); };
  own(socket);
  signal.addEventListener('abort', abort, { once: true });
  let reader: BufferedSocketReader | undefined;
  try {
    await waitForSocketConnect(socket, signal);
    reader = createBufferedSocketReader(socket, signal);
    const username = decodeURIComponent(proxy.username || '');
    const password = decodeURIComponent(proxy.password || '');
    const supportsAuth = username.length > 0 || password.length > 0;
    const methods = supportsAuth ? Buffer.from([0x00, 0x02]) : Buffer.from([0x00]);
    socket.write(Buffer.concat([Buffer.from([0x05, methods.length]), methods]));

    const authSelection = await reader.readExactly(2);
    if (authSelection[0] !== 0x05 || authSelection[1] === 0xFF) {
      throw new Error('SOCKS proxy did not accept any supported authentication method');
    }

    if (authSelection[1] === 0x02) {
      const usernameBuffer = Buffer.from(username, 'utf8');
      const passwordBuffer = Buffer.from(password, 'utf8');
      if (usernameBuffer.length > 255 || passwordBuffer.length > 255) {
        throw new Error('SOCKS proxy credentials are too long');
      }
      socket.write(Buffer.concat([
        Buffer.from([0x01, usernameBuffer.length]),
        usernameBuffer,
        Buffer.from([passwordBuffer.length]),
        passwordBuffer,
      ]));
      const authResult = await reader.readExactly(2);
      if (authResult[1] !== 0x00) {
        throw new Error('SOCKS proxy authentication failed');
      }
    }

    const targetPort = target.port
      ? Number.parseInt(target.port, 10)
      : target.protocol === 'https:' ? 443 : 80;
    const targetAddress = buildSocks5TargetAddress(target.hostname);
    socket.write(Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00]),
      targetAddress,
      Buffer.from([(targetPort >> 8) & 0xFF, targetPort & 0xFF]),
    ]));

    const connectHeader = await reader.readExactly(4);
    if (connectHeader[0] !== 0x05) {
      throw new Error('SOCKS proxy returned an unsupported response version');
    }
    if (connectHeader[1] !== 0x00) {
      throw new Error(socks5ReplyMessage(connectHeader[1]));
    }

    if (connectHeader[3] === 0x01) {
      await reader.readExactly(6);
    } else if (connectHeader[3] === 0x04) {
      await reader.readExactly(18);
    } else if (connectHeader[3] === 0x03) {
      const hostLength = (await reader.readExactly(1))[0] ?? 0;
      await reader.readExactly(hostLength + 2);
    } else {
      throw new Error('SOCKS proxy returned an unsupported address type');
    }
    reader.dispose();
    if (target.protocol === 'https:') {
      const secureSocket = tls.connect({
        socket,
        servername: net.isIP(target.hostname) ? undefined : target.hostname,
        rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
      });
      own(secureSocket);
      await waitForSocketConnect(secureSocket, signal, 'secureConnect');
      return secureSocket;
    }
    return socket;
  } catch (error) {
    await Promise.all([...owned].map(destroySocket));
    throw error;
  } finally {
    reader?.dispose();
  }
}

function toNodeHeaders(headers: Headers) {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    result[key] = value;
  }
  return result;
}

function toFetchHeaders(headers: http.IncomingHttpHeaders) {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'undefined') continue;
    if (Array.isArray(value)) {
      result.set(key, value.join(', '));
      continue;
    }
    result.set(key, value);
  }
  return result;
}

const NULL_BODY_RESPONSE_STATUSES = new Set([101, 204, 205, 304]);

function createNodeFetchResponse(
  statusCode: number,
  statusText: string,
  headers: http.IncomingHttpHeaders,
  chunks: Buffer[],
) {
  return new Response(NULL_BODY_RESPONSE_STATUSES.has(statusCode) ? null : Buffer.concat(chunks), {
    status: statusCode,
    statusText,
    headers: toFetchHeaders(headers),
  });
}

function redirectInit(from: string, to: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  // Validators belong to one resource, including across same-origin redirects.
  headers.delete('if-none-match');
  headers.delete('if-modified-since');
  if (new URL(from).origin !== new URL(to).origin) { headers.delete('authorization'); headers.delete('cookie'); }
  return { ...init, headers };
}

async function fetchViaProxyRequest(
  url: string,
  init: RequestInit | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('UNSUPPORTED_URL_PROTOCOL');
  const requestHeaders = new Headers(init?.headers ?? undefined);
  const requestModule = parsed.protocol === 'http:' ? http : https;
  const proxyUrl = getProxyUrlForRequest(url);
  if (proxyUrl && isSocks5ProxyUrl(proxyUrl)) {
    const socket = await connectViaSocks5Proxy(url, proxyUrl, signal);
    try {
      return await new Promise<Response>((resolve, reject) => {
        const abortHandler = () => {
          const abortError = createAbortError();
          socket.destroy();
          reject(abortError);
        };

        if (signal.aborted) {
          abortHandler();
          return;
        }

        signal.addEventListener('abort', abortHandler, { once: true });
        try {
          const request = requestModule.request(
            {
              protocol: parsed.protocol,
              hostname: parsed.hostname,
              port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
              method: init?.method ?? 'GET',
              path: `${parsed.pathname}${parsed.search}`,
              headers: toNodeHeaders(requestHeaders),
              createConnection: () => socket!,
            },
            (response) => {
              const statusCode = response.statusCode ?? 0;
              if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location && init?.redirect !== 'manual') {
                response.once('close', () => {
                  signal.removeEventListener('abort', abortHandler);
                  resolve(createNodeFetchResponse(statusCode, response.statusMessage ?? '', response.headers, []));
                });
                response.destroy();
                return;
              }
              const chunks: Buffer[] = [];
              let receivedBytes = 0;
              response.on('data', (chunk) => {
                receivedBytes += Buffer.byteLength(chunk);
                if (receivedBytes > ((init as BoundedRequestInit)?.maxBytes ?? MAX_RESPONSE_BYTES)) {
                  response.destroy(new Error('RESPONSE_TOO_LARGE'));
                  return;
                }
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              });
              response.on('error', (error) => {
                signal.removeEventListener('abort', abortHandler);
                reject(error instanceof Error ? error : new Error(String(error)));
              });
              response.on('end', () => {
                signal.removeEventListener('abort', abortHandler);
                resolve(
                  createNodeFetchResponse(
                    statusCode,
                    response.statusMessage ?? '',
                    response.headers,
                    chunks,
                  ),
                );
              });
            },
          );

          request.on('error', (error) => {
            signal.removeEventListener('abort', abortHandler);
            reject(error instanceof Error ? error : new Error(String(error)));
          });

          if (init?.body && typeof init.body === 'string') {
            request.write(init.body);
          } else if (init?.body instanceof Uint8Array) {
            request.write(init.body);
          }

          request.end();
        } catch (error) {
          signal.removeEventListener('abort', abortHandler);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } finally { await destroySocket(socket); }
  }

  const agent = getProxyAgent(url);
  if (!agent) {
    const response = await fetch(url, { ...init, headers: requestHeaders, signal, redirect: 'manual' });
    return response;
  }

  return await new Promise<Response>((resolve, reject) => {
    // Every exit from this promise has to drop the abort listener, otherwise each
    // redirect hop leaves one attached to the shared signal for the request's life.
    let detachAbortHandler = () => {};
    const settle = <T>(handler: (value: T) => void) => (value: T) => {
      detachAbortHandler();
      handler(value);
    };
    const resolveOnce = settle(resolve);
    const rejectOnce = settle(reject);

    const request = requestModule.request(
      parsed,
      {
        method: init?.method ?? 'GET',
        headers: toNodeHeaders(requestHeaders),
        agent,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location && init?.redirect !== 'manual') {
          response.once('close', () => resolveOnce(createNodeFetchResponse(statusCode, response.statusMessage ?? '', response.headers, [])));
          response.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on('data', (chunk) => {
          receivedBytes += Buffer.byteLength(chunk);
          if (receivedBytes > ((init as BoundedRequestInit)?.maxBytes ?? MAX_RESPONSE_BYTES)) {
            response.destroy(new Error('RESPONSE_TOO_LARGE'));
            return;
          }
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('error', (error) => {
          rejectOnce(error instanceof Error ? error : new Error(String(error)));
        });
        response.on('end', () => {
          resolveOnce(
            createNodeFetchResponse(
              statusCode,
              response.statusMessage ?? '',
              response.headers,
              chunks,
            ),
          );
        });
      },
    );

    const abortHandler = () => {
      const abortError = createAbortError();
      request.destroy(abortError);
      rejectOnce(abortError);
    };

    if (signal.aborted) {
      abortHandler();
      return;
    }

    signal.addEventListener('abort', abortHandler, { once: true });
    detachAbortHandler = () => signal.removeEventListener('abort', abortHandler);
    request.on('error', (error) => {
      rejectOnce(error instanceof Error ? error : new Error(String(error)));
    });

    if (init?.body && typeof init.body === 'string') {
      request.write(init.body);
    } else if (init?.body instanceof Uint8Array) {
      request.write(init.body);
    }

    request.end();
  });
}


/** The deadline covers connection, redirects and the entire decoded response body. */
export async function fetchWithTimeout(url: string, init?: BoundedRequestInit, timeoutMs = 20_000): Promise<Response> {
  const scope = budgets.getStore();
  const remainingMs = Math.min(timeoutMs, (scope?.deadlineAt ?? Infinity) - Date.now());
  if (remainingMs <= 0) throw Object.assign(new Error('REQUEST_BUDGET_EXHAUSTED'), { name: 'AbortError' });
  const controller = new AbortController();
  const headers = new Headers(init?.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', FEED_FETCH_USER_AGENT);
  if (!headers.has('accept')) headers.set('accept', '*/*');
  const timeoutError = Object.assign(new Error(`Request timed out after ${remainingMs}ms`), { name: 'AbortError' });
  const cancelError = Object.assign(new Error('REQUEST_CANCELLED'), { name: 'AbortError' });
  const onExternalAbort = () => controller.abort(init?.signal?.reason ?? cancelError);
  init?.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(timeoutError), remainingMs);
  const cancellation = scope?.shouldStop ? setInterval(() => {
    if (scope.shouldStop?.()) controller.abort(cancelError);
  }, 25) : null;
  if (init?.signal?.aborted || scope?.shouldStop?.()) controller.abort(cancelError);
  try {
    let requestInit: BoundedRequestInit = { ...init, headers };
    for (let redirects = 0; ; redirects++) {
      if (redirects > MAX_PROXY_REDIRECTS) throw new Error('TOO_MANY_REDIRECTS');
      const release = await acquireNetworkSlot(url, controller.signal, scope?.perHostConcurrency, scope?.priority);
      try {
        const response = await fetchViaProxyRequest(url, requestInit, controller.signal);
        const location = response.headers.get('location');
        if ([301, 302, 303, 307, 308].includes(response.status) && location && init?.redirect !== 'manual') {
          await response.body?.cancel();
          const nextUrl = new URL(location, url).href;
          requestInit = redirectInit(url, nextUrl, requestInit);
          url = nextUrl;
          continue;
        }
        const maxBytes = init?.maxBytes ?? MAX_RESPONSE_BYTES;
        if (Number(response.headers.get('content-length')) > maxBytes) {
          await response.body?.cancel();
          throw new Error('RESPONSE_TOO_LARGE');
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (reader) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > maxBytes) throw new Error('RESPONSE_TOO_LARGE');
            chunks.push(part.value);
          }
        } catch (error) {
          await reader?.cancel().catch(() => {});
          throw error;
        } finally { reader?.releaseLock(); }
        const buffered = new Response(NULL_BODY_RESPONSE_STATUSES.has(response.status) ? null : Buffer.concat(chunks), {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
        Object.defineProperty(buffered, 'url', { value: response.url || url });
        return buffered;
      } finally { release(); }
    }
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason ?? cancelError;
    throw error;
  } finally {
    clearTimeout(timer);
    if (cancellation) clearInterval(cancellation);
    init?.signal?.removeEventListener('abort', onExternalAbort);
    controller.abort();
  }
}
