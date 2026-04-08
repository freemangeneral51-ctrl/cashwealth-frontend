"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Deposit_1 = require("../models/Deposit");
const User_1 = require("../models/User");
const Transaction_1 = require("../models/Transaction");
const Notification_1 = require("../models/Notification");
const Withdrawal_1 = require("../models/Withdrawal");
const PlatformPolicy_1 = require("../models/PlatformPolicy");
const joi_1 = __importDefault(require("joi"));
const mongoose_1 = __importDefault(require("mongoose"));
const router = (0, express_1.Router)();
function requireAdmin(req, res, next) {
    if (req.role !== "admin")
        return res.status(403).json({ message: "Forbidden" });
    next();
}
async function currentPolicy() {
    const found = await PlatformPolicy_1.PlatformPolicy.findOne().sort({ createdAt: -1 });
    if (found)
        return found;
    return PlatformPolicy_1.PlatformPolicy.create({
        policyVersion: "v1.0.0",
        policyText: "By investing, you agree that your capital will be locked for 6 months (180 days) and cannot be withdrawn during this period.",
        miningDisclaimerText: "Your invested capital is locked for 6 months from the date of deposit. You may only withdraw your initial capital after the lock period expires.",
        lockDurationDays: 180,
        withdrawalsPaused: false,
        availableLiquidity: 0,
    });
}
function requestIp(req) {
    const forwarded = req.headers?.["x-forwarded-for"];
    if (Array.isArray(forwarded) && forwarded.length > 0)
        return String(forwarded[0]).trim();
    if (typeof forwarded === "string" && forwarded.trim())
        return forwarded.split(",")[0].trim();
    return String(req.ip || req.socket?.remoteAddress || "");
}
router.get("/deposits", requireAdmin, async (_req, res) => {
    const list = await Deposit_1.Deposit.find().sort({ createdAt: -1 }).populate({ path: "userId", select: "email name publicId balance" });
    const mapped = list.map((d) => {
        const obj = d.toObject();
        const u = obj.userId;
        return {
            ...obj,
            user: u
                ? {
                    id: String(u._id),
                    name: u.name,
                    email: u.email,
                    publicId: u.publicId,
                    balance: u.balance,
                }
                : null,
            userName: u?.name || undefined,
            userEmail: u?.email || undefined,
            userPublicId: u?.publicId || undefined,
            userBalance: typeof u?.balance === "number" ? u.balance : undefined,
        };
    });
    res.json(mapped);
});
const reviewSchema = joi_1.default.object({
    status: joi_1.default.string().valid("approved", "rejected").required(),
});
router.post("/deposits/:id/review", requireAdmin, async (req, res) => {
    const { error, value } = reviewSchema.validate(req.body);
    if (error)
        return res.status(400).json({ message: error.message });
    const policy = await currentPolicy();
    const dep = await Deposit_1.Deposit.findById(req.params.id);
    if (!dep)
        return res.status(404).json({ message: "Not found" });
    if (dep.status !== "pending")
        return res.status(400).json({ message: "Already reviewed" });
    dep.status = value.status;
    dep.reviewedBy = req.userId;
    if (value.status === "approved") {
        const lockDays = Number(dep.lockDurationDays || policy.lockDurationDays || 180);
        const createdAtValue = dep.createdAt;
        const baseDate = createdAtValue ? new Date(createdAtValue) : new Date();
        dep.lockDurationDays = lockDays;
        dep.capitalUnlockAt = dep.capitalUnlockAt || new Date(baseDate.getTime() + lockDays * 24 * 60 * 60 * 1000);
        dep.capitalWithdrawalStatus = "locked";
        dep.withdrawalQueueStatus = "none";
        dep.policyVersionAccepted = dep.policyVersionAccepted || policy.policyVersion;
        dep.agreementAcceptedAt = dep.agreementAcceptedAt || baseDate;
    }
    await dep.save();
    if (value.status === "approved") {
        await User_1.User.findByIdAndUpdate(dep.userId, { $inc: { balance: dep.amount } });
        await Transaction_1.Transaction.create({ userId: dep.userId, type: "deposit", amount: dep.amount, meta: { depositId: dep.id } });
        // Referral bonus: 10% of deposit to referrer if exists
        const depositor = await User_1.User.findById(dep.userId);
        if (depositor?.referredBy) {
            const bonus = Number((dep.amount * 0.10).toFixed(2));
            if (bonus > 0) {
                await User_1.User.findByIdAndUpdate(depositor.referredBy, { $inc: { balance: bonus } });
                await Transaction_1.Transaction.create({
                    userId: depositor.referredBy,
                    type: "adjustment",
                    amount: bonus,
                    meta: { referralBonus: true, fromUserId: depositor._id, depositId: dep.id }
                });
            }
        }
        await Notification_1.Notification.create({
            userId: dep.userId,
            type: "deposit_approved",
            message: `Deposit of $${dep.amount.toFixed(2)} approved`,
            meta: { depositId: dep.id },
        });
    }
    else {
        await Notification_1.Notification.create({
            userId: dep.userId,
            type: "deposit_rejected",
            message: `Deposit of $${dep.amount.toFixed(2)} rejected`,
            meta: { depositId: dep.id },
        });
    }
    res.json({ message: "Updated" });
});
router.get("/withdrawals", requireAdmin, async (_req, res) => {
    const list = await Withdrawal_1.Withdrawal.find().sort({ createdAt: -1 }).populate({ path: "userId", select: "email name publicId balance" });
    const mapped = await Promise.all(list.map(async (w) => {
        const obj = w.toObject();
        const u = obj.userId;
        let queuePosition = undefined;
        if (obj.kind === "capital" && obj.status === "pending" && obj.queueStatus === "pending" && obj.queuedAt) {
            queuePosition = await Withdrawal_1.Withdrawal.countDocuments({
                kind: "capital",
                status: "pending",
                queueStatus: "pending",
                queuedAt: { $lt: obj.queuedAt },
            }) + 1;
        }
        return {
            ...obj,
            queuePosition,
            user: u
                ? {
                    id: String(u._id),
                    name: u.name,
                    email: u.email,
                    publicId: u.publicId,
                    balance: u.balance,
                }
                : null,
            userName: u?.name || undefined,
            userEmail: u?.email || undefined,
            userPublicId: u?.publicId || undefined,
            userBalance: typeof u?.balance === "number" ? u.balance : undefined,
        };
    }));
    res.json(mapped);
});
const wReviewSchema = joi_1.default.object({
    status: joi_1.default.string().valid("approved", "rejected").required(),
});
router.post("/withdrawals/:id/review", requireAdmin, async (req, res) => {
    const { error, value } = wReviewSchema.validate(req.body);
    if (error)
        return res.status(400).json({ message: error.message });
    const w = await Withdrawal_1.Withdrawal.findById(req.params.id);
    if (!w)
        return res.status(404).json({ message: "Not found" });
    if (w.status !== "pending")
        return res.status(400).json({ message: "Already reviewed" });
    const policy = await currentPolicy();
    if (w.kind === "capital" && w.queueStatus === "pending" && w.queuedAt) {
        const head = await Withdrawal_1.Withdrawal.findOne({
            kind: "capital",
            status: "pending",
            queueStatus: "pending",
        }).sort({ queuedAt: 1, createdAt: 1 });
        if (!head || String(head._id) !== String(w._id)) {
            return res.status(400).json({ message: "This request is not at the front of the capital withdrawal queue" });
        }
        if (value.status === "approved" && Math.abs(w.amount) > Number(policy.availableLiquidity || 0)) {
            return res.status(400).json({ message: "Insufficient platform liquidity for this capital withdrawal" });
        }
        w.queueStatus = "processing";
        w.actions.push({
            action: "processing",
            at: new Date(),
            by: req.userId,
            ip: requestIp(req),
            note: "Moved to processing by admin",
        });
        await w.save();
    }
    w.status = value.status;
    w.reviewedBy = req.userId;
    w.processedAt = new Date();
    if (w.kind === "capital")
        w.queueStatus = "completed";
    w.actions.push({
        action: value.status === "approved" ? "approved" : "rejected",
        at: new Date(),
        by: req.userId,
        ip: requestIp(req),
    });
    await w.save();
    if (value.status === "approved") {
        await User_1.User.findByIdAndUpdate(w.userId, { $inc: { balance: -Math.abs(w.amount) } });
        await Transaction_1.Transaction.create({ userId: w.userId, type: "withdrawal", amount: Math.abs(w.amount), meta: { withdrawalId: w.id } });
        if (w.kind === "capital") {
            await PlatformPolicy_1.PlatformPolicy.updateOne({ _id: policy._id }, { $inc: { availableLiquidity: -Math.abs(w.amount) } });
            if (Array.isArray(w.relatedDepositIds) && w.relatedDepositIds.length > 0) {
                await Deposit_1.Deposit.updateMany({ _id: { $in: w.relatedDepositIds } }, {
                    $set: {
                        capitalWithdrawalStatus: "withdrawn",
                        withdrawalQueueStatus: "completed",
                        capitalWithdrawnAt: new Date(),
                    },
                });
            }
        }
        await Notification_1.Notification.create({
            userId: w.userId,
            type: "withdrawal_approved",
            message: `Withdrawal of $${w.amount.toFixed(2)} approved`,
            meta: { withdrawalId: w.id },
        });
    }
    else {
        if (w.kind === "capital" && Array.isArray(w.relatedDepositIds) && w.relatedDepositIds.length > 0) {
            await Deposit_1.Deposit.updateMany({ _id: { $in: w.relatedDepositIds } }, { $set: { capitalWithdrawalStatus: "eligible", withdrawalQueueStatus: "none" } });
        }
        await Notification_1.Notification.create({
            userId: w.userId,
            type: "withdrawal_rejected",
            message: `Withdrawal of $${w.amount.toFixed(2)} rejected`,
            meta: { withdrawalId: w.id },
        });
    }
    res.json({ message: "Updated" });
});
const policyUpdateSchema = joi_1.default.object({
    policyVersion: joi_1.default.string().trim().min(1),
    policyText: joi_1.default.string().trim().min(1),
    miningDisclaimerText: joi_1.default.string().trim().min(1),
    lockDurationDays: joi_1.default.number().integer().min(1),
    withdrawalsPaused: joi_1.default.boolean(),
    availableLiquidity: joi_1.default.number().min(0),
});
router.get("/policy", requireAdmin, async (_req, res) => {
    const policy = await currentPolicy();
    res.json(policy);
});
router.put("/policy", requireAdmin, async (req, res) => {
    const { error, value } = policyUpdateSchema.validate(req.body || {});
    if (error)
        return res.status(400).json({ message: error.message });
    const policy = await currentPolicy();
    if (value.lockDurationDays && !value.policyVersion) {
        return res.status(400).json({ message: "Updating lock duration requires a new policyVersion" });
    }
    await PlatformPolicy_1.PlatformPolicy.updateOne({ _id: policy._id }, { $set: value });
    const next = await PlatformPolicy_1.PlatformPolicy.findById(policy._id);
    res.json(next);
});
router.get("/capital/summary", requireAdmin, async (_req, res) => {
    const now = new Date();
    const [policy, withdrawableAgg, pendingAgg] = await Promise.all([
        currentPolicy(),
        Deposit_1.Deposit.aggregate([
            { $match: { status: "approved", capitalWithdrawalStatus: { $in: ["eligible", "locked"] }, capitalUnlockAt: { $lte: now } } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        Withdrawal_1.Withdrawal.aggregate([
            { $match: { kind: "capital", status: "pending", queueStatus: { $in: ["pending", "processing"] } } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
    ]);
    const totalWithdrawableCapital = Number(withdrawableAgg[0]?.total || 0);
    const totalPendingWithdrawals = Number(pendingAgg[0]?.total || 0);
    res.json({
        totalWithdrawableCapital,
        totalPendingWithdrawals,
        availableLiquidity: Number(policy.availableLiquidity || 0),
        withdrawalsPaused: !!policy.withdrawalsPaused,
        lockDurationDays: Number(policy.lockDurationDays || 180),
        policyVersion: policy.policyVersion,
    });
});
router.post("/dev/reset-db", requireAdmin, async (_req, res) => {
    const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production";
    if (isProd)
        return res.status(403).json({ message: "Forbidden" });
    try {
        await mongoose_1.default.connection.dropDatabase();
        res.json({ message: "Database dropped" });
    }
    catch (e) {
        res.status(500).json({ message: "Failed to drop database" });
    }
});
exports.default = router;
