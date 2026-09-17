import { CountryCode, COUNTRIES, isSupportedCountry } from './countries';

/**
 * The plan catalog — the one place the Free / Plus / Pro matrix and the
 * per-country prices live. Served by `GET /api/meta/plans` so both clients
 * render the same thing and a price change never needs an app release.
 *
 * Today only the Free plan is real: `PURCHASING.enabled` is false and every
 * owner is on Free. Flipping it server-side is what turns the Pricing page
 * and the mobile Plans screen from "coming soon" into a checkout — old
 * binaries follow without an update (backend non-negotiable #2).
 *
 * The full design — gateways, tax, trials, grace, the per-country traps —
 * is in `docs/subscriptions-and-payments-plan.md`. Only what a client needs
 * to *show* lives here.
 */

export const PLAN_IDS = ['free', 'plus', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanLimits {
  maxGaragesPerOwner: number;
  maxJobCardsPerGaragePerDay: number;
  maxInvoicesPerGaragePerDay: number;
  maxStaffPerGarage: number;
}

/** `null` renders as "Unlimited". */
export type DisplayLimit = number | null;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  limits: PlanLimits;
  /** What the plan cards list, in order. Plain text — no emoji. */
  features: string[];
}

const UNLIMITED = Number.MAX_SAFE_INTEGER;

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Run a small garage from your phone.',
    limits: {
      maxGaragesPerOwner: 2,
      maxJobCardsPerGaragePerDay: 3,
      maxInvoicesPerGaragePerDay: 3,
      maxStaffPerGarage: 2
    },
    features: [
      '2 branches',
      '3 job cards and 3 invoices a day per branch',
      '2 staff per branch',
      'Service reminders by email',
      'Estimation approval link for customers',
      'Dashboard for today and the last 7 days'
    ]
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    tagline: 'For a busy workshop with a team.',
    limits: {
      maxGaragesPerOwner: 3,
      maxJobCardsPerGaragePerDay: 10,
      maxInvoicesPerGaragePerDay: 10,
      maxStaffPerGarage: 8
    },
    features: [
      '3 branches',
      '10 job cards and 10 invoices a day per branch',
      '8 staff per branch',
      'Service reminders by email and SMS',
      'Your logo on invoices, no GaragePulse footer',
      'Dashboard with 90 days of charts',
      'Export customers and invoices to CSV',
      'Email support within 2 business days'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'For multi-branch operators.',
    limits: {
      maxGaragesPerOwner: 10,
      maxJobCardsPerGaragePerDay: UNLIMITED,
      maxInvoicesPerGaragePerDay: UNLIMITED,
      maxStaffPerGarage: UNLIMITED
    },
    features: [
      '10 branches',
      'Unlimited job cards, invoices and staff',
      'Service reminders by email, SMS and WhatsApp',
      'Custom invoice template with local-language labels',
      'Full dashboard history and export',
      'Priority support'
    ]
  }
};

/** The Free limits under the name the usecases have always imported. */
export const FREE_PLAN_LIMITS = PLANS.free.limits;

/** Whether a plan cap is "unlimited" — the sentinel never leaves the server. */
export const isUnlimited = (value: number): boolean => value >= UNLIMITED;

// ─── Prices ───────────────────────────────────────────────────────────────

/**
 * Fixed local price points per country, in the currency's **minor units**
 * (paise, fils, cents). Never a live FX conversion: a Dubai garage sees the
 * same AED price every month. BHD and KWD have 1000 minor units to the unit.
 *
 * These are placeholders at rough purchasing-power parity, to be set by the
 * owner of the business before purchasing is enabled.
 */
export interface PlanPrices {
  currency: string;
  /** Minor units per unit — 100 for most currencies, 1000 for BHD/KWD. */
  minorUnits: number;
  monthly: Record<Exclude<PlanId, 'free'>, number>;
  annual: Record<Exclude<PlanId, 'free'>, number>;
}

const annualOf = (monthly: number) => monthly * 10; // two months free

const priceTable = (currency: string, minorUnits: number, plus: number, pro: number): PlanPrices => ({
  currency,
  minorUnits,
  monthly: { plus, pro },
  annual: { plus: annualOf(plus), pro: annualOf(pro) }
});

export const PLAN_PRICES: Partial<Record<CountryCode, PlanPrices>> & { default: PlanPrices } = {
  IN: priceTable('INR', 100, 499_00, 999_00),
  LK: priceTable('LKR', 100, 2900_00, 5900_00),
  AE: priceTable('AED', 100, 49_00, 99_00),
  SA: priceTable('SAR', 100, 49_00, 99_00),
  BH: priceTable('BHD', 1000, 5_000, 10_000),
  QA: priceTable('QAR', 100, 49_00, 99_00),
  KW: priceTable('KWD', 1000, 4_000, 8_000),
  NP: priceTable('NPR', 100, 1290_00, 2590_00),
  default: priceTable('USD', 100, 9_00, 19_00)
};

/**
 * Purchasing is off. The message is what both clients show on the plan
 * buttons; it is served rather than compiled in so the wording — and the
 * flag — can change without a release.
 */
export const PURCHASING = {
  enabled: false,
  message: 'Paid subscriptions will be enabled soon. Everyone is on the Free plan until then.'
} as const;

// ─── Catalog ──────────────────────────────────────────────────────────────

export interface PlanCatalogEntry {
  id: PlanId;
  name: string;
  tagline: string;
  features: string[];
  limits: {
    maxGaragesPerOwner: DisplayLimit;
    maxJobCardsPerGaragePerDay: DisplayLimit;
    maxInvoicesPerGaragePerDay: DisplayLimit;
    maxStaffPerGarage: DisplayLimit;
  };
  /** Major units, already divided by `minorUnits`; 0 for Free. */
  price: { monthly: number; annual: number };
}

export interface PlanCatalog {
  country: string;
  currency: string;
  plans: PlanCatalogEntry[];
  purchasing: { enabled: boolean; message: string };
}

const forDisplay = (n: number): DisplayLimit => (isUnlimited(n) ? null : n);

/** The catalog a client renders, with prices resolved for one country. */
export const getPlanCatalog = (country?: string | null): PlanCatalog => {
  const code = isSupportedCountry(country) ? country : null;
  const prices = (code && PLAN_PRICES[code]) || PLAN_PRICES.default;

  return {
    country: code ?? 'default',
    currency: prices.currency,
    plans: PLAN_IDS.map(id => {
      const plan = PLANS[id];
      return {
        id,
        name: plan.name,
        tagline: plan.tagline,
        features: plan.features,
        limits: {
          maxGaragesPerOwner: forDisplay(plan.limits.maxGaragesPerOwner),
          maxJobCardsPerGaragePerDay: forDisplay(plan.limits.maxJobCardsPerGaragePerDay),
          maxInvoicesPerGaragePerDay: forDisplay(plan.limits.maxInvoicesPerGaragePerDay),
          maxStaffPerGarage: forDisplay(plan.limits.maxStaffPerGarage)
        },
        price: id === 'free'
          ? { monthly: 0, annual: 0 }
          : { monthly: prices.monthly[id] / prices.minorUnits, annual: prices.annual[id] / prices.minorUnits }
      };
    }),
    purchasing: { ...PURCHASING }
  };
};

/** Sanity for the price table: a listed country's currency must match its country entry. */
export const priceCurrencyMatchesCountry = (code: CountryCode): boolean =>
  !PLAN_PRICES[code] || PLAN_PRICES[code]!.currency === COUNTRIES[code].currency;
