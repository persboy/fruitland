import { Schema, Model, model, models, Types } from "mongoose";
import { DISCOUNT_TYPES, type DiscountType } from "@fruitland/shared";
import { baseSchemaOptions, tomanValidator } from "./schemaUtils";

/**
 * Referral-driven discount codes are intentionally NOT distinguished here
 * yet (no `source` field) — the referral reward formula is not finalized
 * (docs/domain-model.md §7). When it is approved, adding a `source` field
 * is additive and does not require restructuring this model.
 */

export interface IDiscountCode {
  code: string;
  type: DiscountType;
  /** Required when type === "personal"; the only user allowed to redeem it. */
  ownerUserId?: Types.ObjectId;
  percentage: number;
  maxDiscountAmount?: number;
  minOrderAmount: number;
  /** Missing = unlimited uses. `usedCount` is the current usage count and is read-only for admins. */
  usageLimit?: number;
  usedCount: number;
  isActive: boolean;
  expiresAt?: Date;
}

const integerValidator = (label: string) => ({ validator: Number.isInteger, message: `${label} must be an integer` });

const discountCodeSchema = new Schema<IDiscountCode>(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    type: { type: String, enum: DISCOUNT_TYPES, required: true },
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [
        function (this: IDiscountCode) {
          return this.type === "personal";
        },
        "ownerUserId is required for a personal discount code",
      ],
    },
    percentage: { type: Number, required: true, min: 1, max: 100, validate: integerValidator("percentage") },
    // Absent = no cap. A cap of 0 would silently disable the discount, so it is not a valid value.
    maxDiscountAmount: { type: Number, min: 1, validate: tomanValidator },
    minOrderAmount: { type: Number, default: 0, min: 0, validate: tomanValidator },
    // Absent = unlimited (Owner decision, Phase 4 page 6). Never below usedCount — the service enforces that atomically.
    usageLimit: { type: Number, min: 1, validate: integerValidator("usageLimit") },
    usedCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    expiresAt: { type: Date },
  },
  baseSchemaOptions,
);

export const DiscountCode =
  (models.DiscountCode as Model<IDiscountCode> | undefined) || model<IDiscountCode>("DiscountCode", discountCodeSchema);
