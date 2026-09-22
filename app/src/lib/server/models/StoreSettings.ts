import { Schema, Model, model, models } from "mongoose";
import { baseSchemaOptions, SINGLETON_KEY } from "./schemaUtils";

export interface IStoreSettings {
  key: typeof SINGLETON_KEY;
  storeName: string;
  supportPhone: string;
  address?: string;
  socialLinks?: { instagram?: string; telegram?: string; whatsapp?: string };
}

const storeSettingsSchema = new Schema<IStoreSettings>(
  {
    key: { type: String, required: true, unique: true, default: SINGLETON_KEY },
    storeName: { type: String, required: true },
    supportPhone: { type: String, required: true },
    address: { type: String },
    socialLinks: {
      type: new Schema(
        { instagram: String, telegram: String, whatsapp: String },
        { _id: false },
      ),
      required: false,
    },
  },
  baseSchemaOptions,
);

export const StoreSettings =
  (models.StoreSettings as Model<IStoreSettings> | undefined) || model<IStoreSettings>("StoreSettings", storeSettingsSchema);
