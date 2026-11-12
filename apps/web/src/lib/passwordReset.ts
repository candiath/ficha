// Password reset links (docs/specs/SPEC-password-reset.md): what the clinic's
// Usuarios card and the platform's tenant detail page share.

// The effects happen when the link is generated, not when it is used: the
// confirmation says so before the ADMIN or the operator commits to it.
export function passwordResetConfirmation(name: string, neverLoggedIn = false) {
  // Someone who never logged in has no password or session to cut: the link
  // is a new invitation, and the earlier one stops working.
  if (neverLoggedIn) {
    return {
      title: `¿Generar una nueva invitación para ${name}?`,
      description:
        'Su invitación anterior deja de servir. El nuevo enlace dura 24 horas y sirve una sola vez.',
    };
  }
  return {
    title: `¿Restablecer la contraseña de ${name}?`,
    description:
      'Se cierran todas sus sesiones y su contraseña actual deja de funcionar ya. El enlace dura 24 horas y sirve una sola vez.',
  };
}

// The token goes in the fragment, which browsers never send to a server: it
// reaches neither the host's logs nor a Referer header.
export function passwordResetUrl(token: string): string {
  return `${window.location.origin}/restablecer-contrasena#${token}`;
}

// Short ("7 oct, 10:56"): it goes in a badge that has to fit a phone.
export function formatResetExpiry(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}
