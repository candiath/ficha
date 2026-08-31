import { postureFamiliesSchema } from '@ficha/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PostureFamiliesTables } from '@/components/patients/PostureFamiliesTables';

// El componente dibuja la grilla a partir de POSTURE_TABLES (@ficha/shared) y
// emite el objeto anidado que la API valida con el schema derivado de esa misma
// definición. Estos tests cubren las dos mitades: que cada `kind` de columna se
// comporte como corresponde, y que lo emitido sea exactamente lo que el servidor
// aceptaría — sin eso, un cambio en el componente podría producir grillas que
// pasan por acá y rebotan con 400 recién en producción.

// El aria-label de una marca incluye su valor ("Fila 1, columna A: x"), así que
// se busca por prefijo: el nombre accesible cambia a medida que cicla.
const marca = (fila: string, col: string) =>
  screen.getByRole('button', { name: new RegExp(`^Fila ${fila}, columna ${col}:`) });

/** Renderiza en modo controlado y devuelve la última grilla emitida. */
function renderGrid() {
  const onChange = vi.fn();
  const view = render(<PostureFamiliesTables value={{}} onChange={onChange} />);
  const ultima = () => onChange.mock.lastCall?.[0];
  // Modo controlado: el padre no re-renderiza solo, así que reflejamos el
  // cambio a mano para poder encadenar clicks como lo haría el formulario.
  const reflejar = () => view.rerender(<PostureFamiliesTables value={ultima()} onChange={onChange} />);
  return { onChange, ultima, reflejar };
}

describe('PostureFamiliesTables', () => {
  it('cicla una marca vacío → x → X → vacío', async () => {
    const user = userEvent.setup();
    const { ultima, reflejar } = renderGrid();

    await user.click(marca('1', 'A'));
    expect(ultima()).toEqual({ tabla1: { '1': { A: 'x' } } });
    reflejar();

    await user.click(marca('1', 'A'));
    expect(ultima()).toEqual({ tabla1: { '1': { A: 'X' } } });
    reflejar();

    // Al volver a vacío no queda `{tabla1: {'1': {}}}`: la poda borra la celda,
    // la fila y la tabla, y la grilla vuelve a estar vacía de verdad.
    await user.click(marca('1', 'A'));
    expect(ultima()).toEqual({});
  });

  it('las columnas F6, I y ELR de la tabla 2 ciclan como las de la tabla 1', async () => {
    const user = userEvent.setup();
    const { ultima } = renderGrid();

    await user.click(marca('3', 'ELR'));
    expect(ultima()).toEqual({ tabla2: { '3': { ELR: 'x' } } });
  });

  it('la columna R es un checkbox y guarda true', async () => {
    const user = userEvent.setup();
    const { ultima, reflejar } = renderGrid();

    const checkbox = screen.getByRole('checkbox', { name: 'Fila 2, columna R' });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');

    await user.click(checkbox);
    expect(ultima()).toEqual({ tabla2: { '2': { R: true } } });
    reflejar();

    expect(screen.getByRole('checkbox', { name: 'Fila 2, columna R' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('el dropdown de Reeq guarda la opción elegida y cierra la lista', async () => {
    const user = userEvent.setup();
    const { ultima } = renderGrid();

    await user.click(screen.getByRole('button', { name: 'Fila 1, columna Reeq' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'XX' }));

    expect(ultima()).toEqual({ tabla2: { '1': { Reeq: 'XX' } } });
    // Base UI deja closeOnClick en false en RadioItem: sin activarlo, la lista
    // se quedaba abierta después de elegir.
    expect(screen.queryByRole('menuitemradio', { name: 'XX' })).not.toBeInTheDocument();
  });

  it('emite grillas que el schema de la API acepta', async () => {
    const user = userEvent.setup();
    const { ultima, reflejar } = renderGrid();

    await user.click(marca('5', 'P'));
    reflejar();
    await user.click(screen.getByRole('checkbox', { name: 'Fila 4, columna R' }));
    reflejar();
    await user.type(screen.getByRole('textbox', { name: 'Fila 1, columna Pistas' }), 'hola');

    expect(postureFamiliesSchema.safeParse(ultima()).success).toBe(true);
  });
});
