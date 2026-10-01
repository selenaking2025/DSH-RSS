import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ReaderIcon } from './ReaderIcon';

type GroupAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

export function FeedGroupMenu({ groupName, actions }: { groupName: string; actions: GroupAction[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const closeAndFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const placeMenu = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      setPosition({
        top: Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - menu.offsetHeight - 8)),
        left: Math.max(8, Math.min(anchor.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)),
      });
    };
    const handleOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const handleScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    placeMenu();
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    document.addEventListener('pointerdown', handleOutsideClick);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', placeMenu);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', placeMenu);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button reader-subscription-manage"
        aria-label={`管理 ${groupName}`}
        title={`管理 ${groupName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ReaderIcon name="more" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="menu-panel"
          role="menu"
          aria-label={`管理 ${groupName}`}
          style={position}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') {
              if (event.key === 'Escape') event.preventDefault();
              closeAndFocus();
              return;
            }
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            let nextIndex: number;
            if (event.key === 'ArrowDown') nextIndex = (index + 1) % buttons.length;
            else if (event.key === 'ArrowUp') nextIndex = (index - 1 + buttons.length) % buttons.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = buttons.length - 1;
            else return;
            event.preventDefault();
            buttons[nextIndex]?.focus();
          }}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`menu-item${action.danger ? ' reader-menu-danger' : ''}`}
              disabled={action.disabled}
              onClick={() => {
                closeAndFocus();
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
