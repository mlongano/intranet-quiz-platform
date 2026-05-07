import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { teacherChangePassword } from '../api';
import { saveTeacherSession } from '../lib/session';

function ChangePasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const changeToken: string | undefined = (location.state as any)?.change_token;

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const changeMutation = useMutation({
    mutationFn: () => teacherChangePassword(oldPassword, newPassword, changeToken),
    onSuccess: (data) => {
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
      setError(err.message ?? 'Impossibile cambiare la password.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newPassword || newPassword.length < 8) {
      setError('La nuova password deve essere di almeno 8 caratteri.');
      return;
    }
    if (newPassword !== confirm) {
      setError('Le password non coincidono.');
      return;
    }
    if (!changeToken && !oldPassword) {
      setError('Inserisci la password attuale.');
      return;
    }
    changeMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-surface-container rounded-2xl border border-outline-variant/30 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-secondary/10 border border-secondary/30 rounded-full mb-4">
              <KeyRound size={24} className="text-secondary" />
            </div>
            <h1 className="text-2xl font-bold text-on-surface">Cambia Password</h1>
            {changeToken && (
              <p className="text-sm text-on-surface-variant mt-2">
                È necessario cambiare la password al primo accesso.
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!changeToken && (
              <div>
                <label className="block text-sm font-medium text-on-surface-variant mb-1.5">
                  Password attuale
                </label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  disabled={changeMutation.isPending}
                  required
                  autoComplete="current-password"
                  className="block w-full px-3 py-2.5 bg-surface border border-outline-variant/50 rounded-lg text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 transition-colors"
                  placeholder="••••••••"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-on-surface-variant mb-1.5">
                Nuova password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={changeMutation.isPending}
                required
                minLength={8}
                autoComplete="new-password"
                className="block w-full px-3 py-2.5 bg-surface border border-outline-variant/50 rounded-lg text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 transition-colors"
                placeholder="Almeno 8 caratteri"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-on-surface-variant mb-1.5">
                Conferma password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={changeMutation.isPending}
                required
                autoComplete="new-password"
                className="block w-full px-3 py-2.5 bg-surface border border-outline-variant/50 rounded-lg text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="p-3 bg-error/10 border border-error/40 rounded-lg">
                <p className="text-error text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={changeMutation.isPending}
              className="w-full bg-primary text-on-primary font-semibold py-2.5 rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 text-sm"
            >
              {changeMutation.isPending ? 'Salvataggio...' : 'Imposta Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default ChangePasswordPage;
