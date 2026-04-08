import mongoose, { Schema, Document } from "mongoose";

export interface IEmailToken extends Document {
  userId: mongoose.Types.ObjectId;
  codeHash: string;
  type: "verify";
  expiresAt: Date;
}

const EmailTokenSchema = new Schema<IEmailToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    codeHash: { type: String, required: true },
    type: { type: String, enum: ["verify"], default: "verify" },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const EmailToken = mongoose.model<IEmailToken>("EmailToken", EmailTokenSchema);
