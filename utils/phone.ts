import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { DEFAULT_COUNTRY } from '../config/countries';
import logger from './logger';

const log = logger.child('Phone');

/**
 * Phone number formatting.
 *
 * Lives here rather than in services/smsService so it can be unit-tested:
 * tests/setup.ts mocks that whole module (including this function, as an
 * identity stub), which previously left the code that decides where a paid
 * SMS gets delivered with zero coverage. smsService re-exports it.
 */

/**
 * Convert a phone number to E.164 (`+<country><number>`), interpreting bare
 * local numbers using the garage's country.
 *
 * Returns `''` when the number cannot be parsed as a VALID number for that
 * country — callers MUST treat that as "skip the send", never as "try
 * anyway". This replaces the previous behaviour of blindly prefixing `+91`
 * to anything unrecognised, which turned a UK number typed as `07911123456`
 * into `+9107911123456` and either bounced at Twilio or delivered a paid
 * message to an unrelated Indian subscriber. A skipped send is a visible,
 * safe failure; a guessed one costs money and reaches a stranger.
 */
export const formatPhoneE164 = (phone: string, country: string = DEFAULT_COUNTRY): string => {
  if (!phone || !phone.trim()) return '';

  // A leading '+' means the number already carries its own country code, so
  // the default region is irrelevant (and must not override it).
  const hasExplicitCountryCode = phone.trim().startsWith('+');
  const parsed = hasExplicitCountryCode
    ? parsePhoneNumberFromString(phone.trim())
    : parsePhoneNumberFromString(phone.trim(), country.toUpperCase() as never);

  if (!parsed || !parsed.isValid()) {
    log.warn('Unparseable phone number — refusing to guess a country code', {
      country,
      // Log only the shape, never the full number.
      length: phone.replace(/\D/g, '').length
    });
    return '';
  }

  return parsed.number;
};

/** Whether a number is valid for the given country — used at registration. */
export const isValidPhoneForCountry = (phone: string, country: string = DEFAULT_COUNTRY): boolean =>
  formatPhoneE164(phone, country) !== '';
