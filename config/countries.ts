/**
 * Per-country presentation and seed defaults.
 *
 * `Garage.country` (ISO 3166-1 alpha-2) is the source of truth; everything
 * here is derived from it at read time by utils/locale.ts, with optional
 * per-garage overrides in `garage.settings`. Adding a new derived field is a
 * one-line change here and applies retroactively to every garage — no data
 * migration.
 *
 * Two categories of value, treated differently on purpose:
 *
 *  - PRESENTATION (currency, locale, labels, timezone) is resolved live, so
 *    correcting a wrong label here fixes it for every garage in that country.
 *  - SEED values (`defaultTaxRate`, `defaultLaborRatePerHour`) are copied onto
 *    the garage once at creation and then owned by the garage. They must NOT
 *    track this table: a VAT rate change must never retroactively alter an
 *    existing garage's configured rate, and historical invoices already
 *    snapshot their own rate on the job card.
 *
 * `defaultTaxRate` is a starting point for the owner to confirm, not tax
 * advice. Rates change and many jurisdictions vary by region or service type
 * (US sales tax especially — hence 0, which is the honest default there).
 *
 * Deliberately a curated list, not all 249 ISO codes: every entry needs
 * verified data, and an unbounded list means shipping untested formatting.
 */

export interface CountryConfig {
  name: string;
  /** ISO 4217 currency code, e.g. 'GBP'. */
  currency: string;
  /** BCP 47 locale used for number/date formatting, e.g. 'en-GB'. */
  locale: string;
  /** What this country calls its consumption tax, shown on invoices. */
  taxLabel: string;
  /** What this country calls a business tax registration number. */
  taxIdLabel: string;
  /** Seeded onto the garage at creation, then owner-editable. */
  defaultTaxRate: number;
  /** Seeded onto the garage at creation, then owner-editable. */
  defaultLaborRatePerHour: number;
  /** What this country calls a postal code. */
  postalLabel: string;
  /** Alphanumeric postcodes (GB, CA, IE...) must not get a numeric keypad. */
  postalInputMode: 'numeric' | 'text';
  /** Placeholder shown in phone inputs. */
  phoneExample: string;
  /** IANA zone, or null when the country spans several (owner must pick). */
  timezone: string | null;
}

export const DEFAULT_COUNTRY = 'IN';

