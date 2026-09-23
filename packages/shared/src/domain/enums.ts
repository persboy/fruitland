/**
 * Single source of truth for every controlled domain vocabulary (roles,
 * statuses, types). Mongoose schemas, Zod validators, and UI label maps must
 * all import from here instead of redeclaring string literals — see
 * MASTER-PROMPT.md §12 "Types and Enums".
 *
 * Each enum is a frozen `as const` tuple + a derived union type. Do not add a
 * value here speculatively for a feature that has not been approved yet
 * (see docs/domain-model.md §7 "Open questions").
 */

export const USER_ROLES = ["customer", "courier", "admin", "master_admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Order lifecycle. Kept identical to the set actually exercised in the
 * legacy production system (docs/legacy-phase1) rather than inventing new
 * granularity that has not been approved.
 */
export const ORDER_STATUSES = ["preparing", "shipped", "delivered", "cancelled", "returned"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Where an order originated. "phone" = created by an operator on the customer's behalf. */
export const ORDER_SOURCES = ["online", "phone"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/**
 * Delivery sub-lifecycle, independent from Order.status (see
 * docs/domain-model.md §4). "proposed" is set by the courier; only an admin
 * can move a delivery to "resolved".
 */
export const ORDER_DELIVERY_STATUSES = [
  "unassigned",
  "assigned",
  "picked_up",
  "proposed",
  "resolved",
] as const;
export type OrderDeliveryStatus = (typeof ORDER_DELIVERY_STATUSES)[number];

/** What the courier is proposing while a delivery is in the "proposed" state. */
export const ORDER_DELIVERY_PROPOSED_OUTCOMES = ["delivered", "returned"] as const;
export type OrderDeliveryProposedOutcome = (typeof ORDER_DELIVERY_PROPOSED_OUTCOMES)[number];

export const DISCOUNT_TYPES = ["public", "personal"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/**
 * Starter sales units for fresh produce. Extensible — adding a value here is
 * additive and does not require a model migration (see docs/domain-model.md,
 * Product is intentionally kept simple rather than a generic SKU/variant system).
 */
export const PRODUCT_UNITS = ["kg", "gram_500", "piece", "bundle", "box"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export const ADDRESS_LABELS = ["home", "work", "other"] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

export const COURIER_STATUSES = ["offline", "online", "busy"] as const;
export type CourierStatus = (typeof COURIER_STATUSES)[number];

export const VEHICLE_TYPES = ["motorcycle", "car", "bicycle"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

/**
 * Notification triggers currently justified by an already-approved feature
 * (orders, discount codes). Do not add a type here for a feature that has
 * not shipped yet — extend when the triggering feature is implemented.
 */
export const NOTIFICATION_TYPES = [
  "new_order",
  "order_cancelled",
  "low_stock",
  "discount_code_expiring",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** review_attribute value type. Only "rating" is needed today; kept as an enum so a future non-numeric attribute type is additive. */
export const REVIEW_ATTRIBUTE_TYPES = ["rating"] as const;
export type ReviewAttributeType = (typeof REVIEW_ATTRIBUTE_TYPES)[number];

/** What an OTP code was requested for — one active code per (phone, purpose) pair. */
export const OTP_PURPOSES = ["login", "password_reset"] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];
