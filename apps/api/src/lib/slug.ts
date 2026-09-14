// Slug URL-safe a partir de un nombre: minúsculas, sin acentos, guiones.
// NFD separa cada letra acentuada en letra + diacrítico, y \p{M} borra
// esos diacríticos ("Clínica" → "clinica").
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Lo que produce slugify, y lo único que se acepta si alguien manda el slug
// a mano: tramos de [a-z0-9] separados por un guion.
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
