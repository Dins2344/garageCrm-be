const mongoose = require('mongoose');
const logger = require('../utils/logger');

const log = logger.child('Database');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    log.info('MongoDB connection established', { host: conn.connection.host });
  } catch (error) {
    log.error('MongoDB connection failed', { error: error.message });
    process.exit(1);
  }
};

module.exports = connectDB;
