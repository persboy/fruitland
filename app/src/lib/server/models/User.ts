import { Schema, Model, model, models, Types } from "mongoose";
import {
  ADDRESS_LABELS,
  COURIER_STATUSES,
  MAP_PROVIDER_NAMES,
  USER_ROLES,
  VEHICLE_TYPES,
  type AddressLabel,
  type CourierStatus,
  type MapProviderName,
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

/**
 * Address is Provider-independent (Maps Phase 4.5 §12-13/§19-21): the
 * structured components below come from whichever MapProvider resolved them
 * (`resolvedBy`, provenance-only — business logic never reads it), but the
 * schema itself is generic. Anything a provider could not resolve is
 * genuinely absent, never guessed or copied from `addressLine`.
 *
 * `addressLine` (pre-existing) stays the ONE authoritative, user-facing full
 * address text — the same field a courier reads and an order snapshots. A
 * provider's `formattedAddress` is only ever used to *prefill* `addressLine`
 * in the picker UI (map spec §32: auto-generated text must stay editable);
 * it is not persisted separately, which would be a parallel/duplicate field.
 * Likewise `label` (already existing) covers "home/work/other" — no separate
 * free-text `title` was added on top of it.
 *
 * `location` (pre-existing, previously optional `{lat,lng}`) is renamed to
 * `{latitude,longitude}` to exactly match the shared `Coordinates` shape used
 * everywhere in `lib/server/maps` — an Address's location can be passed to
 * MapService with no conversion. It is now REQUIRED (map spec §20: "always
 * store coordinates, never just text"); safe to tighten now since no code yet
 * creates Address documents.
 */
export interface IAddress {
  _id: Types.ObjectId;
  label: AddressLabel;
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  district?: string;
  neighborhood?: string;
  street?: string;
  alley?: string;
  plaque?: string;
  unit?: string;
  addressLine: string;
  postalCode?: string;
  location: { latitude: number; longitude: number };
  /** Free-text instructions for the courier (e.g. "زنگ همسایه را بزنید"), not part of the address itself. */
  deliveryNotes?: string;
  /** Provenance only (map spec §21) — which provider resolved this address, never used by business logic. Absent for manually-entered addresses. */
  resolvedBy?: { provider: MapProviderName; providerPlaceId: string | null; resolvedAt: Date };
  isDefault: boolean;
}

const resolvedBySchema = new Schema(
  {
    provider: { type: String, enum: MAP_PROVIDER_NAMES, required: true },
    providerPlaceId: { type: String, default: null },
    resolvedAt: { type: Date, required: true },
  },
  { _id: false },
);

const addressSchema = new Schema<IAddress>(
  {
    label: { type: String, enum: ADDRESS_LABELS, default: "home" },
    recipientName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    province: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    district: { type: String, trim: true },
    neighborhood: { type: String, trim: true },
    street: { type: String, trim: true },
    alley: { type: String, trim: true },
    plaque: { type: String, trim: true },
    unit: { type: String, trim: true },
    addressLine: { type: String, required: true, trim: true },
    postalCode: { type: String, trim: true },
    location: {
      type: new Schema(
        {
          latitude: { type: Number, required: true, min: -90, max: 90 },
          longitude: { type: Number, required: true, min: -180, max: 180 },
        },
        { _id: false },
      ),
      required: true,
    },
    deliveryNotes: { type: String, trim: true },
    resolvedBy: { type: resolvedBySchema, default: undefined },
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

/**
 * Admin Customers list (role = "customer", newest first, optionally filtered by
 * isActive): the equality field `role` followed by the sort field `createdAt`.
 * Supersedes the single-field `role` index for that query.
 */
userSchema.index({ role: 1, createdAt: -1 });

export const User = (models.User as Model<IUser> | undefined) || model<IUser>("User", userSchema);
