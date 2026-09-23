import { Schema, Model, model, models, Types } from "mongoose";
import {
  ADDRESS_LABELS,
  COURIER_STATUSES,
  USER_ROLES,
  VEHICLE_TYPES,
  type AddressLabel,
  type CourierStatus,
  type UserRole,
  type VehicleType,
} from "@fruitland/shared";
import { baseSchemaOptions } from "./schemaUtils";

const userSchemaOptions = {
  ...baseSchemaOptions,
  toJSON: {
    ...baseSchemaOptions.toJSON,
    transform: (doc: unknown, ret: Record<string, unknown>) => {
      const transformed = baseSchemaOptions.toJSON.transform(doc, ret);
      delete transformed.passwordHash;
      delete transformed.passwordFailedAttempts;
      delete transformed.passwordLockedUntil;
      return transformed;
    },
  },
};

/**
 * A single User collection covers all three roles (customer/courier/admin),
 * per docs/domain-model.md §5.1 — role-specific data lives in an optional
 * embedded sub-object (`courierProfile`) rather than a separate collection,
 * since there is no independent lifecycle/query need for it today.
 *
 * Deliberately excluded from this phase (see docs/domain-model.md §7):
 * password/OTP/session fields (auth strategy not approved), bankInfo and
 * wallet-related fields (wallet not approved), admin permission grants
 * (no granular permission system approved yet — role alone gates access).
 */

export interface IAddress {
  _id: Types.ObjectId;
  label: AddressLabel;
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  addressLine: string;
  postalCode?: string;
  location?: { lat: number; lng: number };
  isDefault: boolean;
}

const addressSchema = new Schema<IAddress>(
  {
    label: { type: String, enum: ADDRESS_LABELS, default: "home" },
    recipientName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    province: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    addressLine: { type: String, required: true, trim: true },
    postalCode: { type: String, trim: true },
    location: {
      type: new Schema({ lat: Number, lng: Number }, { _id: false }),
      required: false,
    },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

export interface ICourierProfile {
  vehicleType: VehicleType;
  plateNumber?: string;
  status: CourierStatus;
  currentLocation?: { lat: number; lng: number; updatedAt: Date };
}

const courierProfileSchema = new Schema<ICourierProfile>(
  {
    vehicleType: { type: String, enum: VEHICLE_TYPES, required: true },
    plateNumber: { type: String, trim: true },
    status: { type: String, enum: COURIER_STATUSES, default: "offline" },
    currentLocation: {
      type: new Schema({ lat: Number, lng: Number, updatedAt: Date }, { _id: false }),
      required: false,
    },
  },
  { _id: false },
);

export interface IUser {
  phone: string;
  role: UserRole;
  firstName?: string;
  lastName?: string;
  /**
   * Cannot be changed by the user after registration; may only be changed by
   * an authorized admin, and that change must be written to AuditLog — this
   * is an authorization rule enforced in the service layer, NOT a Mongoose
   * `immutable` flag (which would also block the legitimate admin path).
   */
  birthDate?: Date;
  isActive: boolean;
  lastLoginAt?: Date;
  /** 5-digit business identifier used to look a customer up for a phone order. Generated + uniqueness-retried in the service layer. */
  customerCode?: string;
  referralCode?: string;
  referredByUserId?: Types.ObjectId;
  addresses: IAddress[];
  courierProfile?: ICourierProfile;
  /**
   * Password login is only meaningful for admin/master_admin (customers and
   * couriers use OTP only) — see docs/auth.md. `select: false` so a normal
   * `User.findOne(...)` never returns this by accident; auth code must
   * explicitly `.select("+passwordHash")`.
   */
  passwordHash?: string;
  passwordFailedAttempts: number;
  passwordLockedUntil?: Date;
}

const userSchema = new Schema<IUser>(
  {
    phone: { type: String, required: true, trim: true, unique: true, index: true },
    role: { type: String, enum: USER_ROLES, required: true, default: "customer", index: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    birthDate: { type: Date },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    customerCode: { type: String, unique: true, sparse: true },
    referralCode: { type: String, unique: true, sparse: true },
    referredByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    addresses: { type: [addressSchema], default: [] },
    courierProfile: { type: courierProfileSchema, required: false },
    passwordHash: { type: String, select: false },
    passwordFailedAttempts: { type: Number, default: 0, select: false },
    passwordLockedUntil: { type: Date, select: false },
  },
  userSchemaOptions,
);

export const User = (models.User as Model<IUser> | undefined) || model<IUser>("User", userSchema);
