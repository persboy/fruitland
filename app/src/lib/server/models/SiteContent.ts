import { Schema, Model, model, models } from "mongoose";
import { baseSchemaOptions } from "./schemaUtils";

/**
 * A keyed collection (slug per page) rather than one singleton document with
 * a fixed field per page — this way adding a new static page ("shipping
 * policy", "return policy"...) is a new document, not a model change.
 */

export interface ISiteContent {
  slug: string;
  title: string;
  body: string;
  isPublished: boolean;
}

const siteContentSchema = new Schema<ISiteContent>(
  {
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    isPublished: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

export const SiteContent = (models.SiteContent as Model<ISiteContent> | undefined) || model<ISiteContent>("SiteContent", siteContentSchema);
