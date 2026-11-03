// When an episode closed "now" closes: now, by the API's clock, but never
// before it opened. Both closes "now" go through here: a PATCH that closes with
// no date, and a discharge.
//
// The opening was stamped by another clock. Prisma's engine reads the system
// clock on its own for @default(now()), and on Windows that reading can be a
// millisecond ahead of Node's; an opening loaded through the API is a client's,
// and may be days ahead (clinicalDate.ts). A close "now" read before the
// opening would be refused by a PATCH and stored inverted by a discharge. For
// an episode that, by its own record, has only just opened, "now" is the
// instant it opened.
export function closingNow(openedAt: Date, now: Date = new Date()): Date {
  return now < openedAt ? openedAt : now;
}
