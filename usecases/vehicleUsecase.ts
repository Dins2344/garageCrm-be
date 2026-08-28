import { QueryFilter, Types } from 'mongoose';
import Vehicle, { IVehicle } from '../models/Vehicle';
import Customer from '../models/Customer';
import JobCard from '../models/JobCard';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

const log = logger.child('VehicleUsecase');

interface ListInput {
  garageId: Types.ObjectId | string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

export const getVehiclesList = async ({ garageId, search, page = 1, limit = 20 }: ListInput) => {
  const query: QueryFilter<IVehicle> = { garage: garageId };

  if (search) {
    query.licensePlate = { $regex: search, $options: 'i' };
  }

  const total = await Vehicle.countDocuments(query);
  const vehicles = await Vehicle.find(query)
    .populate('customer', 'name phone')
    .sort('-createdAt')
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  return { vehicles, total };
};

interface GetDetailsInput {
  vehicleId: string;
  garageId: Types.ObjectId | string;
}

export const getVehicleDetails = async ({ vehicleId, garageId }: GetDetailsInput) => {
  const vehicle = await Vehicle.findOne({ _id: vehicleId, garage: garageId })
    .populate('customer')
    .populate({
      path: 'serviceHistory',
      options: { sort: { createdAt: -1 }, limit: 10 }
    })
    .lean();

  if (!vehicle) {
    throw new HttpError('Vehicle not found', 404);
  }

  return vehicle;
};

interface RegisterInput {
  vehicleData: Partial<IVehicle>;
  garageId: Types.ObjectId | string;
}

export const registerVehicle = async ({ vehicleData, garageId }: RegisterInput) => {
  const dataWithGarage = { ...vehicleData, garage: garageId };
  const vehicle = await Vehicle.create(dataWithGarage);

  // side effect: update customer's vehicles list. Garage-scoped and
  // $addToSet for the same reasons as the reassignment path below.
  await Customer.findOneAndUpdate(
    { _id: vehicle.customer, garage: garageId },
    { $addToSet: { vehicles: vehicle._id } }
  );

  log.info('New vehicle registered', { vehicleId: vehicle._id, customerId: vehicle.customer });
  return vehicle;
};

interface UpdateInput {
  vehicleId: string;
  garageId: Types.ObjectId | string;
  updateData: Partial<IVehicle>;
}

export const updateVehicleData = async ({ vehicleId, garageId, updateData }: UpdateInput) => {
  // Read the current owner *before* writing, because that is the only place
  // the old owner is recorded once the update lands.
  const existing = await Vehicle.findOne({ _id: vehicleId, garage: garageId }).select('customer').lean();

  if (!existing) {
    throw new HttpError('Vehicle not found', 404);
  }

  const previousOwner = existing.customer?.toString();
  const requestedOwner = updateData.customer?.toString();
  const ownerIsChanging = !!requestedOwner && requestedOwner !== previousOwner;

  // The new owner has to be a customer of *this* garage. Without this check a
  // client could hand us any customer id and we would both point the vehicle
  // across a tenant boundary and mutate that other garage's customer below.
  if (ownerIsChanging) {
    const newOwnerExists = await Customer.exists({ _id: requestedOwner, garage: garageId });
    if (!newOwnerExists) {
      throw new HttpError('Customer not found', 404);
    }
  }

  const vehicle = await Vehicle.findOneAndUpdate(
    { _id: vehicleId, garage: garageId },
    updateData,
    { new: true, runValidators: true }
  );

  if (!vehicle) {
    throw new HttpError('Vehicle not found', 404);
  }

  // `Customer.vehicles` is denormalised, so reassigning a vehicle has to move
  // it by hand. Registration pushes and deletion pulls; this path did neither,
  // which left the vehicle counted against its old owner forever and never
  // counted against its new one. Both clients read `customer.vehicles.length`
  // directly, so the stale count showed up on web and mobile alike.
  if (ownerIsChanging) {
    await Promise.all([
      Customer.findOneAndUpdate(
        { _id: previousOwner, garage: garageId },
        { $pull: { vehicles: vehicle._id } }
      ),
      // $addToSet, not $push: a retried request must not add a second copy of
      // the same id and inflate the count.
      Customer.findOneAndUpdate(
        { _id: requestedOwner, garage: garageId },
        { $addToSet: { vehicles: vehicle._id } }
      ),
    ]);

    log.info('Vehicle owner changed', { vehicleId, from: previousOwner, to: requestedOwner });
  }

  return vehicle;
};

interface RemoveInput {
  vehicleId: string;
  garageId: Types.ObjectId | string;
}

export const removeVehicle = async ({ vehicleId, garageId }: RemoveInput): Promise<true> => {
  const vehicle = await Vehicle.findOneAndDelete({ _id: vehicleId, garage: garageId });

  if (!vehicle) {
    throw new HttpError('Vehicle not found', 404);
  }

  // side effect: remove from customer's vehicles list
  await Customer.findOneAndUpdate(
    { _id: vehicle.customer, garage: garageId },
    { $pull: { vehicles: vehicle._id } }
  );

  log.info('Vehicle removed from registry', { vehicleId, garageId });
  return true;
};

interface HistoryInput {
  vehicleId: string;
  garageId: Types.ObjectId | string;
  page?: number | string;
  limit?: number | string;
}

export const getVehicleHistory = async ({ vehicleId, garageId, page = 1, limit = 20 }: HistoryInput) => {
  const skip = (Number(page) - 1) * Number(limit);
  const query = { vehicle: vehicleId, garage: garageId };

  const total = await JobCard.countDocuments(query);
  const jobCards = await JobCard.find(query)
    .populate('customer', 'name phone')
    .populate('assignedMechanic', 'name')
    .select('-estimation.parts -estimation.labor -statusHistory -photos')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();

  log.info('Vehicle history fetched', { vehicleId, garageId, count: jobCards.length, total });
  return { jobCards, total, page: Number(page), limit: Number(limit) };
};
