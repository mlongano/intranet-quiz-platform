// frontend/src/pages/FinishPage.tsx
import { Link, useLocation } from "react-router-dom";
import type { SubmitResponse } from "../api";
import ThemeToggle from "../components/ThemeToggle";

function FinishPage() {
  const location = useLocation();
  const submitResult = (location.state as { submitResult?: SubmitResponse } | null)?.submitResult;
  const isProvisional = submitResult?.status === 'provisional' || submitResult?.llm_pending;

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      <div className="bg-surface-container rounded-lg border border-outline-variant/30 p-8 max-w-md w-full text-center">
        <h2 className="text-2xl font-bold mb-3 text-tertiary">Consegna registrata</h2>
        <p className="text-on-surface-variant mb-8">
          Le tue risposte sono state salvate correttamente.
        </p>
        {submitResult && (
          <div className="mb-8 rounded-lg border border-outline-variant/30 bg-surface px-4 py-3">
            <p className="text-sm font-semibold text-on-surface-variant">
              {isProvisional ? 'Punteggio provvisorio' : 'Punteggio finale'}
            </p>
            <p className="mt-1 text-2xl font-bold text-primary">
              {submitResult.raw_points.toFixed(1)} / {submitResult.max_points.toFixed(1)}
            </p>
            <p className="text-sm text-on-surface-variant">{submitResult.percent.toFixed(1)}%</p>
            {isProvisional && (
              <p className="mt-2 text-xs text-secondary">
                Alcune risposte aperte sono in attesa di valutazione automatica.
              </p>
            )}
          </div>
        )}
        <Link
          to="/"
          className="inline-block px-6 py-2 bg-primary text-on-primary font-medium rounded-md hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-opacity"
        >
          Torna all'inizio
        </Link>
      </div>
    </div>
  );
}

export default FinishPage;
