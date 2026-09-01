/**
 * Fixtures for the sample garage seeded at registration.
 *
 * Why this exists: `registerNewGarage` used to create a User and a bare Garage
 * and nothing else, so a brand-new account landed on an empty dashboard, an
 * empty job card list and an empty customer list. To see the product do
 * anything at all you first had to invent a customer, invent a vehicle and
 * hand-build a job card. Almost nobody evaluating the app does that.
 *
 * Everything here is parameterised by the garage's country. Non-negotiable #4
 * forbids hardcoded currency, locale or country-specific formats, and seed data
 * is where that rule is easiest to break without noticing — an Indian licence
 * plate in a Manchester garage is exactly the kind of detail that makes a
 * product feel untested.
 *
 * Three techniques keep this table small instead of 13 hand-written variants:
 *
 *  1. **Phone numbers derive from `COUNTRIES[code].phoneExample`** by replacing
 *     its last two digits. The leading digits carry the mobile prefix, so
 *     keeping them means the result stays a valid-looking number in every
 *     country without a second table to maintain.
 *  2. **Part prices are multiples of the garage's own labour rate**, never
 *     currency amounts. `defaultLaborRatePerHour` is already calibrated per
 *     country (500 INR, 60 GBP, 100 USD), so a filter priced at 0.5x lands
 *     somewhere sensible everywhere, and a currency table never goes stale.
 *  3. **Customer names come from a region group**, not one global set. Five
 *     groups cover the thirteen supported countries.
 *
 * Vehicle makes are deliberately the four global volume brands. Those sell in
 * every supported market, which a region-specific model list would not.
 *
 * No emoji anywhere in this file — `00-shared-no-emoji.md` names seed data
 * explicitly, and these strings reach SMS bodies and PDFs.
 */

import { COUNTRIES, CountryCode } from './countries';
import { ComplaintPriority, FuelType, JobStatus, ServiceType } from '../types/domain';

// ── Region groups ─────────────────────────────────────────────────────────

type RegionGroup = 'south_asia' | 'gulf' | 'anglo' | 'africa' | 'sea';

const REGION_BY_COUNTRY: Record<CountryCode, RegionGroup> = {
  IN: 'south_asia',
  AE: 'gulf',
  GB: 'anglo', US: 'anglo', CA: 'anglo', AU: 'anglo', NZ: 'anglo', IE: 'anglo',
  ZA: 'africa', KE: 'africa', NG: 'africa',
  SG: 'sea', MY: 'sea',
};

/** Three customer names per region. Index order matches SAMPLE_CUSTOMERS. */
const NAMES_BY_REGION: Record<RegionGroup, [string, string, string]> = {
  south_asia: ['Rahul Sharma', 'Priya Nair', 'Imran Qureshi'],
  gulf:       ['Ahmed Al Mansouri', 'Fatima Hassan', 'Rajesh Menon'],
  anglo:      ['James Whitfield', 'Sarah O\'Connor', 'Daniel Osei'],
  africa:     ['Thabo Molefe', 'Amina Wanjiru', 'Chidi Okonkwo'],
  sea:        ['Wei Ming Tan', 'Nurul Aisyah', 'Arun Balakrishnan'],
};

/**
 * Four licence plates per country, in that country's real format. This is the
 * one thing that genuinely cannot be derived — plate syntax has no relationship
 * to any other field in the country table.
 */
