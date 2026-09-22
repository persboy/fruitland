import { Schema, Model, model, models } from "mongoose";
import { baseSchemaOptions } from "./schemaUtils";

const COUNTER_KEY = "order_number";

export interface IOrderCounter {
  key: typeof COUNTER_KEY;
  seq: number;
}

const orderCounterSchema = new Schema<IOrderCounter>(
  {
    key: { type: String, required: true, unique: true, default: COUNTER_KEY },
    seq: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);

export const OrderCounter =
  (models.OrderCounter as Model<IOrderCounter> | undefined) || model<IOrderCounter>("OrderCounter", orderCounterSchema);

/**
 * Atomically increments and returns the next order number as a
 * zero-padded, human-facing string (e.g. "000042"). Uses findOneAndUpdate +
 * upsert so concurrent order creation never produces a duplicate number.
 */
export async function getNextOrderNumber(): Promise<string> {
  const doc = await OrderCounter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return String(doc.seq).padStart(6, "0");
}
