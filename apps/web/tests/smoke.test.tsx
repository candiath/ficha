import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';

// Smoke test de la infraestructura: si esto pasa, vitest levanta jsdom,
// el alias @/ resuelve, y testing-library monta componentes de React.
describe('infraestructura de tests', () => {
  it('renderiza un componente y lo encuentra en el DOM', () => {
    render(<Button>Guardar</Button>);

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
  });
});
