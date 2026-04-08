import mongoose, { Schema, Document } from "mongoose";

export type TxType = "deposit" | "withdrawal" | "adjustment" | "interest";

export interface ITransaction extends Document {
  userId: mongoose.Types.ObjectId;
  type: TxType;
  amount: number;
  meta?: Record<string, any>;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["deposit", "withdrawal", "adjustment", "interest"], required: true },
    amount: { type: Number, required: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const Transaction = mongoose.model<ITransaction>("Transaction", TransactionSchema);
