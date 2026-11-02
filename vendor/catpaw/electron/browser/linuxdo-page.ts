import { isLinuxDoFeedUrl } from '../sources/linuxdo';

export function linuxDoFetchScript(url: string, input: Record<string, string> = {}) {
  if (!isLinuxDoFeedUrl(url)) throw new Error('LINUXDO_INVALID_URL');
  const headers: Record<string, string> = { Accept: 'application/rss+xml, application/xml;q=0.9' };
  for (const [name, value] of Object.entries(input)) {
    if (!/^if-(none-match|modified-since)$/i.test(name) || typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) {
      throw new Error('LINUXDO_INVALID_HEADERS');
    }
    headers[name] = value;
  }
  return `(async () => {
    if (location.origin !== 'https://linux.do') throw new Error('LINUXDO_VERIFICATION_REQUIRED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(${JSON.stringify(url)}, { headers: ${JSON.stringify(headers)}, credentials: 'include', signal: controller.signal });
      if (new URL(response.url).origin !== 'https://linux.do') throw new Error('LINUXDO_INVALID_RESPONSE');
      const headers = {};
      for (const name of ['content-type', 'etag', 'last-modified', 'retry-after', 'cf-mitigated']) {
        const value = response.headers.get(name); if (value) headers[name] = value;
      }
      let body = '', bytes = 0;
      if (response.body) {
        const reader = response.body.getReader(), decoder = new TextDecoder();
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('BROWSER_RESPONSE_TOO_LARGE'); }
            body += decoder.decode(part.value, { stream: true });
          }
          body += decoder.decode();
        } finally { reader.releaseLock(); }
      }
      return { status: response.status, headers, body };
    } finally { clearTimeout(timer); }
  })()`;
}
