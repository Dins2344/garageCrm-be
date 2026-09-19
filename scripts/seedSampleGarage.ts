import 'dotenv/config';
import { randomUUID } from 'crypto';
import { eq, count, sql } from 'drizzle-orm';
import connectDB, { db, closeDB } from '../config/db';
import {
  garages, users, customers, vehicles, jobCards, invoices, expenses,
  Estimation, StatusHistoryEntry, Complaint, EstimationPart, EstimationLabor
} from '../config/schema';
import { newId } from '../utils/ids';
import { hashPassword } from '../utils/password';
import { computeEstimationTotals } from '../usecases/jobCardUsecase';
import { ExpenseCategory, PaymentMethod } from '../types/domain';

/**
 * Fill one garage with fifteen months of realistic workshop history so demos
 * and screenshots have something to show: 1000 customers, 1500 vehicles,
 * about 12 job cards a day of which about 10 are invoiced, and a month-by-
 * month expense ledger.
 *
 * Deliberately writes straight to the tables rather than through the
 * usecases: the usecases stamp `now` on everything and enforce the free-plan
 * daily caps, and neither is wanted for back-dated history. Totals still come
 * from `computeEstimationTotals` so every figure matches what the clients
 * would have computed.
 *
 * Refuses to run against a garage that already has customers, so it cannot be
 * double-applied by accident.
 *
 * Usage:
 *   npx tsx scripts/seedSampleGarage.ts <owner-email> [password]
 *
 * The owner's password is reset to the given value (default below) and
 * printed, since the account it fills is a shared demo login.
 */

const DEFAULT_PASSWORD = 'Sample@1234';
const MONTHS_BACK = 15;
const CUSTOMER_COUNT = 1000;
const VEHICLE_COUNT = 1500;
const JOBS_PER_DAY = 12;
const INVOICES_PER_DAY = 10;
const TAX_RATE = 18;
const LABOR_RATE = 500;
const BATCH = 400;

// ─── Deterministic random ──────────────────────────────────────────────────
// Seeded so two runs on two databases produce the same demo data.

let seed = 20260919;
const rand = (): number => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
const chance = (p: number): boolean => rand() < p;
const shuffle = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// ─── Vocabulary ────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Arun', 'Anoop', 'Biju', 'Deepak', 'Faisal', 'Gopi', 'Hari', 'Jayan', 'Joseph', 'Kiran', 'Manoj', 'Nikhil',
  'Pradeep', 'Rahul', 'Rajesh', 'Ratheesh', 'Sajan', 'Sandeep', 'Shibu', 'Sreejith', 'Sunil', 'Suresh', 'Thomas',
  'Vinod', 'Vishnu', 'Abhilash', 'Ajmal', 'Aravind', 'Basil', 'Dinesh', 'Firoz', 'George', 'Jithin', 'Mahesh',
  'Noufal', 'Prakash', 'Renjith', 'Sabu', 'Shameer', 'Sijo', 'Anitha', 'Asha', 'Bindu', 'Deepa', 'Divya', 'Geetha',
  'Jisha', 'Lakshmi', 'Meera', 'Neethu', 'Nimmy', 'Priya', 'Remya', 'Reshma', 'Sangeetha', 'Shalini', 'Sindhu',
  'Smitha', 'Soumya', 'Sreeja', 'Suja', 'Veena', 'Vidya', 'Anjali', 'Athira', 'Fathima', 'Greeshma', 'Jincy',
  'Nisha', 'Rekha', 'Ramesh', 'Santhosh', 'Vijay', 'Karthik', 'Praveen', 'Ganesh', 'Murali', 'Sathish', 'Naveen'
];
const LAST_NAMES = [
  'Nair', 'Menon', 'Pillai', 'Kurup', 'Varma', 'Thomas', 'Mathew', 'George', 'Joseph', 'Varghese', 'Kurian',
  'Chacko', 'Abraham', 'Philip', 'Jacob', 'Rahman', 'Khan', 'Ali', 'Hameed', 'Basheer', 'Das', 'Kumar', 'Krishnan',
  'Raj', 'Mohan', 'Babu', 'Panicker', 'Warrier', 'Iyer', 'Reddy', 'Gowda', 'Shetty', 'Rao', 'Naidu', 'Sharma'
];
const CITIES: readonly [string, string, string][] = [
  ['Kochi', 'Kerala', '6820'], ['Thrissur', 'Kerala', '6800'], ['Kozhikode', 'Kerala', '6730'],
  ['Thiruvananthapuram', 'Kerala', '6950'], ['Kollam', 'Kerala', '6910'], ['Alappuzha', 'Kerala', '6880'],
  ['Kottayam', 'Kerala', '6860'], ['Palakkad', 'Kerala', '6780'], ['Kannur', 'Kerala', '6700'],
  ['Bengaluru', 'Karnataka', '5600'], ['Mysuru', 'Karnataka', '5700'], ['Coimbatore', 'Tamil Nadu', '6410'],
  ['Chennai', 'Tamil Nadu', '6000'], ['Mangaluru', 'Karnataka', '5750']
];
const STREETS = ['MG Road', 'NH Bypass', 'Temple Road', 'Church Street', 'Market Junction', 'Station Road',
  'Beach Road', 'College Road', 'Mini Bypass', 'Civil Station Road', 'Puthiyara', 'Kaloor', 'Edappally', 'Vyttila'];
