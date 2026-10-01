import type { RssBridge } from '../../.generated/catpaw/electron/contracts/rss';
import type { Question } from './confirmation.tsx';
/** One client plugin instance owns this bridge; no API is installed on window. */
export let readerBridge: { rss: RssBridge } | undefined;
let surface: ShadowRoot | undefined;
let body: HTMLElement | undefined;
let confirm: ((question: Question) => Promise<boolean>) | undefined;
export function bindReaderConfirmation(ask: (question: Question) => Promise<boolean>) {
  confirm = ask;
  return () => { if (confirm === ask) confirm = undefined; };
}
export function readerConfirm(detail: string) {
  return confirm?.({ title: '确认操作', detail }) ?? Promise.resolve(false);
}
export function bindReaderBridge(rss: RssBridge) { readerBridge = { rss }; return () => { readerBridge = undefined; }; }
export function bindReaderSurface(root: ShadowRoot, content: HTMLElement) {
  surface = root; body = content;
  return () => { if (surface === root) { surface = undefined; body = undefined; } };
}
/** Scope queries, portals and keyboard listeners to the reader's shadow tree. */
export const readerDocument: Document = new Proxy({} as Document, {
  get(_target, key) {
    if (key === 'body' || key === 'documentElement') return body;
    if (key === 'activeElement') return surface?.activeElement;
    if (key === 'getElementById') return (id: string) => surface?.getElementById(id) ?? null;
    if (['querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener'].includes(String(key)) && surface) {
      const member = Reflect.get(surface, key); return typeof member === 'function' ? member.bind(surface) : member;
    }
    const member = Reflect.get(document, key); return typeof member === 'function' ? member.bind(document) : member;
  },
});
