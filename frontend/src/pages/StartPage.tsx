import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { FileText, Mail, Hash, AlertTriangle } from 'lucide-react';
import { studentJoin, startQuiz } from '../api';
import { saveStudentSession } from '../lib/session';
import ThemeToggle from '../components/ThemeToggle';
import AccessibilityPanel from '../components/AccessibilityPanel';

function StartPage() {
  const [email, setEmail] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const startMutation = useMutation({
    mutationFn: async () => {
      const joinData = await studentJoin(email.trim().toLowerCase(), joinCode.trim().toUpperCase());
      saveStudentSession({
        token: joinData.token,
        student_id: joinData.student_id,
        session_id: joinData.session_id,
        session_title: joinData.session_title,
      });
      const startData = await startQuiz();
      return startData.quiz_id;
    },
    onSuccess: (quizId) => {
      navigate(`/quiz/${quizId}`);
    },
    onError: (err: any) => {
      if (err.isConflict && err.quizId) {
        navigate(`/quiz/${err.quizId}`);
      } else if (err.isConflict) {
        setError('Hai già consegnato questo quiz.');
      } else {
        setError(err.message ?? 'Errore durante il login.');
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) { setError('Inserisci il tuo indirizzo email.'); return; }
    if (!joinCode.trim()) { setError('Inserisci il codice di accesso.'); return; }
    startMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <AccessibilityPanel />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">

        <div className="bg-surface-container rounded-t-2xl border border-b-0 border-outline-variant/30 p-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 border border-primary/30 rounded-full mb-4">
              <FileText size={28} className="text-primary" />
            </div>
            <h1 className="text-3xl font-bold text-on-surface mb-2">Quiz</h1>
            <p className="text-on-surface-variant text-sm">
              {new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="bg-surface-container-high rounded-b-2xl border border-t border-outline-variant/30 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-on-surface-variant mb-2">
                Indirizzo Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail size={18} className="text-on-surface-variant" />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={startMutation.isPending}
                  required
                  className="block w-full pl-10 pr-3 py-3 bg-surface-container border border-outline-variant/50 rounded-lg text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  placeholder="nome.cognome@scuola.edu.it"
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label htmlFor="joinCode" className="block text-sm font-semibold text-on-surface-variant mb-2">
                Codice di Accesso
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Hash size={18} className="text-on-surface-variant" />
                </div>
                <input
                  id="joinCode"
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  disabled={startMutation.isPending}
                  required
                  maxLength={6}
                  className="block w-full pl-10 pr-3 py-3 bg-surface-container border border-outline-variant/50 rounded-lg text-on-surface placeholder-on-surface-variant/50 font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors uppercase"
                  placeholder="ABCD12"
                  autoComplete="off"
                  autoCapitalize="characters"
                />
              </div>
              <p className="mt-1.5 text-xs text-on-surface-variant">
                Codice scritto alla lavagna dal docente
              </p>
            </div>

            <button
              type="submit"
              disabled={startMutation.isPending}
              className="w-full bg-primary text-on-primary font-semibold py-3 px-6 rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
            >
              {startMutation.isPending ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Accesso in corso...
                </span>
              ) : 'Inizia il Quiz'}
            </button>
          </form>

          {error && (
            <div className="mt-4 p-4 bg-error/10 border border-error/40 rounded-lg">
              <p className="text-error text-sm">{error}</p>
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-outline-variant/30">
            <div className="flex items-start space-x-3 text-xs text-on-surface-variant">
              <AlertTriangle size={16} className="text-secondary flex-shrink-0 mt-0.5" />
              <ul className="list-disc list-inside space-y-1 text-on-surface-variant/70">
                <li>Utilizza l'indirizzo email istituzionale</li>
                <li>Il quiz presenta una domanda alla volta</li>
                <li>Non è possibile tornare indietro dopo aver risposto</li>
                <li>In caso di interruzione, puoi riprendere con lo stesso codice</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StartPage;
