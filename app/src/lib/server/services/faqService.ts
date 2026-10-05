import { Types } from "mongoose";
import type { CreateFaqInput, FaqDto, UpdateFaqInput } from "@fruitland/shared";
import { AppError } from "../errors/AppError";
import { AuditLog } from "../models/AuditLog";
import { FaqItem, type IFaqItem } from "../models/FaqItem";

/**
 * Admin FAQ (MASTER-PROMPT §39 Phase 4, page 4). Same shape as categoryService:
 * no hard delete (activate/deactivate only), numeric `sortOrder`, single-document
 * writes with the AuditLog entry after the write, `isActive` only through the
 * explicit status operation, authorization in the route (`requireAdmin`).
 * There is no unique field, so there is no duplicate-key mapping.
 */

type FaqRecord = IFaqItem & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

const NOT_FOUND = () => AppError.notFound("سؤال متداول یافت نشد", "FAQ_NOT_FOUND");

const toDto = (f: FaqRecord): FaqDto => ({
  id: f._id.toString(),
  question: f.question,
  answer: f.answer,
  sortOrder: f.sortOrder,
  isActive: f.isActive,
  createdAt: f.createdAt.toISOString(),
  updatedAt: f.updatedAt.toISOString(),
});

const snapshot = (f: Pick<IFaqItem, "question" | "answer" | "sortOrder" | "isActive">) => ({
  question: f.question,
  answer: f.answer,
  sortOrder: f.sortOrder,
  isActive: f.isActive,
});

function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw NOT_FOUND();
  return new Types.ObjectId(id);
}

/** Deterministic: sortOrder ascending, then _id (creation order). Active and inactive. */
export async function listFaqs(): Promise<FaqDto[]> {
  const docs = await FaqItem.find({}).sort({ sortOrder: 1, _id: 1 }).lean<FaqRecord[]>();
  return docs.map(toDto);
}

export async function createFaq(actorUserId: string, input: CreateFaqInput): Promise<FaqDto> {
  const created = await FaqItem.create({
    question: input.question,
    answer: input.answer,
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    // isActive is never taken from the client: a new item uses the model default (active).
  });
  await AuditLog.create({
    actorUserId,
    action: "faq.created",
    entityType: "FaqItem",
    entityId: created._id,
    before: null,
    after: snapshot(created),
  });
  return toDto(created as unknown as FaqRecord);
}

export async function updateFaq(actorUserId: string, id: string, input: UpdateFaqInput): Promise<FaqDto> {
  const _id = toObjectId(id);
  const $set: Record<string, unknown> = {};
  if (input.question !== undefined) $set.question = input.question;
  if (input.answer !== undefined) $set.answer = input.answer;
  if (input.sortOrder !== undefined) $set.sortOrder = input.sortOrder;

  const before = await FaqItem.findOneAndUpdate({ _id }, { $set }, { new: false, runValidators: true }).lean<FaqRecord | null>();
  if (!before) throw NOT_FOUND();

  const after = { ...before, ...$set } as FaqRecord;
  await AuditLog.create({
    actorUserId,
    action: "faq.updated",
    entityType: "FaqItem",
    entityId: _id,
    before: snapshot(before),
    after: snapshot(after),
  });
  const fresh = await FaqItem.findById(_id).lean<FaqRecord | null>();
  return toDto(fresh ?? after);
}

/** Explicit set (not toggle); the state it already has is a successful no-op without write or audit. */
export async function setFaqActive(actorUserId: string, id: string, isActive: boolean): Promise<FaqDto> {
  const _id = toObjectId(id);
  const current = await FaqItem.findById(_id).lean<FaqRecord | null>();
  if (!current) throw NOT_FOUND();
  if (current.isActive === isActive) return toDto(current);

  const before = await FaqItem.findOneAndUpdate({ _id, isActive: !isActive }, { $set: { isActive } }, { new: false }).lean<FaqRecord | null>();
  if (!before) {
    const latest = await FaqItem.findById(_id).lean<FaqRecord | null>();
    if (!latest) throw NOT_FOUND();
    return toDto(latest); // a concurrent request already set this state
  }
  await AuditLog.create({
    actorUserId,
    action: isActive ? "faq.activated" : "faq.deactivated",
    entityType: "FaqItem",
    entityId: _id,
    before: { isActive: before.isActive },
    after: { isActive },
  });
  const fresh = await FaqItem.findById(_id).lean<FaqRecord | null>();
  return toDto(fresh ?? { ...before, isActive });
}
