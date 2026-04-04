// frontend/src/pages/StartPage.tsx (Secure Version - No localStorage)
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Mail, AlertTriangle } from "lucide-react";
import { startQuiz, getQuizStatus, getQuizInfo } from "../api";
import ThemeToggle from "../components/ThemeToggle";
import AccessibilityPanel from "../components/AccessibilityPanel";

function ErrorDisplay({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mt-4 p-4 bg-error/10 border border-error/40 rounded-lg">
      <div className="flex items-start">
        <div className="flex-shrink-0 text-xl mr-3">⚠️</div>
        <p className="text-error text-sm">{message}</p>
      </div>
    </div>
  );
}

function StartPage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const { data: quizInfo } = useQuery({
    queryKey: ["quizInfo"],
    queryFn: () => getQuizInfo(),
    refetchOnWindowFocus: false,
  });

  const { data: quizStatus, isLoading: isStatusLoading } = useQuery({
    queryKey: ["quizStatus"],
    queryFn: () => getQuizStatus(),
    refetchOnWindowFocus: false,
  });

  const startMutation = useMutation({
    mutationFn: startQuiz,
    onSuccess: (data) => {
      console.log("Quiz started:", data);
      navigate(`/quiz/${data.quiz_id}`);
    },
    onError: (err: any) => {
      if (err.isConflict && err.quizId) {
        setError(
          `Il quiz è già stato avviato o completato. Tentativo di ripristino del quiz ${err.quizId}...`,
        );
        navigate(`/quiz/${err.quizId}`);
      } else {
        setError(`Errore nell'avvio del quiz: ${err.message}`);
      }
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Inserisci il tuo indirizzo email.");
      return;
    }
    startMutation.mutate({ name: name.trim().toLowerCase() });
  };

  const isDisabled = !isStatusLoading && quizStatus && !quizStatus.enabled;

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <AccessibilityPanel />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">

        {/* Header Card */}
        <div className="bg-surface-container rounded-t-2xl border border-b-0 border-outline-variant/30 p-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 border border-primary/30 rounded-full mb-4">
              <FileText size={28} className="text-primary" />
            </div>
            <h1 className="text-3xl font-bold text-on-surface mb-2">
              {quizInfo?.title || "Quiz"}
            </h1>
            <p className="text-on-surface-variant text-sm">
              Test del{" "}
              {(() => {
                const today = new Date();
                return today.toLocaleDateString("it-IT", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                });
              })()}
            </p>
            {quizInfo?.question_count && (
              <p className="text-primary text-sm font-medium mt-2">
                {quizInfo.question_count}{" "}
                {quizInfo.question_count === 1 ? "domanda" : "domande"}
              </p>
            )}
          </div>

          {/* Quiz Status Warning */}
          {isDisabled && (
            <div className="mb-2 p-4 bg-error/10 border border-error/40 rounded-lg">
              <div className="flex items-start">
                <div className="flex-shrink-0 text-2xl mr-3">🚫</div>
                <div>
                  <h3 className="text-error font-semibold mb-1">Quiz Disabilitato</h3>
                  <p className="text-error/80 text-sm">
                    Il quiz è attualmente disabilitato dall'amministratore. Non è
                    possibile avviare il quiz in questo momento.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Form Card */}
        <div className="bg-surface-container-high rounded-b-2xl border border-t border-outline-variant/30 p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-semibold text-on-surface-variant mb-2"
              >
                Indirizzo Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail size={18} className="text-on-surface-variant" />
                </div>
                <input
                  id="email"
                  type="email"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={startMutation.isPending || !!isDisabled}
                  required
                  className="block w-full pl-10 pr-3 py-3 bg-surface-container border border-outline-variant/50 rounded-lg text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  placeholder="nome.cognome@esempio.it"
                  autoComplete="email"
                />
              </div>
              <p className="mt-2 text-xs text-on-surface-variant">
                Inserisci il tuo indirizzo email istituzionale
              </p>
            </div>

            <button
              type="submit"
              disabled={startMutation.isPending || !!isDisabled}
              className="w-full bg-primary text-on-primary font-semibold py-3 px-6 rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
            >
              {startMutation.isPending ? (
                <span className="flex items-center justify-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Avvio in corso...
                </span>
              ) : (
                "Inizia il Quiz"
              )}
            </button>
          </form>

          <ErrorDisplay message={error} />

          {/* Footer Info */}
          <div className="mt-6 pt-6 border-t border-outline-variant/30">
            <div className="flex items-start space-x-3 text-xs text-on-surface-variant">
              <AlertTriangle size={16} className="text-secondary flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-on-surface-variant">Informazioni importanti:</p>
                <ul className="list-disc list-inside space-y-1 text-on-surface-variant/70">
                  <li>Utilizza l'indirizzo email istituzionale fornito dal docente</li>
                  <li>Il quiz presenta una domanda alla volta, procedi con attenzione</li>
                  <li>È obbligatorio rispondere per passare alla domanda successiva</li>
                  <li>Non è possibile tornare indietro dopo aver risposto</li>
                  <li>
                    Nelle domande a risposta multipla, seleziona solo le opzioni di cui sei
                    sicuro
                  </li>
                  <li>In caso di interruzione, puoi riprendere il quiz da dove eri rimasto</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StartPage;
