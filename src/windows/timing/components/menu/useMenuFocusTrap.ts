import { useEffect, useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useMenuFocusTrap(): RefObject<HTMLDivElement | null> {
  const menuRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const menu = menuRef.current;
    const restoreTarget = restoreFocusRef.current;
    if (!menu) return;
    menu.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      if (restoreTarget?.isConnected) restoreTarget.focus();
    };
  }, []);

  return menuRef;
}

export function trapMenuTab(event: KeyboardEvent, menu: HTMLDivElement | null): void {
  if (event.key !== 'Tab' || !menu) return;
  const focusable = Array.from(menu.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
