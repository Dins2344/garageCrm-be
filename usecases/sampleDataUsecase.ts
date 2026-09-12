import { and, count, eq, inArray, or, sql } from 'drizzle-orm';
import { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '../config/db';
import { customers, CustomerRow, customerToApi } from '../models/Customer';
import { vehicles, VehicleRow, vehicleToApi } from '../models/Vehicle';
import { jobCards, JobCardRow, jobCardToApi } from '../models/JobCard';
import { invoices, InvoiceRow, invoiceToApi } from '../models/Invoice';
import { serviceReminders } from '../models/ServiceReminder';
import { garages } from '../models/Garage';
import { nextJobCardNumber, nextInvoiceNumber } from '../utils/numbering';
import logger from '../utils/logger';
import { CountryCode, COUNTRIES, DEFAULT_COUNTRY, isSupportedCountry } from '../config/countries';
import {
  SAMPLE_CUSTOMERS,
  SAMPLE_VEHICLES,
  SAMPLE_JOB_CARDS,
  SAMPLE_DATA_NOTE,
  sampleCustomerName,
  samplePartPrice,
  samplePhone,
  samplePlate
} from '../config/sampleData';
import { computeEstimationTotals } from './jobCardUsecase';

const log = logger.child('SampleDataUsecase');

interface SeedInput {
  garageId: string;
  ownerId: string;
  country?: string;
}

/**
 * Populates a newly created garage with a small, clearly-flagged demo dataset.
 *
 * Called from `registerNewGarage`, which deliberately swallows any failure here
 * — see the comment at that call site. A garage is empty at the moment this
 * runs, so nothing it writes can collide with real data.
 *
 * Runs as one transaction: either the whole demo set lands or none of it
 * does, so a half-seeded garage (customers with no cards) cannot exist.
 *
 * **The invoice is written directly rather than through
 * `generateInvoiceFromJobCard`.** That usecase enforces the free-plan daily
 * invoice cap and auto-creates a service reminder; a reminder against a
 * fabricated phone number would eventually have the cron send a real SMS to
 * whoever actually owns that number.
 */
export const seedSampleData = async ({ garageId, ownerId, country }: SeedInput) => {
  const countryCode: CountryCode = isSupportedCountry(country) ? country : DEFAULT_COUNTRY;

  // Read the rates back off the garage rather than the country table: the
  // garage owns them from creation onward (see config/countries.ts), so this
  // stays correct if seeding is ever run against an established garage.
  const garage = await db.query.garages.findFirst({ columns: { settings: true }, where: eq(garages._id, garageId) });
  const taxRate = garage?.settings?.taxRate ?? COUNTRIES[countryCode].defaultTaxRate;
  const laborRatePerHour =
    garage?.settings?.laborRatePerHour ?? COUNTRIES[countryCode].defaultLaborRatePerHour;

  const seeded = await db.transaction(async tx => {
    const customerRows: CustomerRow[] = await tx.insert(customers).values(
      SAMPLE_CUSTOMERS.map((spec, index) => ({
        name: sampleCustomerName(countryCode, spec.nameIndex),
        phone: samplePhone(countryCode, index),
        email: spec.email,
        notes: spec.notes,
        garageId,
        isSample: true
      }))
    ).returning();

    const vehicleRows: VehicleRow[] = await tx.insert(vehicles).values(
      SAMPLE_VEHICLES.map((spec, index) => ({
        licensePlate: samplePlate(countryCode, index),
        make: spec.make,
        model: spec.model,
        year: spec.year,
        color: spec.color,
        fuelType: spec.fuelType,
        currentOdometerReading: spec.odometer,
        customerId: customerRows[spec.customerIndex]._id,
        garageId,
        isSample: true
      }))
    ).returning();

    const jobCardRows: JobCardRow[] = [];
    for (const spec of SAMPLE_JOB_CARDS) {
      const vehicle = vehicleRows[spec.vehicleIndex];
      const openedAt = new Date(Date.now() - spec.daysAgo * 24 * 60 * 60 * 1000);

      const totals = computeEstimationTotals({
        parts: spec.parts.map(p => ({
          inventoryItem: null,
          partName: p.partName,
          quantity: p.quantity,
          unitPrice: samplePartPrice(laborRatePerHour, p.rateMultiple),
          total: 0
        })),
        labor: spec.labor.map(l => ({
          description: l.description,
          hours: l.hours,
          ratePerHour: laborRatePerHour,
          total: 0
        })),
        discount: 0,
        taxRate
      });

      // Sequential on purpose: each number is issued under the garage row
      // lock and read from the count so far, so the five cards number 1-5.
      const jobCardNumber = await nextJobCardNumber(tx, garageId);

      // Backdated at insert — `createdAt` is a plain column now, so a card
      // marked "delivered three weeks ago" really does carry that date rather
      // than five cards all opened in the same second.
      const [jobCard] = await tx.insert(jobCards).values({
        serviceType: spec.serviceType,
        jobCardNumber,
        vehicleId: vehicle._id,
        customerId: vehicle.customerId,
        garageId,
        complaints: spec.complaints.map(c => ({ ...c })),
        status: spec.status,
        statusHistory: [{
          status: spec.status,
          changedBy: ownerId,
          changedAt: openedAt.toISOString(),
          notes: SAMPLE_DATA_NOTE
        }],
        estimation: {
          ...totals,
          approvedByCustomer: spec.estimationApproved,
          approvedAt: spec.estimationApproved ? openedAt.toISOString() : null,
          sentAt: spec.estimationApproved ? openedAt.toISOString() : null
        },
        odometerAtIntake: vehicle.currentOdometerReading,
        createdById: ownerId,
        isSample: true,
        createdAt: openedAt,
        updatedAt: openedAt
      }).returning();

      jobCardRows.push(jobCard);
    }

    // One invoice, off the delivered card, so the invoice list and the PDF path
    // both have something to show.
    const deliveredIndex = SAMPLE_JOB_CARDS.findIndex(spec => spec.status === 'delivered');
    let invoice: InvoiceRow | null = null;

    if (deliveredIndex !== -1) {
      const deliveredCard = jobCardRows[deliveredIndex];
      const invoiceNumber = await nextInvoiceNumber(tx, garageId);
      [invoice] = await tx.insert(invoices).values({
        invoiceNumber,
        jobCardId: deliveredCard._id,
        customerId: deliveredCard.customerId,
        vehicleId: deliveredCard.vehicleId,
        garageId,
        parts: deliveredCard.estimation.parts,
        labor: deliveredCard.estimation.labor,
        subtotal: deliveredCard.estimation.subtotal,
        taxRate: deliveredCard.estimation.taxRate,
        taxAmount: deliveredCard.estimation.taxAmount,
        discount: deliveredCard.estimation.discount,
        grandTotal: deliveredCard.estimation.grandTotal,
        paymentStatus: 'paid',
        paymentMethod: 'cash',
        amountPaid: deliveredCard.estimation.grandTotal,
        paidAt: new Date(),
        createdById: ownerId,
        isSample: true
      }).returning();

      await tx.update(jobCards).set({ invoiceId: invoice._id })
        .where(and(eq(jobCards._id, deliveredCard._id), eq(jobCards.garageId, garageId)));
      deliveredCard.invoiceId = invoice._id;

      // Keep the customer's lifetime figures consistent with the paid invoice —
      // otherwise the customer detail screen shows a paid job against zero spend.
      await tx.update(customers).set({
        totalVisits: sql`${customers.totalVisits} + 1`,
        totalSpent: sql`${customers.totalSpent} + ${invoice.grandTotal}`
      }).where(and(eq(customers._id, deliveredCard.customerId), eq(customers.garageId, garageId)));
    }

    return { customerRows, vehicleRows, jobCardRows, invoice };
  });

  log.info('Sample data seeded', {
    garageId,
    customers: seeded.customerRows.length,
    vehicles: seeded.vehicleRows.length,
    jobCards: seeded.jobCardRows.length,
    invoices: seeded.invoice ? 1 : 0
  });

  return {
    customers: seeded.customerRows.map(customerToApi),
    vehicles: seeded.vehicleRows.map(vehicleToApi),
    jobCards: seeded.jobCardRows.map(row => jobCardToApi(row)),
    invoice: seeded.invoice ? invoiceToApi(seeded.invoice) : null
  };
};

/**
 * Whether a garage still holds seeded rows — drives the "Sample data" banner.
 *
 * Counts customers specifically, because `removeSampleData` deletes them last:
 * a partial failure therefore still reports true rather than hiding the banner
 * over a half-cleared garage.
 */
export const hasSampleData = async (garageId: string): Promise<boolean> => {
  const [{ value }] = await db.select({ value: count() }).from(customers)
    .where(and(eq(customers.garageId, garageId), eq(customers.isSample, true)));
  return value > 0;
};

interface RemoveInput {
  garageId: string;
}

/**
 * Deletes every seeded row and nothing else.
 *
 * `isSample` is what makes this exact — matching on names or dates would be
 * guesswork, and this runs against a garage that by then holds real data.
 * Every delete is garage-scoped, so one tenant clearing its samples cannot
 * touch another's.
 *
 * One transaction, in foreign-key order: invoices, job cards, vehicles,
 * customers. Anything a tester hung off a sample row through the UI — a job
 * card opened on a demo car, an invoice raised from it, a vehicle added to a
 * demo customer — goes too, whatever its own flag says: a job card on a car
 * that never existed is demo data by construction, and the restrict foreign
 * keys would otherwise refuse the removal outright. Real rows attached to
 * real customers are never touched.
 */
export const removeSampleData = async ({ garageId }: RemoveInput) => {
  const [sampleCustomers, sampleVehicles] = await Promise.all([
    db.select({ _id: customers._id }).from(customers)
      .where(and(eq(customers.garageId, garageId), eq(customers.isSample, true))),
    db.select({ _id: vehicles._id }).from(vehicles)
      .where(and(eq(vehicles.garageId, garageId), eq(vehicles.isSample, true)))
  ]);
  const sampleCustomerIds = sampleCustomers.map(c => c._id);
  const sampleVehicleIds = sampleVehicles.map(v => v._id);

  // `col in (...)` that is simply false when the list is empty.
  const inList = (column: AnyPgColumn, ids: string[]) =>
    ids.length ? inArray(column, ids) : sql`false`;

  const removed = await db.transaction(async tx => {
    // Reminders are never created for sample data by the seeder, but a tester
    // who delivers a sample job card through the UI before clearing would leave
    // one behind — pointing at a fabricated phone number the cron would text.
    await tx.delete(serviceReminders).where(and(
      eq(serviceReminders.garageId, garageId),
      or(inList(serviceReminders.vehicleId, sampleVehicleIds), inList(serviceReminders.customerId, sampleCustomerIds))
    ));

    const removedInvoices = await tx.delete(invoices).where(and(
      eq(invoices.garageId, garageId),
      or(eq(invoices.isSample, true), inList(invoices.vehicleId, sampleVehicleIds), inList(invoices.customerId, sampleCustomerIds))
    )).returning({ _id: invoices._id });

    const removedJobCards = await tx.delete(jobCards).where(and(
      eq(jobCards.garageId, garageId),
      or(eq(jobCards.isSample, true), inList(jobCards.vehicleId, sampleVehicleIds), inList(jobCards.customerId, sampleCustomerIds))
    )).returning({ _id: jobCards._id });

    const removedVehicles = await tx.delete(vehicles).where(and(
      eq(vehicles.garageId, garageId),
      or(eq(vehicles.isSample, true), inList(vehicles.customerId, sampleCustomerIds))
    )).returning({ _id: vehicles._id });

    // Customers last. `hasSampleData` on GET /garage counts sample *customers*,
    // so the banner is the final thing to go.
    const removedCustomers = await tx.delete(customers)
      .where(and(eq(customers.garageId, garageId), eq(customers.isSample, true)))
      .returning({ _id: customers._id });

    return {
      customers: removedCustomers.length,
      vehicles: removedVehicles.length,
      jobCards: removedJobCards.length,
      invoices: removedInvoices.length
    };
  });

  log.info('Sample data removed', { garageId, ...removed });
  return removed;
};
