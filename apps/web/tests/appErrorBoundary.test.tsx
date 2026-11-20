import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppErrorBoundary from '@/components/layout/AppErrorBoundary';

function Crashes(): never {
  throw new Error('boom');
}

describe('AppErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders its children when nothing fails', () => {
    render(
      <AppErrorBoundary>
        <p>Cobros</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText('Cobros')).toBeInTheDocument();
  });

  it('shows a message with a reload button instead of a blank page', async () => {
    // React and the boundary both log the caught error; keep the output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });

    render(
      <AppErrorBoundary>
        <Crashes />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Algo salió mal al mostrar esta pantalla');
    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
