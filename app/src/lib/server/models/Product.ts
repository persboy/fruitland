import { Schema, Model, model, models, Types } from "mongoose";
import { PRODUCT_UNITS, type ProductUnit } from "@fruitland/shared";
import { baseSchemaOptions, tomanValidator } from "./schemaUtils";

/**
 * Fresh-produce products can be sold in more than one unit at different
 * prices (e.g. per kg and per box), so each sale option is an embedded
 * ProductVariant rather than a generic SKU/variant system — see
 * docs/domain-model.md §2 and the Domain Modeling prompt §16-17.
 * A variant has no independent identity/lifecycle outside its product, so it
 * is embedded, not a separate collection.
 */

export interface IProductVariant {
  _id: Types.ObjectId;
  unit: ProductUnit;
  /** Integer Toman. This is the CURRENT price — orders snapshot it into OrderItem.unitPrice at purchase time, see Order.ts. */
  price: number;
  isAvailable: boolean;
}

const productVariantSchema = new Schema<IProductVariant>(
  {
    unit: { type: String, enum: PRODUCT_UNITS, required: true },
    price: { type: Number, required: true, min: 0, validate: tomanValidator },
    isAvailable: { type: Boolean, default: true },
  },
  { _id: true },
);

export interface IProduct {
  name: string;
  slug: string;
  categoryId: Types.ObjectId;
  description?: string;
  images: string[];
  isOrganic: boolean;
  isActive: boolean;
  sortOrder: number;
  variants: IProductVariant[];
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    description: { type: String, trim: true },
    images: { type: [String], default: [] },
    isOrganic: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    variants: {
      type: [productVariantSchema],
      validate: {
        validator: (v: IProductVariant[]) => v.length > 0,
        message: "Product must have at least one variant",
      },
    },
  },
  baseSchemaOptions,
);

productSchema.index({ categoryId: 1, isActive: 1 });
productSchema.index({ name: "text" });

export const Product = (models.Product as Model<IProduct> | undefined) || model<IProduct>("Product", productSchema);
