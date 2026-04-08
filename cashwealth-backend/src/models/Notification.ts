import mongoose, { Schema, Document } from "mongoose";

export type NotificationType =
  | "deposit_approved"
  | "withdrawal_approved"
  | "deposit_rejected"
  | "withdrawal_rejected"
  | "admin_broadcast";

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  type: NotificationType;
  message: string;
  read: boolean;
  meta?: Record<string, any>;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["deposit_approved", "withdrawal_approved", "deposit_rejected", "withdrawal_rejected", "admin_broadcast"],
      required: true,
    },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const Notification = mongoose.model<INotification>("Notification", NotificationSchema);
