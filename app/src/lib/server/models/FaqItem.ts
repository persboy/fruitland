import { Schema, Model, model, models } from "mongoose";
import { baseSchemaOptions } from "./schemaUtils";

export interface IFaqItem {
  question: string;
  answer: string;
  sortOrder: number;
  isActive: boolean;
}

const faqItemSchema = new Schema<IFaqItem>(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

faqItemSchema.index({ isActive: 1, sortOrder: 1 });

export const FaqItem = (models.FaqItem as Model<IFaqItem> | undefined) || model<IFaqItem>("FaqItem", faqItemSchema);
