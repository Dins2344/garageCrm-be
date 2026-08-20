/**
 * Locale-aware money / date / number formatting.
 *
 * Every value is formatted against the GARAGE's resolved locale (see
 * utils/locale.ts), never the server's locale or the reader's device. An
 * invoice must look the same to the garage that issued it, the customer who
 * receives the email, and the PDF archived six months later.
 */

export interface FormatLocale {
  locale: string;
  currency: string;
  timezone?: string;
}

/**
 * ICU inserts a non-breaking space (U+00A0) or narrow NBSP (U+202F) between a
 * currency symbol/code and the digits, and engines disagree about which. Those
 * bytes are invisible but they break string assertions and can render as a
 * missing glyph in PDF fonts, so normalise them to a plain space everywhere.
 */
const normalizeSpaces = (s: string): string => s.replace(/[\u00a0\u202f]/g, ' ');

/**
 * Format an amount as currency.
 *
 * `display: 'code'` yields "INR 1,234.00" instead of "₹1,234.00" — required
 * for PDFs, where PDFKit's built-in Helvetica has no glyph for ₹ (and most
 * other non-Latin currency symbols). That's why the old code hardcoded "Rs.".
 */
export const formatMoney = (
  amount: number | undefined | null,
  { locale, currency }: FormatLocale,
  opts: { display?: 'symbol' | 'code' } = {}
): string => {
  const value = Number(amount) || 0;
  try {
    return normalizeSpaces(
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        currencyDisplay: opts.display === 'code' ? 'code' : 'symbol',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value)
    );
  } catch {
    // Unknown locale or currency code — still produce something sane rather
    // than throwing inside a PDF/email render.
    return `${currency} ${value.toFixed(2)}`;
  }
};

/** Plain number with locale grouping — odometer readings, counts. */
export const formatNumber = (
  value: number | undefined | null,
  { locale }: Pick<FormatLocale, 'locale'>
): string => {
  const n = Number(value) || 0;
  try {
    return normalizeSpaces(new Intl.NumberFormat(locale).format(n));
  } catch {
    return String(n);
  }
};

const DEFAULT_DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

/** Format a date in the garage's locale and timezone. */
export const formatDate = (
  date: Date | string | number | undefined | null,
  { locale, timezone }: Pick<FormatLocale, 'locale'> & { timezone?: string },
  opts: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTS
): string => {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return normalizeSpaces(
      new Intl.DateTimeFormat(locale, { ...opts, ...(timezone ? { timeZone: timezone } : {}) }).format(d)
    );
  } catch {
    return d.toISOString().slice(0, 10);
  }
};

/**
 * The wall-clock hour (0-23) in a given IANA timezone, right now.
 * Used by the reminder cron to decide whether it's local sending time.
 */
export const hourInTimezone = (date: Date, timezone: string): number => {
  try {
    const hour = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    }).format(date);
    return Number(hour) % 24;
  } catch {
    return date.getUTCHours();
  }
};
