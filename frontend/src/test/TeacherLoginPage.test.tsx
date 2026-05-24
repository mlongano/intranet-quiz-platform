import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeacherLoginPage from '../pages/TeacherLoginPage';
import { teacherGoogleLogin, teacherLogin } from '../api';
import { saveTeacherSession } from '../lib/session';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    teacherLogin: vi.fn(),
    teacherGoogleLogin: vi.fn(),
  };
});

vi.mock('../lib/session', async () => {
  const actual = await vi.importActual<typeof import('../lib/session')>('../lib/session');
  return {
    ...actual,
    saveTeacherSession: vi.fn(),
  };
});

function renderLoginPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/teacher/login']}>
        <Routes>
          <Route path="/teacher/login" element={<TeacherLoginPage />} />
          <Route path="/teacher" element={<div>Area docente</div>} />
          <Route path="/teacher/change-password" element={<div>Cambia password</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TeacherLoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an inline error when fields are missing', async () => {
    renderLoginPage();

    fireEvent.submit(screen.getByRole('button', { name: 'Accedi' }).closest('form')!);

    expect(screen.getByText('Compila tutti i campi.')).toBeInTheDocument();
    expect(teacherLogin).not.toHaveBeenCalled();
  });

  it('saves the Teacher session and opens the Teacher area after login', async () => {
    vi.mocked(teacherLogin).mockResolvedValue({
      token: 'teacher-token',
      teacher_id: 12,
      role: 'teacher',
      email: 'docente@scuola.edu.it',
      display_name: 'Docente Test',
    });

    renderLoginPage();

    await userEvent.type(screen.getByLabelText('Email'), '  DOCENTE@SCUOLA.EDU.IT  ');
    await userEvent.type(screen.getByLabelText('Password'), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: 'Accedi' }));

    await waitFor(() => {
      expect(teacherLogin).toHaveBeenCalledWith('docente@scuola.edu.it', 'Password123!');
    });
    expect(saveTeacherSession).toHaveBeenCalledWith({
      token: 'teacher-token',
      teacher_id: 12,
      role: 'teacher',
      email: 'docente@scuola.edu.it',
      display_name: 'Docente Test',
    });
    expect(await screen.findByText('Area docente')).toBeInTheDocument();
  });

  it('opens the password-change flow when required', async () => {
    vi.mocked(teacherLogin).mockResolvedValue({
      token: '',
      teacher_id: 12,
      role: 'teacher',
      email: 'docente@scuola.edu.it',
      display_name: 'Docente Test',
      must_change_password: true,
      change_token: 'change-token',
    });

    renderLoginPage();

    await userEvent.type(screen.getByLabelText('Email'), 'docente@scuola.edu.it');
    await userEvent.type(screen.getByLabelText('Password'), 'TempPass123!');
    await userEvent.click(screen.getByRole('button', { name: 'Accedi' }));

    expect(await screen.findByText('Cambia password')).toBeInTheDocument();
    expect(saveTeacherSession).not.toHaveBeenCalled();
  });

  it('does not render Google login when no client id is configured', () => {
    renderLoginPage();

    expect(screen.queryByText('oppure')).not.toBeInTheDocument();
    expect(teacherGoogleLogin).not.toHaveBeenCalled();
  });
});
