import { Schema, Model, model, models, Types } from "mongoose";
import { createdAtOnlySchemaOptions } from "./schemaUtils";

/**
 * Generic and append-only by design (see Domain Modeling prompt §29 — do
 * not add audit fields to every model, only where genuinely required).
 * Today's concrete requirement is MASTER-PROMPT.md §17: admin-driven
 * birthDate changes must be auditable. `before`/`after` are intentionally
 * untyped (Mixed) since this log must be able to record a change to any
 * entity without a schema change here.
 */

export interface IAuditLog {
  actorUserId: Types.ObjectId;
  action: string;
  entityType: string;
  entityId: Types.ObjectId;
  before?: unknown;
  after?: unknown;
  note?: string;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    note: { type: String },
  },
  createdAtOnlySchemaOptions,
);

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const AuditLog = (models.AuditLog as Model<IAuditLog> | undefined) || model<IAuditLog>("AuditLog", auditLogSchema);
