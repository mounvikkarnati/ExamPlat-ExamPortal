/**
 * READ-ONLY inspector: confirms which database on the shared Atlas cluster
 * contains the FINAL* collections this portal needs.
 *
 *   npm run inspect
 */
require('dotenv').config();

const mongoose = require('mongoose');

const FINAL_COLLECTIONS = ['finalexams', 'finalallowedcandidates', 'finalquestions', 'finalattempts', 'students'];

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set (server/.env).');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const conn = mongoose.connection;
  console.log(`Connected. Default database: "${conn.name}"`);

  const cols = await conn.db.listCollections().toArray();
  console.log(`Collections in "${conn.name}": ${cols.map((c) => c.name).join(', ') || '(none)'}`);

  let foundHere = false;
  for (const name of FINAL_COLLECTIONS) {
    const count = await conn.db.collection(name).countDocuments();
    if (count > 0) foundHere = true;
    console.log(`  ${name}: ${count} doc(s)`);
  }

  if (!foundHere && !cols.some((c) => c.name === 'finalexams')) {
    console.log('\nfinalexams not found in this database - scanning other databases...');
    try {
      const { databases } = await conn.db.admin().listDatabases();
      for (const d of databases) {
        if (['admin', 'local', 'config', conn.name].includes(d.name)) continue;
        const alt = conn.useDb(d.name, { useCache: true });
        const altCols = await alt.db.listCollections().toArray();
        const hits = FINAL_COLLECTIONS.filter((n) => altCols.some((c) => c.name === n));
        console.log(`  db "${d.name}": ${hits.length ? `HAS ${hits.join(', ')}` : 'no FINAL collections'} (${altCols.length} collections)`);
      }
      console.log('\nIf a database above lists the FINAL collections, put its name in MONGO_URI:');
      console.log('  mongodb+srv://<user>:<pass>@<host>/<DBNAME>?appName=...');
    } catch (err) {
      console.log(`(Could not list databases: ${err.message})`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});