/** The local-day window the free-plan daily quotas count within. */
export const todayRange = (): { start: Date; end: Date } => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

/** `YYYY-MM` for a date, in server-local time like the rest of the dashboard. */
export const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/**
 * The half-open range [first of the month, first of the next month) for a
 * `YYYY-MM` key, or null when the key is not one. Server-local, matching
 * `todayRange` and the dashboard's other windows.
 */
export const monthRange = (month: string): { start: Date; end: Date; key: string } | null => {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 1);
  return { start, end, key: month };
};

/** The `YYYY-MM` before a `YYYY-MM`. */
export const previousMonthKey = (month: string): string => {
  const range = monthRange(month);
  if (!range) return month;
  return monthKey(new Date(range.start.getFullYear(), range.start.getMonth() - 1, 1));
};
