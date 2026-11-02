import type { Session } from 'electron';
import type { BackgroundJobPriority } from '../contracts/background-jobs';
import { acquireNetworkSlot } from '../network/request-slots';
import { linuxDoNavigationAllowed } from '../sources/linuxdo';

type Request = { controller: AbortController; finished: boolean; release?: () => void; done: Promise<void>; settle: () => void };
type Owner = { priority: BackgroundJobPriority; requests: Set<Request> };

/** Admit native document/API transports, including redirects, until Chromium retires them. */
export function linuxDoNetwork(session: Session) {
  const owners = new Map<number, Owner>();
  const requests = new Map<number, Request>();
  const redirected = new Set<number>();
  const finish = (id: number, redirect = false) => {
    if (redirect) redirected.add(id); else redirected.delete(id);
    const request = requests.get(id);
    if (!request) return;
    requests.delete(id);
    request.finished = true;
    request.controller.abort();
    if (request.release) { request.release(); request.settle(); }
  };
  session.webRequest.onBeforeRequest((details, callback) => {
    const owner = details.webContentsId === undefined ? undefined : owners.get(details.webContentsId);
    if (!owner || (details.resourceType !== 'mainFrame' && details.resourceType !== 'xhr')) { callback({}); return; }
    if (!linuxDoNavigationAllowed(details.url)) {
      // Embedded challenge subresources stay Chromium-owned; documents stay on Linux DO.
      callback({ cancel: details.resourceType === 'mainFrame' || !details.frame?.parent }); return;
    }
    let resolve!: () => void;
    const request: Request = { controller: new AbortController(), finished: false,
      done: new Promise<void>((done) => { resolve = done; }), settle: () => { owner.requests.delete(request); resolve(); } };
    owner.requests.add(request);
    requests.set(details.id, request);
    void acquireNetworkSlot(details.url, request.controller.signal, 1, owner.priority).then((release) => {
      if (request.finished) { release(); callback({ cancel: true }); request.settle(); return; }
      request.release = release;
      callback({});
    }, () => { callback({ cancel: true }); finish(details.id); request.settle(); });
  });
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    if (redirected.has(details.id)) {
      for (const key of Object.keys(headers)) if (/^if-(none-match|modified-since)$/i.test(key)) delete headers[key];
    }
    callback({ requestHeaders: headers });
  });
  session.webRequest.onBeforeRedirect((details) => finish(details.id, true));
  session.webRequest.onCompleted((details) => finish(details.id));
  session.webRequest.onErrorOccurred((details) => finish(details.id));
  return {
    own(id: number, priority: BackgroundJobPriority) {
      const owner: Owner = { priority, requests: new Set() };
      owners.set(id, owner);
      return async () => {
        owners.delete(id);
        // The owner destroys its window first. Active transports keep their permits
        // until onCompleted/onErrorOccurred; queued admissions can retire immediately.
        const pending = [...owner.requests];
        for (const request of pending) request.controller.abort();
        await Promise.all(pending.map((request) => request.done));
      };
    },
  };
}
