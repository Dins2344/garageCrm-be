import { describe, it, expect } from 'vitest';
import { formatMoney, formatNumber, formatDate, hourInTimezone } from '../utils/format';

const IN = { locale: 'en-IN', currency: 'INR', timezone: 'Asia/Kolkata' };
const GB = { locale: 'en-GB', currency: 'GBP', timezone: 'Europe/London' };

describe('formatMoney', () => {
  it('uses the currency code for PDFs (Helvetica has no ₹ glyph)', () => {
    expect(formatMoney(1234, IN, { display: 'code' })).toBe('INR 1,234.00');
    expect(formatMoney(1234, GB, { display: 'code' })).toBe('GBP 1,234.00');
  });

  it('uses the symbol elsewhere (HTML email, clients)', () => {
    expect(formatMoney(1234, IN)).toBe('₹1,234.00');
    expect(formatMoney(1234, GB)).toBe('£1,234.00');
  });

  it('preserves Indian lakh/crore grouping', () => {
    expect(formatMoney(1234567, IN, { display: 'code' })).toBe('INR 12,34,567.00');
    // The same amount groups in thousands under en-GB.
    expect(formatMoney(1234567, GB, { display: 'code' })).toBe('GBP 1,234,567.00');
  });

  it('always shows exactly two decimals', () => {
    expect(formatMoney(0, IN, { display: 'code' })).toBe('INR 0.00');
    expect(formatMoney(1234.5, IN, { display: 'code' })).toBe('INR 1,234.50');
  });

  it('treats null/undefined/NaN as zero rather than throwing', () => {
    expect(formatMoney(undefined, IN, { display: 'code' })).toBe('INR 0.00');
    expect(formatMoney(null, IN, { display: 'code' })).toBe('INR 0.00');
  });

  it('falls back readably for an unknown currency instead of throwing', () => {
    expect(formatMoney(12, { locale: 'en-GB', currency: 'NOT_A_CURRENCY' })).toBe('NOT_A_CURRENCY 12.00');
  });

  it('emits no non-breaking spaces (they break assertions and PDF glyphs)', () => {
    const outputs = [
      formatMoney(1234, IN), formatMoney(1234, IN, { display: 'code' }),
      formatMoney(1234, GB), formatMoney(1234, GB, { display: 'code' }),
      formatMoney(1234, { locale: 'fr-FR', currency: 'EUR' }),
    ];
    outputs.forEach(o => {
      expect(o).not.toMatch(/ /);
      expect(o).not.toMatch(/ /);
    });
  });
});

describe('formatNumber', () => {
  it('groups by locale', () => {
    expect(formatNumber(1234567, IN)).toBe('12,34,567');
    expect(formatNumber(1234567, GB)).toBe('1,234,567');
  });

  it('treats missing values as zero', () => {
    expect(formatNumber(undefined, IN)).toBe('0');
  });
});

describe('formatDate', () => {
  const d = new Date('2026-08-14T09:30:00Z');

  it('formats in the given locale', () => {
    expect(formatDate(d, IN)).toBe('14 August 2026');
    expect(formatDate(d, GB)).toBe('14 August 2026');
  });

  it('respects the timezone when deciding the calendar day', () => {
    // 2026-08-14T20:00Z is already the 15th in Auckland (UTC+12).
    const evening = new Date('2026-08-14T20:00:00Z');
    expect(formatDate(evening, { locale: 'en-NZ', timezone: 'Pacific/Auckland' })).toBe('15 August 2026');
    expect(formatDate(evening, { locale: 'en-GB', timezone: 'Europe/London' })).toBe('14 August 2026');
  });

  it('returns empty string for missing or invalid dates', () => {
    expect(formatDate(null, IN)).toBe('');
    expect(formatDate('not-a-date', IN)).toBe('');
  });
});

describe('hourInTimezone', () => {
  it('reports the local wall-clock hour', () => {
    const utcNoon = new Date('2026-08-14T12:00:00Z');
    expect(hourInTimezone(utcNoon, 'UTC')).toBe(12);
    expect(hourInTimezone(utcNoon, 'Asia/Kolkata')).toBe(17);   // +5:30
    expect(hourInTimezone(utcNoon, 'America/New_York')).toBe(8); // EDT, -4
  });

  it('handles the midnight wrap (24 -> 0)', () => {
    // 18:30 UTC is 00:00 next day in Kolkata; must be 0, never 24.
    expect(hourInTimezone(new Date('2026-08-14T18:30:00Z'), 'Asia/Kolkata')).toBe(0);
  });

  it('accounts for daylight saving', () => {
    const janNoon = new Date('2026-01-14T12:00:00Z');  // London on GMT
    const julNoon = new Date('2026-07-14T12:00:00Z');  // London on BST
    expect(hourInTimezone(janNoon, 'Europe/London')).toBe(12);
    expect(hourInTimezone(julNoon, 'Europe/London')).toBe(13);
  });

  it('falls back to UTC for an invalid timezone rather than throwing', () => {
    expect(hourInTimezone(new Date('2026-08-14T12:00:00Z'), 'Not/AZone')).toBe(12);
  });
});
