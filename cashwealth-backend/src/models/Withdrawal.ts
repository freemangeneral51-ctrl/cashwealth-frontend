import mongoose, { Schema, Document } from "mongoose";

export type WithdrawalStatus = "pending" | "approved" | "rejected";
export type WithdrawalKind = "standard" | "capital";
export type QueueStatus = "none" | "pending" | "processing" | "completed";

export interface IWithdrawal extends Document {
  userId: mongoose.Types.ObjectId;
  amount: number;
  toAddress?: string;
  status: WithdrawalStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  kind: WithdrawalKind;
  queueStatus: QueueStatus;
  queuedAt?: Date;
  processedAt?: Date;
  policyVersion?: string;
  relatedDepositIds?: mongoose.Types.ObjectId[];
  actions: {
    action: "requested" | "queued" | "processing" | "approved" | "rejected";
    at: Date;
    by?: mongoose.Types.ObjectId;
    ip?: string;
    note?: string;
  }[];
}

const WithdrawalSchema = new Schema<IWithdrawal>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    toAddress: { type: String },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    kind: { type: String, enum: ["standard", "capital"], default: "standard", index: true },
    queueStatus: { type: String, enum: ["none", "pending", "processing", "completed"], default: "none", index: true },
    queuedAt: { type: Date, index: true },
    processedAt: { type: Date },
    policyVersion: { type: String },
    relatedDepositIds: [{ type: Schema.Types.ObjectId, ref: "Deposit" }],
    actions: {
      type: [{
        action: { type: String, enum: ["requested", "queued", "processing", "approved", "rejected"], required: true },
        at: { type: Date, required: true },
        by: { type: Schema.Types.ObjectId, ref: "User" },
        ip: { type: String },
        note: { type: String },
      }],
      default: [],
    },
  },
  { timestamps: true }
);

export const Withdrawal = mongoose.model<IWithdrawal>("Withdrawal", WithdrawalSchema);
