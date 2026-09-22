import { Schema, Model, model, models, Types } from "mongoose";
import { NOTIFICATION_TYPES, type NotificationType } from "@fruitland/shared";
import { baseSchemaOptions } from "./schemaUtils";

export interface INotification {
  type: NotificationType;
  title: string;
  body?: string;
  /** Generic pointer to the entity this notification is about (e.g. an Order id). */
  referenceType?: string;
  referenceId?: Types.ObjectId;
  isRead: boolean;
  readAt?: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String },
    referenceType: { type: String },
    referenceId: { type: Schema.Types.ObjectId },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
  },
  baseSchemaOptions,
);

notificationSchema.index({ isRead: 1, createdAt: -1 });

export const Notification =
  (models.Notification as Model<INotification> | undefined) || model<INotification>("Notification", notificationSchema);
