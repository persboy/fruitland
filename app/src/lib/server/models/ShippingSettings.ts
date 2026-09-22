import { Schema, Model, model, models } from "mongoose";
import { baseSchemaOptions, SINGLETON_KEY, tomanValidator } from "./schemaUtils";

/**
 * Project Instructions §8: "The following values must have one source of
 * truth: Express delivery fee, Free-delivery threshold." A singleton
 * document (rather than scattering these as constants) is that single
 * source — order totals must always read from here, never hardcode.
 */

export interface IShippingSettings {
  key: typeof SINGLETON_KEY;
  expressDeliveryFee: number;
  freeDeliveryThreshold: number;
}

const shippingSettingsSchema = new Schema<IShippingSettings>(
  {
    key: { type: String, required: true, unique: true, default: SINGLETON_KEY },
    expressDeliveryFee: { type: Number, required: true, min: 0, validate: tomanValidator },
    freeDeliveryThreshold: { type: Number, required: true, min: 0, validate: tomanValidator },
  },
  baseSchemaOptions,
);

export const ShippingSettings =
  (models.ShippingSettings as Model<IShippingSettings> | undefined) || model<IShippingSettings>("ShippingSettings", shippingSettingsSchema);
