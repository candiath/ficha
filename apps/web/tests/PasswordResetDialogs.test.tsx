import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PasswordResetLinkDialog,
  PendingResetBadge,
} from '@/components/clinic/PasswordResetDialogs';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';

const LINK = { token: 'tok_abc', expiresAt: '2026-10-07T15:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PasswordResetLinkDialog', () => {
  it('is closed without a link', () => {
    render(<PasswordResetLinkDialog link={null} name="Colega" onClose={vi.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('without a clipboard, leaves the link selected to copy by hand', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<PasswordResetLinkDialog link={LINK} name="Colega" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(toast.error).toHaveBeenCalledWith('No se pudo copiar: copialo a mano');
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionEnd! - input.selectionStart!).toBe(input.value.length);
  });

  it('closing calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PasswordResetLinkDialog link={LINK} name="Colega" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Listo' }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe('PendingResetBadge', () => {
  it('renders nothing without an expiry', () => {
    const { container } = render(<PendingResetBadge expiresAt={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
