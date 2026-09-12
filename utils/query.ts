/**
 * Small query helpers shared by the list endpoints.
 */

/**
 * A `%term%` pattern for `ilike`, with the wildcard characters in the user's
 * term escaped so "50%" searches for a literal percent sign. Replaces the
 * `$regex: search, $options: 'i'` filters, which never escaped anything.
 */
export const containsPattern = (term: string): string =>
  `%${term.replace(/[\\%_]/g, ch => `\\${ch}`)}%`;

/** `page`/`limit` as the list endpoints have always read them (1-based, strings allowed). */
export const pagination = (page: number | string = 1, limit: number | string = 20) => {
  const pageNumber = Math.max(1, Number(page) || 1);
  const limitNumber = Math.max(1, Number(limit) || 20);
  return { page: pageNumber, limit: limitNumber, offset: (pageNumber - 1) * limitNumber };
};
