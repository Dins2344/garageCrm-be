import mongoose from 'mongoose';
import logger from '../utils/logger';

const log = logger.child('Database');

const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI as string);
    log.info('MongoDB connection established', { host: conn.connection.host });
    await verifyIndexes();
  } catch (error) {
    log.error('MongoDB connection failed', { error: (error as Error).message });
    process.exit(1);
  }
};

/**
 * Mongoose builds each model's indexes in the background on connect and,
 * by default, silently swallows any failure — there's no console output,
 * no crash, nothing. If a unique index can't be built because data already
 * violates it (this exact thing happened to Garage's {owner, name} index —
 * a pre-existing duplicate branch name meant the index never built and the
 * "unique" constraint silently never applied to any owner, not just that
 * one), the schema's uniqueness guarantee is just gone with zero signal.
 * This makes that failure loud instead: explicitly (re)builds every
 * registered model's indexes on every boot and logs an error — including
 * which documents are blocking it — for anything that doesn't build clean.
 */
const verifyIndexes = async (): Promise<void> => {
  const results = await Promise.allSettled(
    Object.values(mongoose.connection.models).map(model => model.createIndexes())
  );

  results.forEach((result, i) => {
    const modelName = Object.keys(mongoose.connection.models)[i];
    if (result.status === 'rejected') {
      log.error('Index build failed — a schema constraint (e.g. a unique index) is NOT being enforced', {
        model: modelName,
        error: (result.reason as Error).message
      });
    }
  });
};

export default connectDB;
