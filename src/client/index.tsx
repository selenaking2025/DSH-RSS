import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import App from '../../.generated/catpaw/renderer/src/App';
import { bindReaderBridge, bindReaderSurface, bindReaderConfirmation } from './environment.ts';
import { createBridge, type Rpc } from './bridge.ts';
import { installFileActions } from './files.ts';
import css from './reader.css';
import { createConfirmation, Confirmation } from './confirmation.tsx';

interface ClientContext {
  connection: { rpc: Rpc };
  locale: { register(namespace: string, dictionary: object): () => void };
  effect(factory: () => (() => void) | (() => Promise<void>), label?: string): unknown;
  slots: { inject(name: string, factory: () => unknown): unknown; register(options: object, component: React.ComponentType<any>): unknown };
}
export const inject = ['slots', 'layout', 'locale', 'connection'];
type Bridge = ReturnType<typeof createBridge>;
function Reader({ bridge, confirmation }: { bridge: Bridge; confirmation: ReturnType<typeof createConfirmation> }) {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement>();
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => bridge.onStatus(setError), [bridge]);
  useEffect(() => bridge.onReconnect(() => setGeneration(value => value + 1)), [bridge]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    let preference = 'system';
    const update = () => { if (host.current) host.current.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference; };
    const stop = bridge.onTheme(value => { preference = value; update(); });
    media.addEventListener('change', update);
    return () => { stop(); media.removeEventListener('change', update); };
  }, [bridge]);
  useEffect(() => {
    const node = host.current!;
    const shadow = node.shadowRoot ?? node.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = css;
    const body = document.createElement('div'); body.id = 'root'; body.className = 'catpaw-body';
    shadow.append(style, body); const dispose = bindReaderSurface(shadow, body); setRoot(body);
    return () => { dispose(); body.remove(); style.remove(); };
  }, []);
  return <div style={{ height: '100%', minHeight: 0, position: 'relative', boxSizing: 'border-box', paddingTop: 'var(--dsh-frame-top-clearance, 0px)' }}>
    {error ? <div role="alert" style={{ position: 'absolute', top: 0, zIndex: 10, background: '#fff0ce', color: '#503700', padding: 8 }}>{error}</div> : null}
    <div ref={host} data-catpaw-reader="" style={{ display: 'block', height: '100%', minHeight: 0 }}>
      {root ? createPortal(<><App key={generation} /><Confirmation controller={confirmation} /></>, root) : null}
    </div>
  </div>;
}
function CatpawIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1zM12 6v14" /></svg>;
}
export function apply(ctx: ClientContext) {
  const bridge = createBridge(ctx.connection.rpc);
  const confirmation = createConfirmation();
  installFileActions(bridge, confirmation.ask);
  const unbind = bindReaderBridge(bridge.rss);
  const unbindConfirmation = bindReaderConfirmation(confirmation.ask);
  ctx.effect(() => () => { unbindConfirmation(); unbind(); bridge.dispose(); }, 'catpaw: browser bridge');
  ctx.effect(() => ctx.locale.register('catpaw', { zh: { label: 'Catpaw 阅读器' }, en: { label: 'Catpaw Reader' } }));
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'catpaw', locale: 'catpaw', inject: () => ({ bridge, confirmation }) }, Reader));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'catpaw', order: 20,
    label: 'Catpaw', locale: 'catpaw' }, CatpawIcon));
}
