// A patient's name is two columns, given names and surnames (#238): the clinic
// finds and sorts patients by surname. Every DTO that names a patient keeps a
// display fullName, built here once so that no repository spells it its own way.
export const patientNameSelect = { firstName: true, lastName: true } as const;

export function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`;
}
