import { Types } from 'mongoose';
import Customer from '../models/Customer';
import Vehicle from '../models/Vehicle';
import JobCard from '../models/JobCard';
import Invoice from '../models/Invoice';
import ServiceReminder from '../models/ServiceReminder';
import Garage from '../models/Garage';
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
  garageId: Types.ObjectId | string;
  ownerId: Types.ObjectId | string;
  country?: string;
}

/**
 * Populates a newly created garage with a small, clearly-flagged demo dataset.
 *
 * Called from `registerNewGarage`, which deliberately swallows any failure here
 * — see the comment at that call site. A garage is empty at the moment this
 * runs, so nothing it writes can collide with real data.
 *
 * Two ordering constraints that are not obvious:
 *
 *  - **Job cards are created sequentially, never with `Promise.all`.** The
 *    `jobCardNumber` pre-validate hook derives the next number from
 *    `countDocuments`, so concurrent creates all read the same count and
 *    collide on the `{ garage, jobCardNumber }` unique index.
 *  - **The invoice is written directly rather than through
 *    `generateInvoiceFromJobCard`.** That usecase enforces the free-plan daily
 *    invoice cap and auto-creates a service reminder; a reminder against a
 *    fabricated phone number would eventually have the cron send a real SMS to
 *    whoever actually owns that number.
 */
export const seedSampleData = async ({ garageId, ownerId, country }: SeedInput) => {
  const countryCode: CountryCode = isSupportedCountry(country) ? country : DEFAULT_COUNTRY;

  // Read the rates back off the garage rather than the country table: the
  // garage owns them from creation onward (see config/countries.ts), so this
  // stays correct if seeding is ever run against an established garage.
  const garage = await Garage.findById(garageId).lean();
  const taxRate = garage?.settings?.taxRate ?? COUNTRIES[countryCode].defaultTaxRate;
  const laborRatePerHour =
    garage?.settings?.laborRatePerHour ?? COUNTRIES[countryCode].defaultLaborRatePerHour;

  const customers = await Customer.create(
    SAMPLE_CUSTOMERS.map((spec, index) => ({
      name: sampleCustomerName(countryCode, spec.nameIndex),
      phone: samplePhone(countryCode, index),
      email: spec.email,
      notes: spec.notes,
      garage: garageId,
      isSample: true
    }))
  );

  const vehicles = await Vehicle.create(
    SAMPLE_VEHICLES.map((spec, index) => ({
      licensePlate: samplePlate(countryCode, index),
      make: spec.make,
      model: spec.model,
      year: spec.year,
      color: spec.color,
      fuelType: spec.fuelType,
      currentOdometerReading: spec.odometer,
      customer: customers[spec.customerIndex]._id,
      garage: garageId,
      isSample: true
    }))
  );

  // `Customer.vehicles` is denormalised and both clients render its `.length`
  // as the vehicle count, so seeding has to maintain it exactly as the
  // registration and reassignment paths do. `$addToSet`, not `$push`, for the
  // same reason vehicleUsecase uses it: a retry must not double-count.
  await Promise.all(
    SAMPLE_VEHICLES.map((spec, index) =>
      Customer.findOneAndUpdate(
        { _id: customers[spec.customerIndex]._id, garage: garageId },
        { $addToSet: { vehicles: vehicles[index]._id } }
      )
    )
  );

  const jobCards = [];
  for (const spec of SAMPLE_JOB_CARDS) {
    const vehicle = vehicles[spec.vehicleIndex];
    const openedAt = new Date(Date.now() - spec.daysAgo * 24 * 60 * 60 * 1000);

    const totals = computeEstimationTotals({
      parts: spec.parts.map(p => ({
        partName: p.partName,
        quantity: p.quantity,
        unitPrice: samplePartPrice(laborRatePerHour, p.rateMultiple),
        total: 0
      })) as Parameters<typeof computeEstimationTotals>[0]['parts'],
      labor: spec.labor.map(l => ({
        description: l.description,
        hours: l.hours,
        ratePerHour: laborRatePerHour,
        total: 0
      })) as Parameters<typeof computeEstimationTotals>[0]['labor'],
      discount: 0,
      taxRate
    });

    // Created one at a time — see the note in this function's docblock.
    const jobCard = await JobCard.create({
      serviceType: spec.serviceType,
      vehicle: vehicle._id,
      customer: vehicle.customer,
      garage: garageId,
      complaints: spec.complaints,
      status: spec.status,
      statusHistory: [{
        status: spec.status,
        changedBy: ownerId,
        changedAt: openedAt,
        notes: SAMPLE_DATA_NOTE
      }],
      estimation: {
        ...totals,
        approvedByCustomer: spec.estimationApproved,
        approvedAt: spec.estimationApproved ? openedAt : null,
        sentAt: spec.estimationApproved ? openedAt : null
      },
      odometerAtIntake: vehicle.currentOdometerReading,
      createdBy: ownerId,
      isSample: true
    });

    // Backdate the row itself, not just its status history. `timestamps: true`
    // stamps every seeded card with the same instant, which reads as five jobs
    // opened in the same second and puts a card marked "delivered three weeks
    // ago" at today's date on the dashboard. `timestamps: false` on this one
    // update is what stops Mongoose overwriting it again.
    if (spec.daysAgo > 0) {
      await JobCard.updateOne(
        { _id: jobCard._id, garage: garageId },
        { $set: { createdAt: openedAt, updatedAt: openedAt } },
        { timestamps: false }
      );
    }

    await Vehicle.findOneAndUpdate(
      { _id: vehicle._id, garage: garageId },
      { $addToSet: { serviceHistory: jobCard._id } }
    );

    jobCards.push(jobCard);
  }

  // One invoice, off the delivered card, so the invoice list and the PDF path
  // both have something to show.
  const deliveredIndex = SAMPLE_JOB_CARDS.findIndex(spec => spec.status === 'delivered');
  let invoice = null;

  if (deliveredIndex !== -1) {
    const deliveredCard = jobCards[deliveredIndex];
    invoice = await Invoice.create({
      jobCard: deliveredCard._id,
      customer: deliveredCard.customer,
      vehicle: deliveredCard.vehicle,
      garage: garageId,
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
      createdBy: ownerId,
      isSample: true
    });

    deliveredCard.invoice = invoice._id;
    await deliveredCard.save();

    // Keep the customer's lifetime figures consistent with the paid invoice —
    // otherwise the customer detail screen shows a paid job against zero spend.
    await Customer.findOneAndUpdate(
      { _id: deliveredCard.customer, garage: garageId },
      { $inc: { totalVisits: 1, totalSpent: invoice.grandTotal } }
    );
  }

  log.info('Sample data seeded', {
    garageId,
    customers: customers.length,
    vehicles: vehicles.length,
    jobCards: jobCards.length,
    invoices: invoice ? 1 : 0
  });

  return { customers, vehicles, jobCards, invoice };
};