const EMAIL_DOMAINS = ['gmail.com', 'gmail.com', 'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];

interface ModelSpec { make: string; model: string; fuel: string[]; weight: number; body: 'hatch' | 'sedan' | 'suv' | 'mpv' }
const MODELS: ModelSpec[] = [
  { make: 'Maruti Suzuki', model: 'Swift', fuel: ['petrol', 'petrol', 'diesel', 'cng'], weight: 9, body: 'hatch' },
  { make: 'Maruti Suzuki', model: 'Alto', fuel: ['petrol', 'cng'], weight: 7, body: 'hatch' },
  { make: 'Maruti Suzuki', model: 'Baleno', fuel: ['petrol', 'cng'], weight: 6, body: 'hatch' },
  { make: 'Maruti Suzuki', model: 'Dzire', fuel: ['petrol', 'diesel', 'cng'], weight: 6, body: 'sedan' },
  { make: 'Maruti Suzuki', model: 'Ertiga', fuel: ['petrol', 'cng'], weight: 4, body: 'mpv' },
  { make: 'Maruti Suzuki', model: 'Brezza', fuel: ['petrol', 'cng'], weight: 4, body: 'suv' },
  { make: 'Hyundai', model: 'i20', fuel: ['petrol', 'diesel'], weight: 7, body: 'hatch' },
  { make: 'Hyundai', model: 'i10', fuel: ['petrol', 'cng'], weight: 5, body: 'hatch' },
  { make: 'Hyundai', model: 'Creta', fuel: ['petrol', 'diesel'], weight: 6, body: 'suv' },
  { make: 'Hyundai', model: 'Verna', fuel: ['petrol', 'diesel'], weight: 3, body: 'sedan' },
  { make: 'Hyundai', model: 'Venue', fuel: ['petrol', 'diesel'], weight: 4, body: 'suv' },
  { make: 'Honda', model: 'City', fuel: ['petrol', 'diesel', 'hybrid'], weight: 5, body: 'sedan' },
  { make: 'Honda', model: 'Amaze', fuel: ['petrol', 'diesel'], weight: 3, body: 'sedan' },
  { make: 'Honda', model: 'Jazz', fuel: ['petrol'], weight: 2, body: 'hatch' },
  { make: 'Toyota', model: 'Innova Crysta', fuel: ['diesel'], weight: 5, body: 'mpv' },
  { make: 'Toyota', model: 'Fortuner', fuel: ['diesel'], weight: 2, body: 'suv' },
  { make: 'Toyota', model: 'Etios', fuel: ['petrol', 'diesel'], weight: 3, body: 'sedan' },
  { make: 'Toyota', model: 'Glanza', fuel: ['petrol'], weight: 2, body: 'hatch' },
  { make: 'Tata', model: 'Nexon', fuel: ['petrol', 'diesel', 'electric'], weight: 5, body: 'suv' },
  { make: 'Tata', model: 'Punch', fuel: ['petrol', 'cng'], weight: 4, body: 'suv' },
  { make: 'Tata', model: 'Tiago', fuel: ['petrol', 'cng', 'electric'], weight: 3, body: 'hatch' },
  { make: 'Tata', model: 'Harrier', fuel: ['diesel'], weight: 2, body: 'suv' },
  { make: 'Mahindra', model: 'XUV700', fuel: ['diesel', 'petrol'], weight: 3, body: 'suv' },
  { make: 'Mahindra', model: 'Scorpio', fuel: ['diesel'], weight: 4, body: 'suv' },
  { make: 'Mahindra', model: 'Bolero', fuel: ['diesel'], weight: 3, body: 'suv' },
  { make: 'Mahindra', model: 'Thar', fuel: ['diesel', 'petrol'], weight: 2, body: 'suv' },
  { make: 'Kia', model: 'Seltos', fuel: ['petrol', 'diesel'], weight: 4, body: 'suv' },
  { make: 'Kia', model: 'Sonet', fuel: ['petrol', 'diesel'], weight: 3, body: 'suv' },
  { make: 'Kia', model: 'Carens', fuel: ['petrol', 'diesel'], weight: 2, body: 'mpv' },
  { make: 'Volkswagen', model: 'Polo', fuel: ['petrol', 'diesel'], weight: 3, body: 'hatch' },
  { make: 'Volkswagen', model: 'Virtus', fuel: ['petrol'], weight: 1, body: 'sedan' },
  { make: 'Skoda', model: 'Rapid', fuel: ['petrol', 'diesel'], weight: 2, body: 'sedan' },
  { make: 'Skoda', model: 'Kushaq', fuel: ['petrol'], weight: 1, body: 'suv' },
  { make: 'Renault', model: 'Kwid', fuel: ['petrol'], weight: 3, body: 'hatch' },
  { make: 'Renault', model: 'Triber', fuel: ['petrol'], weight: 2, body: 'mpv' },
  { make: 'Nissan', model: 'Magnite', fuel: ['petrol'], weight: 2, body: 'suv' },
  { make: 'Ford', model: 'EcoSport', fuel: ['petrol', 'diesel'], weight: 3, body: 'suv' },
  { make: 'Ford', model: 'Figo', fuel: ['petrol', 'diesel'], weight: 2, body: 'hatch' },
  { make: 'MG', model: 'Hector', fuel: ['petrol', 'diesel'], weight: 1, body: 'suv' },
  { make: 'Chevrolet', model: 'Beat', fuel: ['petrol', 'diesel'], weight: 1, body: 'hatch' }
];
const MODEL_POOL: ModelSpec[] = MODELS.flatMap(m => Array<ModelSpec>(m.weight).fill(m));
const COLORS = ['White', 'White', 'White', 'Silver', 'Silver', 'Grey', 'Black', 'Red', 'Blue', 'Brown', 'Maroon', 'Orange', 'Green'];
const RTO_CODES = ['KL-07', 'KL-07', 'KL-07', 'KL-08', 'KL-39', 'KL-40', 'KL-41', 'KL-42', 'KL-43', 'KL-11', 'KL-01',
  'KL-05', 'KL-10', 'KL-13', 'KA-01', 'KA-03', 'KA-05', 'KA-19', 'TN-37', 'TN-01', 'TN-09'];
const PLATE_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

interface Job { type: 'service' | 'repair' | 'accident'; complaints: string[]; parts: [string, number, number][]; labor: [string, number][] }
// [name, unitPrice, qty] / [description, hours]. Body-size multiplier applied below.
const JOBS: Job[] = [
  { type: 'service', complaints: ['Periodic service due', 'General check-up'], parts: [['Engine oil 5W-30 (1L)', 550, 4], ['Oil filter', 320, 1], ['Air filter', 450, 1]], labor: [['Periodic service', 1.5]] },
  { type: 'service', complaints: ['Service due', 'Slight vibration at idle'], parts: [['Engine oil 5W-30 (1L)', 550, 4], ['Oil filter', 320, 1], ['Air filter', 450, 1], ['Cabin filter', 380, 1], ['Spark plugs (set)', 1200, 1]], labor: [['Major service', 2.5]] },
  { type: 'service', complaints: ['Oil change'], parts: [['Engine oil 5W-30 (1L)', 550, 4], ['Oil filter', 320, 1]], labor: [['Oil and filter change', 0.75]] },
  { type: 'service', complaints: ['Wheel alignment off', 'Steering pulls to left'], parts: [], labor: [['Wheel alignment and balancing', 1]] },
  { type: 'service', complaints: ['AC not cooling'], parts: [['AC gas refill (R134a)', 1800, 1], ['Cabin filter', 380, 1]], labor: [['AC service and gas top-up', 1.5]] },
  { type: 'service', complaints: ['Brake noise', 'Brakes feel soft'], parts: [['Front brake pads (set)', 1850, 1], ['Brake fluid DOT4 (500ml)', 420, 1]], labor: [['Brake pad replacement', 1.5], ['Brake bleeding', 0.5]] },
  { type: 'service', complaints: ['Coolant low warning'], parts: [['Coolant (1L)', 380, 3]], labor: [['Coolant flush and refill', 1]] },
  { type: 'service', complaints: ['Wiper not clearing'], parts: [['Wiper blades (pair)', 650, 1]], labor: [['Wiper replacement', 0.25]] },
  { type: 'service', complaints: ['Tyre worn out'], parts: [['Tyre 185/65 R15', 4200, 2]], labor: [['Tyre fitting and balancing', 1]] },
  { type: 'service', complaints: ['Tyres worn out', 'Vibration at speed'], parts: [['Tyre 185/65 R15', 4200, 4]], labor: [['Tyre fitting, balancing and alignment', 2]] },
  { type: 'repair', complaints: ['Car not starting', 'Battery dead'], parts: [['Battery 12V 45Ah', 5200, 1]], labor: [['Battery replacement and terminal cleaning', 0.5]] },
  { type: 'repair', complaints: ['Clutch slipping', 'Hard gear shift'], parts: [['Clutch plate and pressure plate set', 6500, 1], ['Release bearing', 900, 1]], labor: [['Clutch overhaul', 6]] },
  { type: 'repair', complaints: ['Engine overheating'], parts: [['Radiator fan motor', 3200, 1], ['Coolant (1L)', 380, 3], ['Thermostat', 850, 1]], labor: [['Cooling system repair', 3]] },
  { type: 'repair', complaints: ['Knocking sound from front suspension'], parts: [['Front shock absorber (pair)', 5400, 1], ['Link rod (pair)', 1100, 1]], labor: [['Suspension repair', 3]] },
  { type: 'repair', complaints: ['Check engine light on', 'Poor mileage'], parts: [['Oxygen sensor', 3800, 1], ['Spark plugs (set)', 1200, 1]], labor: [['Diagnostic scan', 0.5], ['Sensor replacement', 1]] },
  { type: 'repair', complaints: ['Alternator warning light'], parts: [['Alternator (reconditioned)', 7500, 1], ['Drive belt', 950, 1]], labor: [['Alternator replacement', 2.5]] },
  { type: 'repair', complaints: ['Power window not working'], parts: [['Window regulator motor', 2600, 1]], labor: [['Door trim removal and regulator replacement', 1.5]] },
  { type: 'repair', complaints: ['Squealing belt noise'], parts: [['Drive belt', 950, 1], ['Belt tensioner', 1800, 1]], labor: [['Belt and tensioner replacement', 1.5]] },
  { type: 'repair', complaints: ['Exhaust noise', 'Rattling under car'], parts: [['Silencer assembly', 4800, 1], ['Exhaust gasket', 250, 2]], labor: [['Exhaust replacement', 2]] },
  { type: 'repair', complaints: ['Starter motor grinding'], parts: [['Starter motor', 5600, 1]], labor: [['Starter motor replacement', 2]] },
  { type: 'repair', complaints: ['Rear brake noise', 'Handbrake weak'], parts: [['Rear brake shoes (set)', 1600, 1], ['Brake fluid DOT4 (500ml)', 420, 1]], labor: [['Rear brake overhaul', 2]] },
  { type: 'repair', complaints: ['Fuel smell in cabin'], parts: [['Fuel pump', 4900, 1], ['Fuel filter', 750, 1]], labor: [['Fuel system repair', 3]] },
  { type: 'repair', complaints: ['Headlight not working'], parts: [['Headlamp bulb H4', 450, 2]], labor: [['Bulb replacement', 0.5]] },
  { type: 'repair', complaints: ['Timing belt due at 80,000 km'], parts: [['Timing belt kit', 6800, 1], ['Water pump', 2900, 1], ['Coolant (1L)', 380, 3]], labor: [['Timing belt and water pump replacement', 5]] },
  { type: 'accident', complaints: ['Front bumper damaged in collision', 'Headlamp cracked'], parts: [['Front bumper', 6500, 1], ['Headlamp assembly', 7800, 1], ['Bumper grille', 1400, 1]], labor: [['Bumper and headlamp replacement', 3], ['Painting', 4]] },
  { type: 'accident', complaints: ['Rear-ended, boot lid dented', 'Tail lamp broken'], parts: [['Tail lamp assembly', 3400, 1], ['Rear bumper', 5800, 1]], labor: [['Denting', 4], ['Painting', 4], ['Rear bumper replacement', 1.5]] },
  { type: 'accident', complaints: ['Side scrape along driver door', 'Mirror broken'], parts: [['Door mirror assembly', 3200, 1], ['Paint and materials', 2500, 1]], labor: [['Denting and painting, two panels', 8]] },
  { type: 'accident', complaints: ['Windscreen cracked by stone'], parts: [['Laminated windscreen', 8500, 1], ['Windscreen sealant', 600, 1]], labor: [['Windscreen replacement', 2]] },
  { type: 'accident', complaints: ['Hit a pothole, wheel bent', 'Steering shaking'], parts: [['Alloy wheel 15in', 6200, 1], ['Tyre 185/65 R15', 4200, 1], ['Tie rod end', 900, 1]], labor: [['Wheel and tie rod replacement', 2], ['Alignment', 1]] }
];
const JOB_POOL: Job[] = JOBS.flatMap(j => Array<Job>(j.type === 'service' ? 5 : j.type === 'repair' ? 2 : 1).fill(j));
const BODY_MULT: Record<ModelSpec['body'], number> = { hatch: 1, sedan: 1.15, suv: 1.4, mpv: 1.35 };

const NOTES = ['', '', '', '', 'Customer waiting in lounge', 'Call before starting extra work', 'Regular customer, apply loyalty discount',
  'Insurance claim, keep old parts', 'Customer wants old parts returned', 'Second visit for the same complaint', 'Drop back to customer office by 6pm'];

interface MonthlyExpense { title: string; category: ExpenseCategory; lo: number; hi: number; per: number; method: PaymentMethod }
const MONTHLY_EXPENSES: MonthlyExpense[] = [
  { title: 'Workshop rent', category: 'rent', lo: 45000, hi: 45000, per: 1, method: 'bank_transfer' },
  { title: 'Staff salaries', category: 'salaries', lo: 185000, hi: 215000, per: 1, method: 'bank_transfer' },
  { title: 'KSEB electricity bill', category: 'utilities', lo: 9500, hi: 16500, per: 1, method: 'upi' },
  { title: 'Water and internet', category: 'utilities', lo: 2200, hi: 3400, per: 1, method: 'upi' },
  { title: 'Parts purchase', category: 'parts', lo: 18000, hi: 65000, per: 5, method: 'bank_transfer' },
  { title: 'Engine oil stock', category: 'parts', lo: 22000, hi: 38000, per: 1, method: 'bank_transfer' },
  { title: 'Consumables and shop supplies', category: 'other', lo: 2500, hi: 6500, per: 1, method: 'cash' },
  { title: 'Pickup and drop fuel', category: 'transport', lo: 3500, hi: 7500, per: 2, method: 'cash' },
  { title: 'Tool and equipment purchase', category: 'tools', lo: 4000, hi: 28000, per: 0.5, method: 'card' },
  { title: 'Local advertising', category: 'marketing', lo: 3000, hi: 12000, per: 0.4, method: 'upi' },
  { title: 'Waste oil disposal', category: 'other', lo: 1200, hi: 2400, per: 1, method: 'cash' }
];

// ─── Time helpers ──────────────────────────────────────────────────────────

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const addHours = (d: Date, h: number): Date => new Date(d.getTime() + h * HOUR);
const at = (day: Date, hour: number, minute: number): Date => {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const ymd = (d: Date): string => d.toISOString().slice(2, 10).replace(/-/g, '');
const entry = (status: string, by: string, when: Date, notes = ''): StatusHistoryEntry =>
  ({ status, changedBy: by, changedAt: when.toISOString(), notes });

// ─── Generators ────────────────────────────────────────────────────────────

const genPhone = (used: Set<string>): string => {
  for (;;) {
    const p = `${pick(['6', '7', '8', '9', '9', '9'])}${String(between(100000000, 999999999))}`;
    if (!used.has(p)) { used.add(p); return p; }
  }
};

const genPlate = (used: Set<string>, year: number): string => {
  for (;;) {
    const series = year < 2012 ? pick(PLATE_LETTERS.split('')) : pick(PLATE_LETTERS.split('')) + pick(PLATE_LETTERS.split(''));
    const p = `${pick(RTO_CODES)}-${series}-${String(between(1, 9999)).padStart(4, '0')}`;
    if (!used.has(p)) { used.add(p); return p; }
  }
};

async function insertBatched<T>(table: Parameters<typeof db.insert>[0], rows: T[], label: string): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(table).values(rows.slice(i, i + BATCH) as never);
    process.stdout.write(`\r  ${label}: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log();
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [email, password = DEFAULT_PASSWORD] = process.argv.slice(2);
  if (!email) {
    console.error('Usage: npx tsx scripts/seedSampleGarage.ts <owner-email> [password]');
    process.exit(1);
  }

  await connectDB();

  const owner = await db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
  if (!owner) throw new Error(`No user with email ${email}`);
  const garage = await db.query.garages.findFirst({ where: eq(garages.ownerId, owner._id) });
  if (!garage) throw new Error(`${email} does not own a garage`);

  const [{ existing }] = await db.select({ existing: count() }).from(customers).where(eq(customers.garageId, garage._id));
  if (existing > 0) throw new Error(`Garage "${garage.name}" already has ${existing} customers; refusing to seed twice.`);

  console.log(`Seeding "${garage.name}" (${garage._id}) owned by ${email}`);
  const garageId = garage._id;

  // Owner password and garage identity
  await db.update(users).set({ password: await hashPassword(password) }).where(eq(users._id, owner._id));
  await db.update(garages).set({
    address: { street: 'NH 66, Maradu', city: 'Kochi', state: 'Kerala', pincode: '682304' },
    gstNumber: garage.gstNumber || '32AAGCS1234K1ZV',
    settings: { ...garage.settings, taxRate: TAX_RATE, laborRatePerHour: LABOR_RATE }
  }).where(eq(garages._id, garageId));

  // Staff
  const staffHash = await hashPassword(password);
  const staffSpec: [string, 'admin' | 'service_advisor' | 'mechanic' | 'receptionist'][] = [
    ['Suresh Menon', 'admin'], ['Jithin Varghese', 'service_advisor'], ['Anjali Krishnan', 'service_advisor'],
    ['Sajan Thomas', 'mechanic'], ['Noufal Rahman', 'mechanic'], ['Ratheesh Kumar', 'mechanic'],
    ['Basil George', 'mechanic'], ['Shibu Nair', 'mechanic'], ['Neethu Pillai', 'receptionist']
  ];
  const domain = email.split('@')[1];
  const usedPhones = new Set<string>([owner.phone]);
  const staffRows = staffSpec.map(([name, role]) => ({
    _id: newId(), name, role, garageId, password: staffHash,
    email: `${name.toLowerCase().replace(/ /g, '.')}@${domain}`,
    phone: genPhone(usedPhones),
    createdAt: new Date(Date.now() - (MONTHS_BACK + 1) * 30 * DAY)
  }));
  // Reuse any staff already present under these emails (a partial earlier run).
  const missingStaff = [] as typeof staffRows;
  for (const s of staffRows) {
    const found = await db.query.users.findFirst({ columns: { _id: true }, where: eq(users.email, s.email) });
    if (found) s._id = found._id; else missingStaff.push(s);
  }
  if (missingStaff.length) await db.insert(users).values(missingStaff);
  const advisors = staffRows.filter(s => s.role === 'service_advisor').map(s => s._id);
  const mechanics = staffRows.filter(s => s.role === 'mechanic').map(s => s._id);
  const creators = [owner._id, ...advisors, staffRows[staffRows.length - 1]._id];
  console.log(`  staff: ${staffRows.length}`);

  // Timeline
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setMonth(start.getMonth() - MONTHS_BACK);
  start.setDate(1);
  const spanDays = Math.round((today.getTime() - start.getTime()) / DAY);

  // Customers, spread over the timeline so the "new customers" charts move.
  const usedEmails = new Set<string>();
  const customerRows = Array.from({ length: CUSTOMER_COUNT }, () => {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const [city, state, pin] = pick(CITIES);
    let mail = '';
    if (chance(0.6)) {
      mail = `${first}.${last}${chance(0.5) ? between(1, 99) : ''}@${pick(EMAIL_DOMAINS)}`.toLowerCase();
      if (usedEmails.has(mail)) mail = mail.replace('@', `${between(100, 999)}@`);
      usedEmails.add(mail);
    }
    // Front-loaded: most customers were on the books before the window opens.
    const createdAt = chance(0.35)
      ? new Date(start.getTime() - between(30, 900) * DAY)
      : new Date(start.getTime() + Math.floor(rand() * spanDays) * DAY + between(9, 18) * HOUR);
    return {
      _id: newId(), garageId, name: `${first} ${last}`, phone: genPhone(usedPhones), email: mail,
      address: { street: `${between(1, 240)}, ${pick(STREETS)}`, city, state, pincode: `${pin}${between(10, 99)}` },
      notes: chance(0.08) ? pick(['Prefers WhatsApp updates', 'Fleet owner, three cars', 'Always asks for genuine parts only', 'Pays by UPI']) : '',
      totalVisits: 0, totalSpent: 0, createdAt, updatedAt: createdAt
    };
  });

  // Vehicles: every customer gets one; the remainder go to random customers.
  const usedPlates = new Set<string>();
  const ownerOf = [...customerRows, ...Array.from({ length: VEHICLE_COUNT - CUSTOMER_COUNT }, () => pick(customerRows))];
  const vehicleRows = ownerOf.map(c => {
    const spec = pick(MODEL_POOL);
    const year = between(2008, 2025);
    const createdAt = new Date(Math.max(c.createdAt.getTime(), start.getTime() - 900 * DAY) + between(0, 3) * DAY);
    return {
      _id: newId(), garageId, customerId: c._id,
      licensePlate: genPlate(usedPlates, year), make: spec.make, model: spec.model, year,
      color: pick(COLORS), fuelType: pick(spec.fuel),
      vin: chance(0.5) ? `MA3${String(between(10000000, 99999999))}${String(between(100000, 999999))}` : '',
      engineNumber: chance(0.4) ? `K${between(10, 15)}B${String(between(1000000, 9999999))}` : '',
      currentOdometerReading: Math.round(between(8000, 140000) * (2026 - year) / 12),
      createdAt, updatedAt: createdAt,
      // seed-only bookkeeping
      body: spec.body, customerCreatedAt: c.createdAt
    };
  });
  await insertBatched(customers, customerRows, 'customers');
  await insertBatched(vehicles, vehicleRows.map(({ body: _b, customerCreatedAt: _c, ...v }) => v), 'vehicles');

  // Job cards + invoices, day by day.
  type JobRow = typeof jobCards.$inferInsert;
  type InvRow = typeof invoices.$inferInsert;
  const jobRows: JobRow[] = [];
  const invRows: InvRow[] = [];
  const odo = new Map<string, number>(vehicleRows.map((v): [string, number] => [v._id, Math.round(v.currentOdometerReading * 0.7)]));
  let jcSeq = 0;
  let invSeq = 0;
  const now = Date.now();
  // A vehicle only appears once per day, and the pool skews so regulars recur.
  const regulars = shuffle([...vehicleRows]).slice(0, 400);

  for (let d = 0; d < spanDays; d++) {
    const day = new Date(start.getTime() + d * DAY);
    const dow = day.getDay();
    if (dow === 0 && chance(0.85)) continue; // mostly closed on Sunday
    const daysAgo = spanDays - d;
    const isRecent = daysAgo <= 6;
    const n = dow === 0 ? between(2, 5) : dow === 6 ? between(7, 11) : between(JOBS_PER_DAY - 3, JOBS_PER_DAY + 3);
    const usedToday = new Set<string>();
    const cutoff = day.getTime() + DAY;
    let invoicedToday = 0;

    for (let k = 0; k < n; k++) {
      let v = chance(0.45) ? pick(regulars) : pick(vehicleRows);
      let guard = 0;
      while ((usedToday.has(v._id) || v.customerCreatedAt.getTime() > cutoff) && guard++ < 20) v = pick(vehicleRows);
      if (usedToday.has(v._id) || v.customerCreatedAt.getTime() > cutoff) continue;
      usedToday.add(v._id);

      const job = pick(JOB_POOL);
      const mult = BODY_MULT[v.body] * (v.year < 2014 ? 0.9 : 1);
      const parts: EstimationPart[] = job.parts.map(([partName, unitPrice, quantity]) => ({
        inventoryItem: null, partName, quantity, unitPrice: Math.round(unitPrice * mult / 10) * 10, total: 0
      }));
      const labor: EstimationLabor[] = job.labor.map(([description, hours]) => ({ description, hours, ratePerHour: LABOR_RATE, total: 0 }));
      const discount = chance(0.2) ? between(1, 10) * 100 : 0;
      const totals = computeEstimationTotals({ parts, labor, discount, taxRate: TAX_RATE });

      const createdBy = pick(creators);
      const advisor = pick(advisors);
      const mechanic = pick(mechanics);
      const opened = at(day, between(8, 17), between(0, 59));
      const km = (odo.get(v._id) ?? 20000) + between(300, 4500);
      odo.set(v._id, km);
      const complexity = totals.subtotal > 15000 ? 3 : totals.subtotal > 5000 ? 1 : 0;
      const expected = addHours(opened, 24 * (complexity + between(0, 1)) + between(2, 8));

      const history: StatusHistoryEntry[] = [entry('new', createdBy, opened, 'Job card created')];
      let estimation: Estimation = { ...totals, approvedByCustomer: false, approvedAt: null, sentAt: null };
      let status = 'new';
      let actualDelivery: Date | null = null;
      let invoiceId: string | null = null;

      // Historic days resolve fully; the last week is left mid-flight, with
      // fewer invoices the closer to today the card was opened.
      const roll = rand();
      const willInvoice = invoicedToday < INVOICES_PER_DAY && roll < (isRecent ? 0.15 + daysAgo * 0.1 : 0.9);
      const willCancel = !willInvoice && !isRecent && roll < 0.97;
      const stepsToRun = willInvoice ? 5 : willCancel ? between(0, 2) : isRecent ? between(0, Math.min(5, 8 - daysAgo)) : 5;
      const advance = (next: string, when: Date, note = ''): void => {
        status = next;
        history.push(entry(next, next === 'approved' ? advisor : pick([advisor, mechanic]), when, note));
      };

      let t = opened;
      const plan: [string, () => number, string][] = [
        ['estimation_sent', () => between(1, 3), 'Estimation shared with customer'],
        ['approved', () => between(1, 6), 'Estimation approved by customer'],
        ['in_progress', () => between(1, 4), `Assigned to bay ${between(1, 6)}`],
        ['quality_check', () => between(2, 6) + 24 * complexity, 'Work complete, road test pending'],
        ['ready_for_pickup', () => between(1, 3), 'Customer informed']
      ];
      for (let i = 0; i < stepsToRun; i++) {
        const [next, hours, note] = plan[i];
        const nt = addHours(t, hours());
        if (nt.getTime() > now) break;
        t = nt;
        if (next === 'estimation_sent') estimation = { ...estimation, sentAt: t.toISOString() };
        if (next === 'approved') estimation = { ...estimation, approvedByCustomer: true, approvedAt: t.toISOString() };
        advance(next, t, note);
      }

      const jobId = newId();
      let delivery = addHours(t, between(1, 20));
      if (delivery.getHours() < 8 || delivery.getHours() > 19) delivery = at(new Date(delivery.getTime() + DAY), between(9, 17), between(0, 59));
      if (willInvoice && status === 'ready_for_pickup' && delivery.getTime() <= now) {
        t = delivery;
        invoicedToday++;
        invSeq++;
        invoiceId = newId();
        const invNo = `INV-${ymd(t)}-${String(invSeq).padStart(4, '0')}`;
        advance('delivered', t, `Invoice ${invNo} generated`);
        actualDelivery = t;
        const ageDays = (now - t.getTime()) / DAY;
        const payRoll = rand();
        const paid = ageDays > 45 ? payRoll < 0.97 : ageDays > 14 ? payRoll < 0.9 : payRoll < 0.7;
        const partial = !paid && payRoll < (ageDays > 45 ? 0.99 : 0.85);
        const method = pick<PaymentMethod>(['cash', 'upi', 'upi', 'upi', 'card', 'bank_transfer']);
        const paidAt = paid ? new Date(Math.min(now, addHours(t, between(0, 72)).getTime())) : null;
        invRows.push({
          _id: invoiceId, invoiceNumber: invNo, jobCardId: jobId, customerId: v.customerId, vehicleId: v._id, garageId,
          parts: totals.parts, labor: totals.labor, subtotal: totals.subtotal, taxRate: TAX_RATE, taxAmount: totals.taxAmount,
          discount, grandTotal: totals.grandTotal,
          paymentStatus: paid ? 'paid' : partial ? 'partial' : 'unpaid',
          paymentMethod: paid || partial ? method : '',
          amountPaid: paid ? totals.grandTotal : partial ? Math.round(totals.grandTotal * pick([0.3, 0.5, 0.5, 0.7]) / 100) * 100 : 0,
          paidAt, notes: '', createdById: advisor, createdAt: t, updatedAt: paidAt ?? t
        });
      } else if (willCancel) {
        t = new Date(Math.min(now, addHours(t, between(2, 30)).getTime()));
        advance('cancelled', t, pick(['Customer did not approve estimate', 'Customer took vehicle elsewhere', 'Duplicate job card', 'Vehicle sold']));
      }

      jcSeq++;
      jobRows.push({
        _id: jobId, garageId, vehicleId: v._id, customerId: v.customerId,
        jobCardNumber: `JC-${ymd(opened)}-${String(jcSeq).padStart(4, '0')}`,
        serviceType: job.type,
        complaints: job.complaints.map((description): Complaint => ({ description, priority: job.type === 'accident' ? 'high' : pick(['low', 'medium', 'medium', 'high']) })),
        photos: [], assignedMechanicId: mechanic, assignedAdvisorId: advisor,
        status, statusHistory: history, estimation, odometerAtIntake: km,
        expectedDeliveryDate: expected, actualDeliveryDate: actualDelivery,
        internalNotes: pick(NOTES), invoiceId, createdById: createdBy,
        estimationToken: status === 'estimation_sent' ? randomUUID() : null,
        createdAt: opened, updatedAt: t
      });
    }
  }

  // Job cards first without the invoice link (it is a FK to invoices), then
  // invoices, then the link, the customer aggregates and the odometers as
  // three set-based updates.
  await insertBatched(jobCards, jobRows.map(j => ({ ...j, invoiceId: null })), 'job cards');
  await insertBatched(invoices, invRows, 'invoices');
  await db.execute(sql`update job_cards j set invoice_id = i.id from invoices i
    where i.job_card_id = j.id and j.garage_id = ${garageId}`);
  await db.execute(sql`update customers c set total_visits = s.n, total_spent = round(s.t) from (
      select customer_id, count(*) n, sum(grand_total) t from invoices where garage_id = ${garageId} group by customer_id
    ) s where s.customer_id = c.id`);
  await db.execute(sql`update vehicles v set current_odometer_reading = s.m from (
      select vehicle_id, max(odometer_at_intake) m from job_cards where garage_id = ${garageId} group by vehicle_id
    ) s where s.vehicle_id = v.id`);
  console.log('  links, customer totals and odometers updated');

  // Expenses, month by month
  const expenseRows: (typeof expenses.$inferInsert)[] = [];
  for (let m = 0; m <= MONTHS_BACK; m++) {
    const monthStart = new Date(start.getFullYear(), start.getMonth() + m, 1);
    if (monthStart > today) break;
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const lastDay = monthStart.getMonth() === today.getMonth() && monthStart.getFullYear() === today.getFullYear() ? today.getDate() : daysInMonth;
    for (const e of MONTHLY_EXPENSES) {
      const times = e.per >= 1 ? e.per : chance(e.per) ? 1 : 0;
      for (let k = 0; k < times; k++) {
        const dayOfMonth = e.category === 'rent' || e.category === 'salaries' ? Math.min(between(1, 5), lastDay) : between(1, lastDay);
        const when = at(new Date(monthStart.getFullYear(), monthStart.getMonth(), dayOfMonth), between(9, 18), between(0, 59));
        if (when > new Date()) continue;
        const amount = Math.round(between(e.lo, e.hi) / 50) * 50;
        expenseRows.push({
          _id: newId(), garageId, title: e.per > 1 ? `${e.title} (${pick(['Bosch dealer', 'Popular Autoparts', 'MRF stockist', 'Castrol distributor', 'Kochi Auto Spares'])})` : e.title,
          category: e.category, amount, expenseDate: when, paymentMethod: e.method,
          notes: e.category === 'salaries' ? `${staffRows.length + 1} staff` : '',
          createdById: owner._id, createdAt: when, updatedAt: when
        });
      }
    }
  }
  await insertBatched(expenses, expenseRows, 'expenses');

  console.log(`\nDone.
  customers ${customerRows.length}  vehicles ${vehicleRows.length}  job cards ${jobRows.length}  invoices ${invRows.length}  expenses ${expenseRows.length}
  login: ${email} / ${password}
  staff logins use the same password: ${staffRows.map(s => s.email).join(', ')}`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => closeDB());
