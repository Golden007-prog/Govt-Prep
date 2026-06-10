import { useEffect, useRef } from 'react';

/**
 * Subscribes a single window `keydown` listener that dispatches to the handler
 * whose key matches `event.key` (e.g. '1', 'Enter', 'ArrowRight', 'm').
 *
 * Events originating from inputs, textareas, selects, or contentEditable
 * elements are ignored so typing never triggers shortcuts, and events with a
 * Ctrl/Meta/Alt modifier are ignored so browser/OS shortcuts (copy, tab
 * switching, history navigation) keep working. Matching handlers
 * are invoked after `preventDefault()`. The latest bindings are kept in a ref,
 * so the listener subscribes once (re-subscribing only when `enabled` flips).
 *
 * @param bindings Map of `KeyboardEvent.key` values to handlers.
 * @param enabled When false the listener is detached entirely. Defaults to true.
 */
export function useHotkeys(
  bindings: Record<string, (e: KeyboardEvent) => void>,
  enabled = true,
): void {
  const bindingsRef = useRef(bindings);

  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Never hijack browser/OS shortcuts (Ctrl/Cmd+C copy, Ctrl+1..9 tab switch,
      // Alt+Arrow history navigation). Shift stays allowed: no binding uses it and
      // e.key already reflects shifted characters.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }
      const handler = bindingsRef.current[e.key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
