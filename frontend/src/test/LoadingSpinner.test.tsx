import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingSpinner from '../components/LoadingSpinner';

describe('LoadingSpinner', () => {
  it('renders a spinner with default message', () => {
    render(<LoadingSpinner />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders a custom message', () => {
    render(<LoadingSpinner message="Sto caricando i dati..." />);
    expect(screen.getByText('Sto caricando i dati...')).toBeInTheDocument();
  });
});
