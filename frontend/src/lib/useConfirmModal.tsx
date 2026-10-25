import { useState, useCallback, useEffect, useRef } from 'react';

interface ConfirmState {
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmLabel?: string;
}

export function useConfirmModal() {
  const [state, setState] = useState<ConfirmState | null>(null);
  // The open dialog, readable from callbacks without a state updater: updaters
  // may run twice in StrictMode, and onCancel must run once.
  const current = useRef<ConfirmState | null>(null);
  useEffect(() => { current.current = state; }, [state]);

  // onCancel runs when the dialog is dismissed without confirming (Annulla or
  // a click outside): callers such as a navigation blocker need to know.
  const ask = useCallback((
    message: string,
    onConfirm: () => void,
    options?: { onCancel?: () => void; confirmLabel?: string },
  ) => {
    setState({ message, onConfirm, ...options });
  }, []);

  const close = useCallback(() => setState(null), []);
  const dismiss = useCallback(() => {
    const open = current.current;
    setState(null);
    open?.onCancel?.();
  }, []);

  const modal = state ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={dismiss}
    >
      <div
        className="bg-surface-container rounded-xl border border-outline-variant/30 p-5 mx-4 max-w-sm shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-sm text-on-surface mb-4 whitespace-pre-wrap">{state.message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={dismiss}
            className="px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-low transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={() => {
              close();
              state.onConfirm();
            }}
            className="px-3 py-1.5 text-sm bg-error/20 border border-error/50 text-error rounded-lg hover:bg-error/30 transition-colors"
          >
            {state.confirmLabel ?? 'Conferma'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, dismiss, modal };
}
