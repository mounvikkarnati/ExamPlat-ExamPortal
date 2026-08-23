const mongoose = require('mongoose');

/**
 * Connects to the shared MongoDB Atlas cluster/database used by the Admin Portal.
 * The app only ever reads/writes the FINAL* collections defined in ./models.
 */
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.warn('[DB] MONGO_URI is not set. API will start, but every DB call will fail. Configure server/.env.');
    return false;
  }
  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`[DB] Connected to MongoDB @ ${conn.connection.host}/${conn.connection.name}`);
    return true;
  } catch (err) {
    console.error('[DB] MongoDB connection failed:', err.message);
    console.warn('[DB] Using the placeholder MONGO_URI? Replace it with the real Atlas connection string in server/.env.');
    return false;
  }
}

module.exports = { connectDB };