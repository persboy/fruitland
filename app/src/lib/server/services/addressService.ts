import { Types } from "mongoose";
import type { CreateAddressInput, UpdateAddressInput } from "../validation/addressSchemas";
import { AppError } from "../errors/AppError";
import { User, type IAddress } from "../models/User";

export interface AddressDto {
  id: string;
  label: IAddress["label"];
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  district: string | null;
  neighborhood: string | null;
  street: string | null;
  alley: string | null;
  plaque: string | null;
  unit: string | null;
  addressLine: string;
  postalCode: string | null;
  location: { latitude: number; longitude: number };
  deliveryNotes: string | null;
  resolvedBy: IAddress["resolvedBy"] | null;
  isDefault: boolean;
}

function toDto(address: IAddress): AddressDto {
  return {
    id: address._id.toString(),
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    province: address.province,
    city: address.city,
    district: address.district ?? null,
    neighborhood: address.neighborhood ?? null,
    street: address.street ?? null,
    alley: address.alley ?? null,
    plaque: address.plaque ?? null,
    unit: address.unit ?? null,
    addressLine: address.addressLine,
    postalCode: address.postalCode ?? null,
    location: address.location,
    deliveryNotes: address.deliveryNotes ?? null,
    resolvedBy: address.resolvedBy ?? null,
    isDefault: address.isDefault,
  };
}

const NOT_FOUND = () => AppError.notFound("آدرس یافت نشد", "ADDRESS_NOT_FOUND");

/** Ownership is always enforced by matching userId + addressId in the SAME query — there is no separate "does this address exist" check that could confirm another user's address to a guesser. */
async function loadOwnAddress(userId: string, addressId: string): Promise<IAddress> {
  if (!Types.ObjectId.isValid(addressId)) throw NOT_FOUND();
  const user = await User.findOne({ _id: userId, "addresses._id": addressId }, { "addresses.$": 1 });
  const address = user?.addresses[0];
  if (!address) throw NOT_FOUND();
  return address;
}

export async function listAddresses(userId: string): Promise<AddressDto[]> {
  const user = await User.findById(userId, { addresses: 1 });
  if (!user) throw AppError.notFound("کاربر یافت نشد", "USER_NOT_FOUND");
  return user.addresses.map(toDto);
}

export async function getAddress(userId: string, addressId: string): Promise<AddressDto> {
  return toDto(await loadOwnAddress(userId, addressId));
}

/**
 * `resolvedBy` is never accepted here (see addressSchemas.ts) — a created
 * address always starts with no provider provenance.
 */
export async function createAddress(userId: string, input: CreateAddressInput): Promise<AddressDto> {
  const addressId = new Types.ObjectId();
  if (input.isDefault) {
    // Guarantees "at most one default" (map spec Phase 11): clear every existing default BEFORE adding
    // the new one, in a separate write — see docs/domain-model.md §8.2 for the accepted race-window caveat.
    await User.updateOne({ _id: userId }, { $set: { "addresses.$[].isDefault": false } });
  }
  const updated = await User.findByIdAndUpdate(
    userId,
    { $push: { addresses: { _id: addressId, ...input, isDefault: Boolean(input.isDefault) } } },
    { new: true, runValidators: true },
  );
  if (!updated) throw AppError.notFound("کاربر یافت نشد", "USER_NOT_FOUND");
  const created = updated.addresses.find((a) => a._id.equals(addressId));
  if (!created) throw new Error("Address was not created as expected");
  return toDto(created);
}

export async function updateAddress(userId: string, addressId: string, input: UpdateAddressInput): Promise<AddressDto> {
  await loadOwnAddress(userId, addressId); // 404s before touching anything if it isn't this user's address
  if (input.isDefault) {
    await User.updateOne({ _id: userId }, { $set: { "addresses.$[].isDefault": false } });
  }
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) set[`addresses.$.${key}`] = value;
  const updated = await User.findOneAndUpdate(
    { _id: userId, "addresses._id": addressId },
    { $set: set },
    { new: true, runValidators: true },
  );
  const address = updated?.addresses.find((a) => a._id.toString() === addressId);
  if (!address) throw NOT_FOUND();
  return toDto(address);
}

export async function deleteAddress(userId: string, addressId: string): Promise<void> {
  await loadOwnAddress(userId, addressId);
  await User.updateOne({ _id: userId }, { $pull: { addresses: { _id: addressId } } });
}

/** Dedicated "set default" operation: makes exactly this address the default and every other one not-default. */
export async function setDefaultAddress(userId: string, addressId: string): Promise<AddressDto> {
  await loadOwnAddress(userId, addressId);
  await User.updateOne({ _id: userId }, { $set: { "addresses.$[].isDefault": false } });
  const updated = await User.findOneAndUpdate(
    { _id: userId, "addresses._id": addressId },
    { $set: { "addresses.$.isDefault": true } },
    { new: true },
  );
  const address = updated?.addresses.find((a) => a._id.toString() === addressId);
  if (!address) throw NOT_FOUND();
  return toDto(address);
}
