import { COUNTRIES, DEFAULT_COUNTRY, isSupportedCountry, type CountryCode } from '../config/countries';
import logger from './logger';

const log = logger.child('Locale');

/**
 * Everything a client (or the PDF/email/SMS layer) needs to render a garage's
 * numbers, dates and labels correctly. Sent to clients alongside garage/user
 * payloads so no client ever hardcodes a currency symbol or locale again.
 */
export interface ResolvedLocale {
  country: CountryCode;
  currency: string;
  locale: string;
  taxLabel: string;
  taxIdLabel: string;
  postalLabel: string;
  postalInputMode: 'numeric' | 'text';
  phoneExample: string;
  timezone: string;
}

/** Fallback when a garage spans multiple zones and the owner hasn't picked. */
const FALLBACK_TIMEZONE = 'UTC';

/**
 * Whether a string is an IANA zone this runtime recognises.
 *
 * Validated rather than trusted because the zone decides when reminder emails
 * go out: an unrecognised value falls back to UTC, which would send a US
 * garage's 09:00 reminders at 4am local.
 */
export const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Minimal shape needed to resolve — avoids importing the Mongoose document type. */
export interface LocaleSource {
  country?: string | null;
  settings?: {
    currency?: string | null;
    locale?: string | null;
    taxLabel?: string | null;
    timezone?: string | null;
  } | null;
}

/**
 * Resolve a garage's locale config: per-garage override wins, otherwise the
 * country table, otherwise India.
 *
 * Tolerates a MISSING `country` entirely — Mongoose defaults only apply on
 * write, so documents created before the field existed have no `country` key.
 * That's deliberate: the app is correct for every existing garage the moment
 * this deploys, and the backfill script is tidy-up rather than a cutover.
 */
export const resolveGarageLocale = (garage: LocaleSource | null | undefined): ResolvedLocale => {
  const raw = garage?.country;

  // An unknown code means data written by a newer build, or hand-edited data.
  // Fall back rather than throw — a wrong currency symbol is recoverable, a
  // 500 on every garage read is not.
  if (raw && !isSupportedCountry(raw)) {
    log.warn('Unknown garage country, falling back to default', { country: raw, fallback: DEFAULT_COUNTRY });
  }

  const country: CountryCode = isSupportedCountry(raw) ? raw : DEFAULT_COUNTRY;
  const base = COUNTRIES[country];
  const overrides = garage?.settings ?? {};

  // Empty string means "inherit" — that's the stored default for overrides.
  const pick = (override: string | null | undefined, fallback: string): string =>
    override && override.trim() ? override.trim() : fallback;

  return {
    country,
    currency: pick(overrides.currency, base.currency),
    locale: pick(overrides.locale, base.locale),
    taxLabel: pick(overrides.taxLabel, base.taxLabel),
    taxIdLabel: base.taxIdLabel,
    postalLabel: base.postalLabel,
    postalInputMode: base.postalInputMode,
    phoneExample: base.phoneExample,
    timezone: pick(overrides.timezone, base.timezone ?? FALLBACK_TIMEZONE),
  };
};
