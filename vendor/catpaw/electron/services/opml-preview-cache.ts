import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export const OPML_PREVIEW_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxCacheBytes: 32 * 1024 * 1024,
  maxEntries: 8,
  ttlMs: 15 * 60 * 1000,
};

type Preview = { xml: string; filePath: string };
type PendingPreview = Preview & {
  owner: number;
  bytes: number;
  busy: boolean;
  discarded: boolean;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
};

async function readOpmlFile(filePath: string, maxBytes: number) {
  // Nonblocking open also lets us reject FIFOs/devices without waiting for a writer.
  const file = await fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error('OPML_FILE_NOT_REGULAR');
    if (stat.size > maxBytes) throw new Error('OPML_FILE_TOO_LARGE');
    // Read the same descriptor, with a hard bound even if the file grows after stat.
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const { bytesRead } = await file.read(buffer, bytes, buffer.length - bytes, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
      if (bytes > maxBytes) throw new Error('OPML_FILE_TOO_LARGE');
    }
    return { xml: buffer.toString('utf8', 0, bytes), bytes };
  } finally {
    await file.close();
  }
}

export class OpmlPreviewCache {
  private readonly pending = new Map<string, PendingPreview>();
  private bytes = 0;

  constructor(private readonly limits = OPML_PREVIEW_LIMITS) {}

  async create(filePath: string, owner: number): Promise<string> {
    // Reserve the full possible read before any I/O. The budget counts source
    // bytes, including reads and queued/running maintenance, not V8 heap bytes.
    if (this.pending.size >= this.limits.maxEntries || this.bytes + this.limits.maxFileBytes > this.limits.maxCacheBytes) {
      throw new Error('OPML_PREVIEW_CACHE_FULL');
    }
    const token = randomUUID();
    const pending: PendingPreview = {
      xml: '', filePath, owner, bytes: this.limits.maxFileBytes,
      busy: true, discarded: false, expiresAt: 0,
    };
    this.pending.set(token, pending);
    this.bytes += pending.bytes;
    let completed = false;
    try {
      const result = await readOpmlFile(filePath, this.limits.maxFileBytes);
      if (pending.discarded) throw new Error('OPML_PREVIEW_EXPIRED');
      this.bytes += result.bytes - pending.bytes;
      pending.bytes = result.bytes;
      pending.xml = result.xml;
      pending.expiresAt = Date.now() + this.limits.ttlMs;
      pending.timer = setTimeout(() => this.discard(token), this.limits.ttlMs);
      pending.timer.unref();
      completed = true;
      return token;
    } finally {
      pending.busy = false;
      if (!completed) this.discard(token);
    }
  }

  async use<T>(token: string, owner: number, consume: boolean, operation: (preview: Preview) => Promise<T>): Promise<T> {
    const pending = this.pending.get(token);
    if (!pending || pending.owner !== owner || pending.discarded) throw new Error('OPML_PREVIEW_EXPIRED');
    if (pending.busy) throw new Error('OPML_PREVIEW_BUSY');
    if (Date.now() >= pending.expiresAt) {
      this.discard(token);
      throw new Error('OPML_PREVIEW_EXPIRED');
    }
    pending.busy = true;
    let completed = false;
    try {
      const result = await operation(pending);
      if (!consume && (pending.discarded || Date.now() >= pending.expiresAt)) throw new Error('OPML_PREVIEW_EXPIRED');
      completed = true;
      return result;
    } finally {
      pending.busy = false;
      if (!completed || consume || pending.discarded) this.discard(token);
    }
  }

  discardOwner(owner: number) {
    for (const [token, pending] of this.pending) {
      if (pending.owner === owner) this.discard(token);
    }
  }

  private discard(token: string) {
    const pending = this.pending.get(token);
    if (!pending) return;
    pending.discarded = true;
    clearTimeout(pending.timer);
    // An active read or maintenance closure still owns its XML. Keep its quota
    // charged until it settles, even after expiry or the owning window closes.
    if (pending.busy) return;
    this.pending.delete(token);
    this.bytes -= pending.bytes;
    pending.xml = '';
  }
}
