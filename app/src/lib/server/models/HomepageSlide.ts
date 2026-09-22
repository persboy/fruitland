import { Schema, Model, model, models } from "mongoose";
import { baseSchemaOptions } from "./schemaUtils";

export interface IHomepageSlide {
  imageUrl: string;
  linkUrl?: string;
  title?: string;
  sortOrder: number;
  isActive: boolean;
}

const homepageSlideSchema = new Schema<IHomepageSlide>(
  {
    imageUrl: { type: String, required: true },
    linkUrl: { type: String },
    title: { type: String },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

homepageSlideSchema.index({ isActive: 1, sortOrder: 1 });

export const HomepageSlide =
  (models.HomepageSlide as Model<IHomepageSlide> | undefined) || model<IHomepageSlide>("HomepageSlide", homepageSlideSchema);
