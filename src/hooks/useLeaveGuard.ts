import { useEffect, useRef } from 'react';

// While `active`, leaving the page asks first. Links inside the app and the browser's
// back button call `onAttempt` with where the person wanted to go (null for "back"),
// and the page decides; closing or reloading the tab gets the browser's own warning,
// the only one a browser allows there.
export const useLeaveGuard = (active: boolean, onAttempt: (to: string | null) => void) => {
  const attempt = useRef(onAttempt);
  attempt.current = onAttempt;

  useEffect(() => {
    if (!active) return;

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const to = url.pathname + url.search + url.hash;
      if (url.pathname === window.location.pathname) return;
      // Capture phase on document runs before React's own handlers (router links included).
      e.preventDefault();
      e.stopPropagation();
      attempt.current(to);
    };

    // An extra history entry on top of this page turns "back" into a popstate we can answer.
    window.history.pushState(window.history.state, '', window.location.href);
    const onPop = () => {
      window.history.pushState(window.history.state, '', window.location.href);
      attempt.current(null);
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active]);
};
