import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorDisplay from '../components/ErrorDisplay';

describe('ErrorDisplay', () => {
  it('renders the error message', () => {
    render(<ErrorDisplay message="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders a custom title distinct from message', () => {
    render(<ErrorDisplay message="Il server non risponde" title="Errore di connessione" />);
    expect(screen.getByText('Errore di connessione')).toBeInTheDocument();
    expect(screen.getByText('Il server non risponde')).toBeInTheDocument();
  });

  it('returns null when message is null', () => {
    const { container } = render(<ErrorDisplay message={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when message is undefined', () => {
    const { container } = render(<ErrorDisplay message={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('returns null when message is empty string', () => {
    const { container } = render(<ErrorDisplay message="" />);
    expect(container.innerHTML).toBe('');
  });
});