/**
 * Whether a garage still holds seeded rows — drives the "Sample data" banner.
 *
 * Counts customers specifically, because `removeSampleData` deletes them last:
 * a partial failure therefore still reports true rather than hiding the banner
 * over a half-cleared garage.
 */
export const hasSampleData = async (garageId: Types.ObjectId | string): Promise<boolean> =>
  (await Customer.countDocuments({ garage: garageId, isSample: true })) > 0;

interface RemoveInput {
  garageId: Types.ObjectId | string;
}

/**
 * Deletes every seeded row and nothing else.
 *
 * `isSample` is what makes this exact — matching on names or dates would be
 * guesswork, and this runs against a garage that by then holds real data.
 * Every delete is garage-scoped, so one tenant clearing its samples cannot
 * touch another's.
 */
export const removeSampleData = async ({ garageId }: RemoveInput) => {
  const sampleVehicles = await Vehicle.find({ garage: garageId, isSample: true }).select('_id customer').lean();
  const sampleVehicleIds = sampleVehicles.map(v => v._id);

  // Reminders are never created for sample data by the seeder, but a tester who
  // delivers a sample job card through the UI before clearing would leave one
  // behind — pointing at a fabricated phone number the cron would later text.
  await ServiceReminder.deleteMany({ garage: garageId, vehicle: { $in: sampleVehicleIds } });

  const [invoices, jobCards, vehicles] = await Promise.all([
    Invoice.deleteMany({ garage: garageId, isSample: true }),
    JobCard.deleteMany({ garage: garageId, isSample: true }),
    Vehicle.deleteMany({ garage: garageId, isSample: true })
  ]);

  // Customers go last, on purpose. `hasSampleData` on GET /garage is answered by
  // counting sample *customers*, so if anything above throws, the flag stays
  // true, the banner stays up, and the owner can retry — rather than the banner
  // vanishing over a half-cleared garage.
  const customers = await Customer.deleteMany({ garage: garageId, isSample: true });

  // A real customer can own a sample vehicle only if someone reassigned one, but
  // the denormalised array has to be cleaned either way or the count stays wrong.
  await Customer.updateMany(
    { garage: garageId, vehicles: { $in: sampleVehicleIds } },
    { $pull: { vehicles: { $in: sampleVehicleIds } } }
  );

  const removed = {
    customers: customers.deletedCount ?? 0,
    vehicles: vehicles.deletedCount ?? 0,
    jobCards: jobCards.deletedCount ?? 0,
    invoices: invoices.deletedCount ?? 0
  };

  log.info('Sample data removed', { garageId, ...removed });
  return removed;
};