export const COUNTRIES = {
  IN: {
    name: 'India',
    currency: 'INR', locale: 'en-IN',
    taxLabel: 'GST', taxIdLabel: 'GSTIN',
    defaultTaxRate: 18, defaultLaborRatePerHour: 500,
    postalLabel: 'Pincode', postalInputMode: 'numeric',
    phoneExample: '98765 43210', timezone: 'Asia/Kolkata',
  },
  US: {
    name: 'United States',
    currency: 'USD', locale: 'en-US',
    taxLabel: 'Sales Tax', taxIdLabel: 'EIN',
    // Sales tax varies by state/county and many services are untaxed —
    // 0 is the only honest default; the owner sets their real rate.
    defaultTaxRate: 0, defaultLaborRatePerHour: 100,
    postalLabel: 'ZIP Code', postalInputMode: 'numeric',
    phoneExample: '(555) 123-4567', timezone: null,
  },
  GB: {
    name: 'United Kingdom',
    currency: 'GBP', locale: 'en-GB',
    taxLabel: 'VAT', taxIdLabel: 'VAT No.',
    defaultTaxRate: 20, defaultLaborRatePerHour: 60,
    postalLabel: 'Postcode', postalInputMode: 'text',
    phoneExample: '07911 123456', timezone: 'Europe/London',
  },
  CA: {
    name: 'Canada',
    currency: 'CAD', locale: 'en-CA',
    taxLabel: 'GST/HST', taxIdLabel: 'GST/HST No.',
    defaultTaxRate: 5, defaultLaborRatePerHour: 100,
    postalLabel: 'Postal Code', postalInputMode: 'text',
    phoneExample: '(506) 234-5678', timezone: null,
  },
  AU: {
    name: 'Australia',
    currency: 'AUD', locale: 'en-AU',
    taxLabel: 'GST', taxIdLabel: 'ABN',
    defaultTaxRate: 10, defaultLaborRatePerHour: 100,
    postalLabel: 'Postcode', postalInputMode: 'numeric',
    phoneExample: '0412 345 678', timezone: null,
  },
  AE: {
    name: 'United Arab Emirates',
    currency: 'AED', locale: 'en-AE',
    taxLabel: 'VAT', taxIdLabel: 'TRN',
    defaultTaxRate: 5, defaultLaborRatePerHour: 150,
    postalLabel: 'PO Box', postalInputMode: 'text',
    phoneExample: '050 123 4567', timezone: 'Asia/Dubai',
  },
  SG: {
    name: 'Singapore',
    currency: 'SGD', locale: 'en-SG',
    taxLabel: 'GST', taxIdLabel: 'GST Reg. No.',
    defaultTaxRate: 9, defaultLaborRatePerHour: 80,
    postalLabel: 'Postal Code', postalInputMode: 'numeric',
    phoneExample: '8123 4567', timezone: 'Asia/Singapore',
  },
  NZ: {
    name: 'New Zealand',
    currency: 'NZD', locale: 'en-NZ',
    taxLabel: 'GST', taxIdLabel: 'IRD Number',
    defaultTaxRate: 15, defaultLaborRatePerHour: 90,
    postalLabel: 'Postcode', postalInputMode: 'numeric',
    phoneExample: '021 123 4567', timezone: 'Pacific/Auckland',
  },
  IE: {
    name: 'Ireland',
    currency: 'EUR', locale: 'en-IE',
    taxLabel: 'VAT', taxIdLabel: 'VAT No.',
    defaultTaxRate: 23, defaultLaborRatePerHour: 70,
    postalLabel: 'Eircode', postalInputMode: 'text',
    phoneExample: '085 123 4567', timezone: 'Europe/Dublin',
  },
  ZA: {
    name: 'South Africa',
    currency: 'ZAR', locale: 'en-ZA',
    taxLabel: 'VAT', taxIdLabel: 'VAT No.',
    defaultTaxRate: 15, defaultLaborRatePerHour: 450,
    postalLabel: 'Postal Code', postalInputMode: 'numeric',
    phoneExample: '071 123 4567', timezone: 'Africa/Johannesburg',
  },
  MY: {
    name: 'Malaysia',
    currency: 'MYR', locale: 'en-MY',
    taxLabel: 'SST', taxIdLabel: 'SST No.',
    defaultTaxRate: 8, defaultLaborRatePerHour: 80,
    postalLabel: 'Postcode', postalInputMode: 'numeric',
    phoneExample: '012-345 6789', timezone: 'Asia/Kuala_Lumpur',
  },
  KE: {
    name: 'Kenya',
    currency: 'KES', locale: 'en-KE',
    taxLabel: 'VAT', taxIdLabel: 'KRA PIN',
    defaultTaxRate: 16, defaultLaborRatePerHour: 1500,
    postalLabel: 'Postal Code', postalInputMode: 'numeric',
    phoneExample: '0712 345678', timezone: 'Africa/Nairobi',
  },
  NG: {
    name: 'Nigeria',
    currency: 'NGN', locale: 'en-NG',
    taxLabel: 'VAT', taxIdLabel: 'TIN',
    defaultTaxRate: 7.5, defaultLaborRatePerHour: 5000,
    postalLabel: 'Postal Code', postalInputMode: 'numeric',
    phoneExample: '0802 123 4567', timezone: 'Africa/Lagos',
  },
} as const satisfies Record<string, CountryConfig>;

export type CountryCode = keyof typeof COUNTRIES;

export const SUPPORTED_COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];

export const isSupportedCountry = (code?: string | null): code is CountryCode =>
  !!code && Object.prototype.hasOwnProperty.call(COUNTRIES, code);

/** Country list for pickers — no seed-only fields, which aren't UI concerns. */
export const getCountryOptions = () =>
  SUPPORTED_COUNTRY_CODES.map(code => ({
    code,
    name: COUNTRIES[code].name,
    currency: COUNTRIES[code].currency,
    taxLabel: COUNTRIES[code].taxLabel,
    taxIdLabel: COUNTRIES[code].taxIdLabel,
    postalLabel: COUNTRIES[code].postalLabel,
    postalInputMode: COUNTRIES[code].postalInputMode,
    phoneExample: COUNTRIES[code].phoneExample,
    /** True when the owner must choose a timezone (country spans several). */
    requiresTimezoneChoice: COUNTRIES[code].timezone === null,
  }));
