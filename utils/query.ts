/**
 * Small query helpers shared by the list endpoints.
 */
import { ilike, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

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

/**
 * A multi-value filter as the list endpoints read it. Accepts one value
 * (`?status=new`, what every shipped client sends), a comma-separated list
 * (`?status=new,approved`) or a repeated key (`?status=new&status=approved`,
 * which Express parses to an array). Empty entries are dropped so
 * `?status=` still means "no filter". Order is preserved, duplicates removed.
 */
export const listParam = (raw: unknown): string[] => {
  const parts = (Array.isArray(raw) ? raw : [raw])
    .filter((v): v is string => typeof v === 'string')
    .flatMap(v => v.split(','))
    .map(v => v.trim())
    .filter(Boolean);
  return [...new Set(parts)];
};

/** Case-insensitive "contains" on one column. */
export const textMatches = (column: AnyPgColumn, term: string): SQL =>
  ilike(column, containsPattern(term));

/**
 * A plate match that ignores spacing on both sides: plates are stored the
 * way the counter typed them ("KL 07 BQ 4521") and searched the way people
 * say them ("kl07bq"). Falls back to a plain contains when the term has no
 * letters or digits to compare.
 */
export const plateMatches = (column: AnyPgColumn, term: string): SQL => {
  const compact = term.replace(/\s+/g, '');
  if (!compact) return textMatches(column, term);
  return sql`replace(${column}, ' ', '') ILIKE ${containsPattern(compact)}`;
};
