import mongoose from 'mongoose';
import logger from '../utils/logger';

const log = logger.child('Database');

const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI as string);
    log.info('MongoDB connection established', { host: conn.connection.host });
  } catch (error) {
    log.error('MongoDB connection failed', { error: (error as Error).message });
    process.exit(1);
  }
};

export default connectDB;
