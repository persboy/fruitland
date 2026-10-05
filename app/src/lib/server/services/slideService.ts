import { Types } from "mongoose";
import type { CreateSlideInput, SlideDto, UpdateSlideInput } from "@fruitland/shared";
import { AppError } from "../errors/AppError";
import { AuditLog } from "../models/AuditLog";
import { HomepageSlide, type IHomepageSlide } from "../models/HomepageSlide";

/**
 * Admin homepage slides (MASTER-PROMPT §39 Phase 4, page 4). Same shape as
 * categoryService: no hard delete, numeric `sortOrder` (a normal persisted
 * integer — no swapping), single-document writes + AuditLog after the write.
 * `imageUrl` is an external http(s) URL (validated by the shared schema; no
 * upload). `linkUrl` is a validated destination string only — it is NOT checked
 * against any storefront route (none exist yet).
 */

type SlideRecord = IHomepageSlide & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

const NOT_FOUND = () => AppError.notFound("اسلاید یافت نشد", "SLIDE_NOT_FOUND");

const toDto = (s: SlideRecord): SlideDto => ({
  id: s._id.toString(),
  imageUrl: s.imageUrl,
  title: s.title ? s.title : null,
  linkUrl: s.linkUrl ? s.linkUrl : null,
  sortOrder: s.sortOrder,
  isActive: s.isActive,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

const snapshot = (s: Pick<IHomepageSlide, "imageUrl" | "title" | "linkUrl" | "sortOrder" | "isActive">) => ({
  imageUrl: s.imageUrl,
  title: s.title ? s.title : null,
  linkUrl: s.linkUrl ? s.linkUrl : null,
  sortOrder: s.sortOrder,
  isActive: s.isActive,
});

function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw NOT_FOUND();
  return new Types.ObjectId(id);
}

export async function listSlides(): Promise<SlideDto[]> {
  const docs = await HomepageSlide.find({}).sort({ sortOrder: 1, _id: 1 }).lean<SlideRecord[]>();
  return docs.map(toDto);
}

export async function createSlide(actorUserId: string, input: CreateSlideInput): Promise<SlideDto> {
  const created = await HomepageSlide.create({
    imageUrl: input.imageUrl,
    ...(input.title ? { title: input.title } : {}),
    ...(input.linkUrl ? { linkUrl: input.linkUrl } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    // isActive is never taken from the client: a new slide uses the model default (active).
  });
  await AuditLog.create({
    actorUserId,
    action: "homepageSlide.created",
    entityType: "HomepageSlide",
    entityId: created._id,
    before: null,
    after: snapshot(created),
  });
  return toDto(created as unknown as SlideRecord);
}

export async function updateSlide(actorUserId: string, id: string, input: UpdateSlideInput): Promise<SlideDto> {
  const _id = toObjectId(id);
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  if (input.imageUrl !== undefined) $set.imageUrl = input.imageUrl;
  if (input.sortOrder !== undefined) $set.sortOrder = input.sortOrder;
  for (const key of ["title", "linkUrl"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (value === "") $unset[key] = 1;
    else $set[key] = value;
  }

  const before = await HomepageSlide.findOneAndUpdate(
    { _id },
    { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
    { new: false, runValidators: true },
  ).lean<SlideRecord | null>();
  if (!before) throw NOT_FOUND();

  const after = {
    ...before,
    ...$set,
    ...(input.title === "" ? { title: undefined } : {}),
    ...(input.linkUrl === "" ? { linkUrl: undefined } : {}),
  } as SlideRecord;
  await AuditLog.create({
    actorUserId,
    action: "homepageSlide.updated",
    entityType: "HomepageSlide",
    entityId: _id,
    before: snapshot(before),
    after: snapshot(after),
  });
  const fresh = await HomepageSlide.findById(_id).lean<SlideRecord | null>();
  return toDto(fresh ?? after);
}

/** Explicit set (not toggle); the state it already has is a successful no-op without write or audit. */
export async function setSlideActive(actorUserId: string, id: string, isActive: boolean): Promise<SlideDto> {
  const _id = toObjectId(id);
  const current = await HomepageSlide.findById(_id).lean<SlideRecord | null>();
  if (!current) throw NOT_FOUND();
  if (current.isActive === isActive) return toDto(current);

  const before = await HomepageSlide.findOneAndUpdate({ _id, isActive: !isActive }, { $set: { isActive } }, { new: false }).lean<SlideRecord | null>();
  if (!before) {
    const latest = await HomepageSlide.findById(_id).lean<SlideRecord | null>();
    if (!latest) throw NOT_FOUND();
    return toDto(latest);
  }
  await AuditLog.create({
    actorUserId,
    action: isActive ? "homepageSlide.activated" : "homepageSlide.deactivated",
    entityType: "HomepageSlide",
    entityId: _id,
    before: { isActive: before.isActive },
    after: { isActive },
  });
  const fresh = await HomepageSlide.findById(_id).lean<SlideRecord | null>();
  return toDto(fresh ?? { ...before, isActive });
}
