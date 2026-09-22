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
  /** null/undefined = unlimited uses. */
  usageLimit?: number;
  usedCount: number;
  isActive: boolean;
  expiresAt?: Date;
}

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
    percentage: { type: Number, required: true, min: 1, max: 100 },
    maxDiscountAmount: { type: Number, validate: tomanValidator },
    minOrderAmount: { type: Number, default: 0, validate: tomanValidator },
    usageLimit: { type: Number, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    expiresAt: { type: Date },
  },
  baseSchemaOptions,
);

export const DiscountCode =
  (models.DiscountCode as Model<IDiscountCode> | undefined) || model<IDiscountCode>("DiscountCode", discountCodeSchema);
