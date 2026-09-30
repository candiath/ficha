import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ThemeToggle from '@/components/layout/ThemeToggle';

// Se prueba el toggle con el ThemeProvider real: lo que importa es el
// contrato con index.css (la clase `dark` en <html>) y con el resto de la
// app (la elección sobrevive a un reload vía localStorage), no el menú.
function renderToggle() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

async function elegir(opcion: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Cambiar tema' }));
  await user.click(await screen.findByRole('menuitemradio', { name: opcion }));
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
  });

  it('elegir "Oscuro" pone la clase dark en <html> y la persiste', async () => {
    renderToggle();
    await elegir('Oscuro');

    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('elegir "Claro" saca la clase dark', async () => {
    localStorage.setItem('theme', 'dark');
    renderToggle();
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));

    await elegir('Claro');

    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('el menú marca la opción vigente', async () => {
    localStorage.setItem('theme', 'dark');
    renderToggle();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cambiar tema' }));

    expect(await screen.findByRole('menuitemradio', { name: 'Oscuro' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'Claro' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});
