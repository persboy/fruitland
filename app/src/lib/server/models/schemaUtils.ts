/**
 * Standard options for every top-level model schema: Mongoose-managed
 * createdAt/updatedAt, and a toJSON transform that strips Mongoose internals
 * (_id -> id, drop __v) from anything that serializes a document directly.
 *
 * This is NOT a substitute for a real DTO/serializer per route (see
 * docs/domain-model.md §38) — it only prevents raw Mongoose internals from
 * leaking if a document is ever JSON-serialized without an explicit shape.
 *
 * Deliberately NOT annotated as `SchemaOptions` (a generic type) — that
 * would freeze the generic parameter at `unknown` and make every
 * `new Schema<T>(fields, baseSchemaOptions)` call a type error. Left as a
 * plain object literal, it satisfies `SchemaOptions<T>` structurally for
 * whichever T each model schema passes.
 */
export const baseSchemaOptions = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      ret.id = (ret._id as { toString(): string } | undefined)?.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
};

/** For append-only logs: Mongoose still stamps createdAt, but there is deliberately no updatedAt. */
export const createdAtOnlySchemaOptions = {
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: baseSchemaOptions.toJSON,
};

/** Fixed key used by every singleton settings collection (StoreSettings, ShippingSettings, SystemState). */
export const SINGLETON_KEY = "singleton";

/** Integer Toman validator, reused on every money field across models (see packages/shared money.ts). */
export const tomanValidator = {
  validator: Number.isInteger,
  message: "{PATH} must be an integer Toman value",
};
