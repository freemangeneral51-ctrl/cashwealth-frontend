"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Withdrawal = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const WithdrawalSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    toAddress: { type: String },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    reviewedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
    kind: { type: String, enum: ["standard", "capital"], default: "standard", index: true },
    queueStatus: { type: String, enum: ["none", "pending", "processing", "completed"], default: "none", index: true },
    queuedAt: { type: Date, index: true },
    processedAt: { type: Date },
    policyVersion: { type: String },
    relatedDepositIds: [{ type: mongoose_1.Schema.Types.ObjectId, ref: "Deposit" }],
    actions: {
        type: [{
                action: { type: String, enum: ["requested", "queued", "processing", "approved", "rejected"], required: true },
                at: { type: Date, required: true },
                by: { type: mongoose_1.Schema.Types.ObjectId, ref: "User" },
                ip: { type: String },
                note: { type: String },
            }],
        default: [],
    },
}, { timestamps: true });
exports.Withdrawal = mongoose_1.default.model("Withdrawal", WithdrawalSchema);
