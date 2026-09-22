import { Schema, Model, model, models, Types } from "mongoose";
import { baseSchemaOptions, SINGLETON_KEY } from "./schemaUtils";

/**
 * Enforces MASTER-PROMPT.md §17: "The first successfully registered user
 * becomes MASTER_ADMIN. This must be enforced atomically on the server."
 *
 * The atomicity technique is a schema-level concern (a unique-keyed
 * singleton document claimed via a single findOneAndUpdate with
 * $setOnInsert), so the static helper lives on the model. The actual
 * registration flow (hashing, session issuance, etc.) is service-layer and
 * out of scope until auth is approved.
 */

export interface ISystemState {
  key: typeof SINGLETON_KEY;
  masterAdminUserId?: Types.ObjectId;
}

const systemStateSchema = new Schema<ISystemState>(
  {
    key: { type: String, required: true, unique: true, default: SINGLETON_KEY },
    masterAdminUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  baseSchemaOptions,
);

export const SystemState = (models.SystemState as Model<ISystemState> | undefined) || model<ISystemState>("SystemState", systemStateSchema);

/**
 * Atomically claims MASTER_ADMIN for `userId` if and only if no one has
 * claimed it yet. Returns true if this call was the one that claimed it.
 * Relies on the unique index on `key` to make the upsert race-safe.
 */
export async function tryClaimMasterAdmin(userId: Types.ObjectId): Promise<boolean> {
  try {
    await SystemState.create({ key: SINGLETON_KEY, masterAdminUserId: userId });
    return true;
  } catch (err) {
    const isDuplicateKeyError = (err as { code?: number }).code === 11000;
    if (isDuplicateKeyError) return false;
    throw err;
  }
}
