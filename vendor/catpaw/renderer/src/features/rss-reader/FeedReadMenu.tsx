import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

export type ReadMenuEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;
export type FeedReadMenuTarget = {
  feedId: string | null;
  label: string;
  trigger: HTMLButtonElement;
  x: number;
  y: number;
};

export function isReadMenuKey(event: KeyboardEvent<HTMLElement>) {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
}

export function FeedReadMenu({ target, disabled, onClose, onMarkRead }: {
  target: FeedReadMenuTarget;
  disabled: boolean;
  onClose: () => void;
  onMarkRead: (feedId?: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: target.y, left: target.x });
  const closeAndFocus = () => {
    onClose();
    target.trigger.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    setPosition({
      top: Math.max(8, Math.min(target.y, window.innerHeight - menu.offsetHeight - 8)),
      left: Math.max(8, Math.min(target.x, window.innerWidth - menu.offsetWidth - 8)),
    });
    (menu.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? menu).focus({ preventScroll: true });
    const dismissOutside = (event: Event) => {
      if (!menu.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('contextmenu', dismissOutside, true);
    document.addEventListener('scroll', dismissOutside, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('contextmenu', dismissOutside, true);
      document.removeEventListener('scroll', dismissOutside, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [target, onClose]);

  return createPortal(
    <div ref={menuRef} className="menu-panel" role="menu" tabIndex={-1}
      aria-label={target.label + '的已读操作'} style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') event.preventDefault();
          closeAndFocus();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
        }
      }}>
      <button type="button" role="menuitem" tabIndex={-1} className="menu-item" disabled={disabled}
        title={target.feedId === null ? '将所有订阅中的未读文章标为已读' : '将「' + target.label + '」中的未读文章全部标为已读'}
        onClick={() => { closeAndFocus(); onMarkRead(target.feedId ?? undefined); }}>
        {target.feedId === null ? '将所有订阅标为已读' : '将此订阅全部标为已读'}
      </button>
    </div>, document.body,
  );
}
