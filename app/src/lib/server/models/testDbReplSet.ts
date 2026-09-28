import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

/**
 * `models/testDb.ts` starts a STANDALONE `MongoMemoryServer` — fine for
 * every other integration test, but standalone MongoDB cannot run
 * transactions at all. `activateRun` (services/deliveryRunService.ts) is
 * the one operation in this project that needs a real multi-document
 * transaction, so it is the one integration test that needs a replica set
 * instead. Kept as a separate helper (not a change to testDb.ts) so every
 * other integration test keeps the cheaper, faster standalone server.
 */
let replSet: MongoMemoryReplSet | undefined;

/** Starts a single-node in-memory MongoDB REPLICA SET (required for transactions) and connects mongoose to it. Call from beforeAll. */
export async function startTestReplSetDb(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}

/** Call from afterAll. */
export async function stopTestReplSetDb(): Promise<void> {
  await mongoose.disconnect();
  await replSet?.stop();
}

/** Call from afterEach to keep tests isolated from each other. */
export async function clearTestReplSetDb(): Promise<void> {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
