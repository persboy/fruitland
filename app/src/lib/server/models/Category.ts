import { Schema, Model, model, models } from "mongoose";
import { baseSchemaOptions } from "./schemaUtils";

/**
 * Deliberately a real collection rather than the legacy fixed enum
 * (fruit/vegetable/produce/organic) — see docs/domain-model.md §2 for the
 * reasoning: the roadmap has an admin-manageable "Categories" page, and
 * "organic" is decoupled here into Product.isOrganic (an attribute, not a
 * category) to remove the legacy overlap.
 */

export interface ICategory {
  name: string;
  slug: string;
  icon?: string;
  sortOrder: number;
  isActive: boolean;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    icon: { type: String, trim: true },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);

categorySchema.index({ isActive: 1, sortOrder: 1 });

export const Category = (models.Category as Model<ICategory> | undefined) || model<ICategory>("Category", categorySchema);
