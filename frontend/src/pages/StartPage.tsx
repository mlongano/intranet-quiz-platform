// frontend/src/pages/StartPage.tsx (with Tailwind)
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { startQuiz, getQuizStatus, getQuizInfo } from "../api";

// Key needs to be accessible here too, or imported from a constants file
const QUIZ_STORAGE_KEY = "quiz_state";

// Simple reusable ErrorDisplay component (Example)
function ErrorDisplay({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mt-4 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg">
      <div className="flex items-start">
        <div className="flex-shrink-0 text-xl mr-3">⚠️</div>
        <p className="text-red-700 text-sm">{message}</p>
      </div>
    </div>
  );
}

function StartPage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Fetch quiz info (title and question count)
  const { data: quizInfo } = useQuery({
    queryKey: ["quizInfo"],
    queryFn: () => getQuizInfo(),
    refetchOnWindowFocus: false,
  });

  // Check quiz status
  const { data: quizStatus, isLoading: isStatusLoading } = useQuery({
    queryKey: ["quizStatus"],
    queryFn: () => getQuizStatus(),
    refetchOnWindowFocus: false,
  });

  const startMutation = useMutation({
    mutationFn: startQuiz,
    onSuccess: (data) => {
      console.log("Quiz started:", data);
      // *** FIX: Clear old state when starting a NEW quiz ***
      try {
        localStorage.removeItem(QUIZ_STORAGE_KEY);
        console.log("Cleared previous quiz state from localStorage.");
      } catch (e) {
        console.error("Failed to clear localStorage:", e);
      }
      navigate(`/quiz/${data.quiz_id}`);
    },
    onError: (err: any) => {
      // ... (error handling as before) ...
      if (err.isConflict && err.quizId) {
        // Don't clear localStorage if resuming
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header Card */}
        <div className="bg-white rounded-t-2xl shadow-lg p-8 border-b-4 border-teal-500">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-100 rounded-full mb-4">
              <span className="text-3xl">📝</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              {quizInfo?.title || "Quiz"}
            </h1>
            <p className="text-gray-600 text-sm">
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
              <p className="text-teal-600 text-sm font-medium mt-2">
                {quizInfo.question_count} {quizInfo.question_count === 1 ? "domanda" : "domande"}
              </p>
            )}
          </div>

          {/* Quiz Status Warning */}
          {!isStatusLoading && quizStatus && !quizStatus.enabled && (
            <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg">
              <div className="flex items-start">
                <div className="flex-shrink-0 text-2xl mr-3">🚫</div>
                <div>
                  <h3 className="text-red-800 font-semibold mb-1">Quiz Disabilitato</h3>
                  <p className="text-red-700 text-sm">
                    Il quiz è attualmente disabilitato dall'amministratore. Non è possibile avviare il quiz in questo momento.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-b-2xl shadow-lg p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
                Indirizzo Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="text-gray-400 text-lg">✉️</span>
                </div>
                <input
                  id="email"
                  type="email"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={startMutation.isPending || (quizStatus && !quizStatus.enabled)}
                  required
                  className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors text-gray-900 placeholder-gray-400"
                  placeholder="nome.cognome@esempio.it"
                  autoComplete="email"
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Inserisci il tuo indirizzo email istituzionale
              </p>
            </div>

            <button
              type="submit"
              disabled={startMutation.isPending || (quizStatus && !quizStatus.enabled)}
              className="w-full bg-gradient-to-r from-teal-600 to-teal-700 text-white font-semibold py-3 px-6 rounded-lg hover:from-teal-700 hover:to-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg"
            >
              {startMutation.isPending ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-start space-x-3 text-xs text-gray-600">
              <span className="text-lg flex-shrink-0">💡</span>
              <div className="space-y-1">
                <p className="font-medium">Informazioni importanti:</p>
                <ul className="list-disc list-inside space-y-1 text-gray-500">
                  <li>Utilizza l'indirizzo email istituzionale fornito dal docente</li>
                  <li>Il quiz presenta una domanda alla volta, procedi con attenzione</li>
                  <li>È obbligatorio rispondere per passare alla domanda successiva</li>
                  <li>Non è possibile tornare indietro dopo aver risposto</li>
                  <li>Nelle domande a risposta multipla, seleziona solo le opzioni di cui sei sicuro</li>
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
