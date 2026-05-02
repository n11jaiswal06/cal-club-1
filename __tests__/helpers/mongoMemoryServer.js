// Reusable harness for migration tests that need a real (in-memory) Mongo.
// Standalone mode — fast startup, no transactions. The CAL-18 migration's
// withTransaction path falls back via isStandaloneTransactionError, so a
// replica set isn't needed unless a future test asserts transactional
// semantics.

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod = null;

async function setupMongoServer() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  // The migration scripts read MONGO_URI_NEW first; set it so any code
  // path that re-reads env (e.g. a child of getMongoUri) lands here too.
  process.env.MONGO_URI_NEW = uri;
  await mongoose.connect(uri);
}

async function teardownMongoServer() {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

async function clearAllCollections() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

module.exports = {
  setupMongoServer,
  teardownMongoServer,
  clearAllCollections,
};
