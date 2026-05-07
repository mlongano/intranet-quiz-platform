import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { LayoutDashboard, Mail, Lock } from 'lucide-react';
import { teacherLogin } from '../api';
import { saveTeacherSession } from '../lib/session';
import ThemeToggle from '../components/ThemeToggle';

function TeacherLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const loginMutation = useMutation({
    mutationFn: () => teacherLogin(email.trim().toLowerCase(), password),
    onSuccess: (data) => {
      if (data.must_change_password) {
        navigate('/teacher/change-password', { state: { change_token: data.change_token } });
        return;
      }
      saveTeacherSession({
        token: data.token,
        teacher_id: data.teacher_id,
        role: data.role,
        email: data.email,
        display_name: data.display_name,
      });
      navigate('/teacher');
    },
    onError: (err: any) => {
      setError(err.message ?? 'Credenziali non valide.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) { setError('Compila tutti i campi.'); return; }
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="bg-surface-container rounded-2xl border border-outline-variant/30 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-primary/10 border border-primary/30 rounded-full mb-4">
              <LayoutDashboard size={24} className="text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-on-surface">QuizParty</h1>
            <p className="text-sm text-on-surface-variant mt-1">Accesso docenti</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-on-surface-variant mb-1.5">
                Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail size={16} className="text-on-surface-variant" />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loginMutation.isPending}
                  required
                  autoComplete="email"
                  className="block w-full pl-9 pr-3 py-2.5 bg-surface border border-outline-variant/50 rounded-lg text-on-surface placeholder-on-surface-variant/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 disabled:opacity-50 transition-colors"
                  placeholder="docente@scuola.edu.it"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-on-surface-variant mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={16} className="text-on-surface-variant" />
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loginMutation.isPending}
                  required
                  autoComplete="current-password"
                  className="block w-full pl-9 pr-3 py-2.5 bg-surface border border-outline-variant/50 rounded-lg text-on-surface placeholder-on-surface-variant/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 disabled:opacity-50 transition-colors"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-error/10 border border-error/40 rounded-lg">
                <p className="text-error text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full bg-primary text-on-primary font-semibold py-2.5 px-6 rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 text-sm"
            >
              {loginMutation.isPending ? 'Accesso...' : 'Accedi'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default TeacherLoginPage;