const PLATES_BY_COUNTRY: Record<CountryCode, [string, string, string, string]> = {
  IN: ['KA 01 AB 4321', 'MH 12 CD 8765', 'DL 3C AE 1122', 'TN 09 BX 6543'],
  US: ['7ABC123', 'JKL 4592', 'BRT 8810', '5XYZ776'],
  GB: ['LM19 XKR', 'YD68 PWA', 'BV21 HZT', 'KS17 GNM'],
  CA: ['BXTK 449', 'CJHR 812', 'ANWP 236', 'DLQM 570'],
  AU: ['1QM 4RT', 'BXS 22K', '7CN 9PL', 'ZTR 68B'],
  AE: ['A 42815', 'F 73902', 'K 15640', 'M 90271'],
  SG: ['SLK 4821 X', 'SBM 7390 J', 'SDN 1265 R', 'SGT 8047 P'],
  NZ: ['MJK482', 'PBR719', 'TQD305', 'LHN864'],
  IE: ['191 D 24815', '202 KE 7390', '212 C 15640', '181 G 90271'],
  ZA: ['CA 421 815', 'GP 739 021', 'ND 156 402', 'EC 904 271'],
  MY: ['WVA 4821', 'BQM 7390', 'PGT 1265', 'JHD 8047'],
  KE: ['KDA 482K', 'KCP 739M', 'KBR 126T', 'KDG 804J'],
  NG: ['LSR 482 AB', 'ABJ 739 CD', 'KNO 126 EF', 'RVS 804 GH'],
};

// ── Fixture specs ─────────────────────────────────────────────────────────

export interface SampleCustomerSpec {
  /** Index into the region's name list. */
  nameIndex: 0 | 1 | 2;
  email: string;
  notes: string;
}

export interface SampleVehicleSpec {
  /** Which SAMPLE_CUSTOMERS entry owns this vehicle. */
  customerIndex: number;
  make: string;
  model: string;
  year: number;
  color: string;
  fuelType: FuelType;
  odometer: number;
}

export interface SampleJobCardSpec {
  /** Which SAMPLE_VEHICLES entry this job is for. */
  vehicleIndex: number;
  serviceType: ServiceType;
  status: JobStatus;
  complaints: { description: string; priority: ComplaintPriority }[];
  /** Labour lines, priced as `hours x the garage's own rate`. */
  labor: { description: string; hours: number }[];
  /** Parts, priced as `rateMultiple x the garage's labour rate`. See header. */
  parts: { partName: string; quantity: number; rateMultiple: number }[];
  /** Days before now this job was opened, so the list is not all one date. */
  daysAgo: number;
  estimationApproved: boolean;
}

export const SAMPLE_CUSTOMERS: SampleCustomerSpec[] = [
  { nameIndex: 0, email: '', notes: 'Sample customer. Prefers a call before any extra work.' },
  { nameIndex: 1, email: '', notes: 'Sample customer.' },
  { nameIndex: 2, email: '', notes: 'Sample customer. Fleet account.' },
];

/**
 * Customer 0 owns two vehicles on purpose — it is the only way the customer
 * list's vehicle count renders anything other than 1, and that count is
 * denormalised onto `Customer.vehicles`, so it is worth exercising.
 */
export const SAMPLE_VEHICLES: SampleVehicleSpec[] = [
  { customerIndex: 0, make: 'Toyota',  model: 'Corolla', year: 2019, color: 'White',  fuelType: 'petrol', odometer: 64200 },
  { customerIndex: 0, make: 'Hyundai', model: 'i20',     year: 2021, color: 'Blue',   fuelType: 'petrol', odometer: 28750 },
  { customerIndex: 1, make: 'Honda',   model: 'Civic',   year: 2017, color: 'Silver', fuelType: 'diesel', odometer: 98400 },
  { customerIndex: 2, make: 'Ford',    model: 'Ranger',  year: 2022, color: 'Grey',   fuelType: 'diesel', odometer: 41300 },
];

/**
 * Five job cards spanning five statuses. The spread is the point: it is what
 * makes StatusStepper, the dashboard counters and the invoice list each render
 * something real rather than an empty state.
 *
 * The 'delivered' card is last and is the one an invoice is raised against.
 */
