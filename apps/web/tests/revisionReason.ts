import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// "Motivo del cambio" starts unchosen: a correction picks one before saving.
// `scope` is the dialog when there is one (a second field can be on the page).
export async function chooseReason(label = 'Error de confección', scope: HTMLElement = document.body): Promise<void> {
  await userEvent.click(within(scope).getByRole('combobox', { name: 'Motivo del cambio' }));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}
