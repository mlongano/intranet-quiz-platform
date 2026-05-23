import { useState, useCallback } from 'react';

interface ConfirmState {
  message: string;
  onConfirm: () => void;
}

export function useConfirmModal() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const ask = useCallback((message: string, onConfirm: () => void) => {
    setState({ message, onConfirm });
  }, []);

  const dismiss = useCallback(() => setState(null), []);

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
              dismiss();
              state.onConfirm();
            }}
            className="px-3 py-1.5 text-sm bg-error/20 border border-error/50 text-error rounded-lg hover:bg-error/30 transition-colors"
          >
            Conferma
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, dismiss, modal };
}