export const SAMPLE_JOB_CARDS: SampleJobCardSpec[] = [
  {
    vehicleIndex: 0,
    serviceType: 'service',
    status: 'new',
    daysAgo: 0,
    estimationApproved: false,
    complaints: [{ description: 'Due for scheduled service at 65,000 km', priority: 'medium' }],
    labor: [{ description: 'General service and inspection', hours: 2 }],
    parts: [
      { partName: 'Engine oil (4L)', quantity: 1, rateMultiple: 1.2 },
      { partName: 'Oil filter', quantity: 1, rateMultiple: 0.5 },
    ],
  },
  {
    vehicleIndex: 2,
    serviceType: 'repair',
    status: 'approved',
    daysAgo: 2,
    estimationApproved: true,
    complaints: [
      { description: 'Squealing noise from front wheels when braking', priority: 'high' },
      { description: 'Steering pulls slightly to the left', priority: 'medium' },
    ],
    labor: [{ description: 'Front brake pad replacement', hours: 1.5 }, { description: 'Wheel alignment', hours: 1 }],
    parts: [{ partName: 'Front brake pad set', quantity: 1, rateMultiple: 1.8 }],
  },
  {
    vehicleIndex: 1,
    serviceType: 'repair',
    status: 'in_progress',
    daysAgo: 3,
    estimationApproved: true,
    complaints: [{ description: 'Air conditioning not cooling', priority: 'high' }],
    labor: [{ description: 'AC diagnostics and regas', hours: 2.5 }],
    parts: [{ partName: 'AC compressor belt', quantity: 1, rateMultiple: 0.9 }],
  },
  {
    vehicleIndex: 3,
    serviceType: 'accident',
    status: 'ready_for_pickup',
    daysAgo: 6,
    estimationApproved: true,
    complaints: [{ description: 'Rear bumper damage from a low-speed collision', priority: 'urgent' }],
    labor: [{ description: 'Bumper removal, repair and refit', hours: 4 }, { description: 'Paint and finish', hours: 3 }],
    parts: [{ partName: 'Rear bumper clip set', quantity: 2, rateMultiple: 0.3 }],
  },
  {
    vehicleIndex: 0,
    serviceType: 'service',
    status: 'delivered',
    daysAgo: 21,
    estimationApproved: true,
    complaints: [{ description: 'Battery weak on cold starts', priority: 'medium' }],
    labor: [{ description: 'Battery test and replacement', hours: 1 }],
    parts: [{ partName: 'Battery 12V 45Ah', quantity: 1, rateMultiple: 2.4 }],
  },
];

// ── Derivations ───────────────────────────────────────────────────────────

/**
 * A country-plausible phone number, unique per index within the garage.
 *
 * Replaces the final two digits of the country's own `phoneExample`, so the
 * mobile prefix (which is what makes a number look real, and what
 * `isValidPhoneForCountry` checks on the registration path) is preserved for
 * every country without a second table.
 */
export const samplePhone = (country: CountryCode, index: number): string => {
  const suffix = String(index + 1).padStart(2, '0');
  const chars = COUNTRIES[country].phoneExample.split('');
  let replaced = 0;

  for (let i = chars.length - 1; i >= 0 && replaced < 2; i--) {
    if (/\d/.test(chars[i])) {
      chars[i] = suffix[suffix.length - 1 - replaced];
      replaced++;
    }
  }
  return chars.join('');
};

export const sampleCustomerName = (country: CountryCode, nameIndex: 0 | 1 | 2): string =>
  NAMES_BY_REGION[REGION_BY_COUNTRY[country]][nameIndex];

export const samplePlate = (country: CountryCode, vehicleIndex: number): string =>
  PLATES_BY_COUNTRY[country][vehicleIndex % PLATES_BY_COUNTRY[country].length];

/**
 * Part price for a country, from the garage's own labour rate. Rounded to 2dp
 * because it feeds the estimation totals, which the clients mirror to 2dp.
 */
export const samplePartPrice = (laborRatePerHour: number, rateMultiple: number): number =>
  Math.round(laborRatePerHour * rateMultiple * 100) / 100;

/** Banner and list copy use this, so both clients say the same thing. */
export const SAMPLE_DATA_NOTE = 'Sample data';
