import mongoose from "mongoose";
import { getEnv } from "./env";

/**
 * Reuses a single Mongoose connection across hot-reloads in development and
 * across serverless invocations where the module scope persists. Never call
 * mongoose.connect() anywhere else in the codebase — always go through
 * connectToDatabase().
 */

type CachedConnection = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var __fruitlandMongoose: CachedConnection | undefined;
}

const globalCache: CachedConnection = global.__fruitlandMongoose ?? { conn: null, promise: null };
global.__fruitlandMongoose = globalCache;

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (globalCache.conn) return globalCache.conn;

  if (!globalCache.promise) {
    const { MONGODB_URI } = getEnv();
    globalCache.promise = mongoose.connect(MONGODB_URI);
  }

  globalCache.conn = await globalCache.promise;
  return globalCache.conn;
}
