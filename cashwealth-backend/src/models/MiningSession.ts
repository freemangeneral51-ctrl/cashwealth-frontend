import mongoose, { Schema, Document } from "mongoose";

export type MiningStatus = "active" | "expired";

export interface IMiningSession extends Document {
  userId: mongoose.Types.ObjectId;
  activatedAt: Date;
  expiresAt: Date;
  status: MiningStatus;
  rate: number;
  earnedAmount: number;
  balanceAtActivation: number;
  credited?: boolean;
}

const MiningSessionSchema = new Schema<IMiningSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    activatedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ["active", "expired"], required: true, index: true },
    rate: { type: Number, required: true },
    earnedAmount: { type: Number, required: true },
    balanceAtActivation: { type: Number, required: true },
    credited: { type: Boolean, default: false },
  },
  { timestamps: true }
);

MiningSessionSchema.index({ userId: 1, status: 1 });

export const MiningSession = mongoose.model<IMiningSession>("MiningSession", MiningSessionSchema);
