import { Schema, Model, model, models } from "mongoose";
import { REVIEW_ATTRIBUTE_TYPES, type ReviewAttributeType } from "@fruitland/shared";
import { baseSchemaOptions } from "./schemaUtils";

export interface IReviewAttribute {
  key: string;
  label: string;
  type: ReviewAttributeType;
  minValue: number;
  maxValue: number;
  isActive: boolean;
  sortOrder: number;
}

const reviewAttributeSchema = new Schema<IReviewAttribute>(
  {
    key: { type: String, required: true, trim: true, lowercase: true, unique: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: REVIEW_ATTRIBUTE_TYPES, default: "rating" },
    minValue: { type: Number, default: 1 },
    maxValue: { type: Number, default: 5 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);

export const ReviewAttribute =
  (models.ReviewAttribute as Model<IReviewAttribute> | undefined) || model<IReviewAttribute>("ReviewAttribute", reviewAttributeSchema);
