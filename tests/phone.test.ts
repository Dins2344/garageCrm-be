import { describe, it, expect } from 'vitest';
// Imported directly from utils (NOT via services/smsService) — tests/setup.ts
// mocks that whole module and stubs formatPhoneE164 as an identity function,
// so importing it from there would test nothing.
import { formatPhoneE164, isValidPhoneForCountry } from '../utils/phone';

describe('formatPhoneE164', () => {
  it('returns an empty string for empty input', () => {
    expect(formatPhoneE164('')).toBe('');
    expect(formatPhoneE164('   ')).toBe('');
  });

  // ── India: unchanged behaviour, since IN is still the default country ─────
  describe('India (the default country)', () => {
    it('passes through a number that already has the country code', () => {
      expect(formatPhoneE164('+919876543210')).toBe('+919876543210');
      expect(formatPhoneE164('+91 98765 43210')).toBe('+919876543210');
    });

    it('prepends +91 to a bare 10-digit Indian number', () => {
      expect(formatPhoneE164('9876543210')).toBe('+919876543210');
    });

    it('strips punctuation and spacing before formatting', () => {
      expect(formatPhoneE164('98765-43210')).toBe('+919876543210');
      expect(formatPhoneE164('(98765) 43210')).toBe('+919876543210');
    });
  });

  // ── The fix: these four replace the `known India-only defects` block that
  // pinned the old behaviour. Each previously produced a misrouted number.
  describe('other countries', () => {
    it('routes a bare UK mobile to +44, not +91', () => {
      // Was '+9107911123456' — a paid SMS to an unrelated Indian subscriber.
      expect(formatPhoneE164('07911123456', 'GB')).toBe('+447911123456');
    });

    it('routes a bare US number to +1, not +91', () => {
      // Was '+912125551234' — 10 digits made it look Indian.
      expect(formatPhoneE164('2125551234', 'US')).toBe('+12125551234');
    });

    it('normalises a full international number rather than passing it through verbatim', () => {
      // Was returned with its spaces intact, which is not valid E.164.
      expect(formatPhoneE164('+44 20 7946 0958')).toBe('+442079460958');
      expect(formatPhoneE164('+44 20 7946 0958', 'IN')).toBe('+442079460958');
    });

    it('accepts numbers from every supported country', () => {
      expect(formatPhoneE164('0412345678', 'AU')).toBe('+61412345678');
      expect(formatPhoneE164('0501234567', 'AE')).toBe('+971501234567');
      expect(formatPhoneE164('81234567', 'SG')).toBe('+6581234567');
    });
  });

  // ── The no-guess rule ─────────────────────────────────────────────────────
  describe('refuses to guess', () => {
    it('returns "" for input it cannot validate instead of inventing a prefix', () => {
      // Was '+9112345'. Returning '' makes the caller skip the send: a
      // misrouted SMS costs money and reaches a stranger, a skipped one is a
      // visible, safe failure.
      expect(formatPhoneE164('12345', 'GB')).toBe('');
      expect(formatPhoneE164('12345')).toBe('');
      expect(formatPhoneE164('not a phone number')).toBe('');
    });

    it('rejects a number that is valid elsewhere but not in the given country', () => {
      // An Indian mobile typed into a UK garage's customer record.
      expect(formatPhoneE164('9876543210', 'GB')).toBe('');
    });

    it('honours an explicit + prefix over the supplied country', () => {
      // The country is only a default for BARE numbers; it must never
      // override a country code the user actually typed.
      expect(formatPhoneE164('+447911123456', 'IN')).toBe('+447911123456');
      expect(formatPhoneE164('+919876543210', 'GB')).toBe('+919876543210');
    });

    it('tolerates a lowercase or unknown country code without throwing', () => {
      expect(formatPhoneE164('07911123456', 'gb')).toBe('+447911123456');
      expect(formatPhoneE164('9876543210', 'ZZ')).toBe('');
    });
  });
});

describe('isValidPhoneForCountry', () => {
  it('mirrors whether a number could be formatted', () => {
    expect(isValidPhoneForCountry('9876543210', 'IN')).toBe(true);
    expect(isValidPhoneForCountry('07911123456', 'GB')).toBe(true);
    expect(isValidPhoneForCountry('9876543210', 'GB')).toBe(false);
    expect(isValidPhoneForCountry('', 'IN')).toBe(false);
  });
});
