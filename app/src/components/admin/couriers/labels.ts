import type { CourierStatus, VehicleType } from "@fruitland/shared";

export const VEHICLE_LABELS: Record<VehicleType, string> = { car: "خودرو", motorcycle: "موتورسیکلت", bicycle: "دوچرخه" };
export const AVAILABILITY_LABELS: Record<CourierStatus, string> = { offline: "آفلاین", online: "آنلاین", busy: "مشغول" };

export const courierName = (c: { firstName: string | null; lastName: string | null }) => [c.firstName, c.lastName].filter(Boolean).join(" ") || "بدون نام";
