import { Schema, Model, model, models, Types } from "mongoose";
import { baseSchemaOptions } from "./schemaUtils";

/**
 * Whether a separate "product quality report" workflow is needed in
 * addition to this star-rating Review is an open question — see
 * docs/domain-model.md §7. Only Review is modeled for now.
 */

export interface IReviewAttributeValue {
  attributeKey: string;
  value: number;
}

const reviewAttributeValueSchema = new Schema<IReviewAttributeValue>(
  {
    attributeKey: { type: String, required: true },
    value: { type: Number, required: true },
  },
  { _id: false },
);

export interface IReview {
  orderId: Types.ObjectId;
  productId: Types.ObjectId;
  userId: Types.ObjectId;
  attributes: IReviewAttributeValue[];
  comment?: string;
  isVisible: boolean;
}

const reviewSchema = new Schema<IReview>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    attributes: { type: [reviewAttributeValueSchema], default: [] },
    comment: { type: String, trim: true },
    isVisible: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

// One review per product per order — prevents a customer from reviewing the same purchase twice.
reviewSchema.index({ orderId: 1, productId: 1 }, { unique: true });
reviewSchema.index({ productId: 1, createdAt: -1 });

export const Review = (models.Review as Model<IReview> | undefined) || model<IReview>("Review", reviewSchema);
