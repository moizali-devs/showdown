import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Scroll reveal. Attach the returned ref to a container; every descendant with class `rv`
 * gets class `in` once, the first time it enters the viewport (then it is unobserved).
 * Stagger with a `--i` custom property on each item. Items stay visible when
 * IntersectionObserver is missing: the hiding class (`rv-ready`) is only added when it exists.
 * `dep` re-scans after async content (e.g. films) renders.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(dep?: unknown): RefObject<T> {
  const ref = useRef<T>(null);
  const supported = typeof IntersectionObserver !== 'undefined';

  useLayoutEffect(() => {
    if (supported) ref.current?.classList.add('rv-ready');
  }, [supported]);

  useEffect(() => {
    const root = ref.current;
    if (!root || !supported) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        (e.target as HTMLElement).classList.add('in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    root.querySelectorAll<HTMLElement>('.rv:not(.in)').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [dep, supported]);

  return ref;
}
