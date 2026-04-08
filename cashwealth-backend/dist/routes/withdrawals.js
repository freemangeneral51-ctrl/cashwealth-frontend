"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const joi_1 = __importDefault(require("joi"));
const Withdrawal_1 = require("../models/Withdrawal");
const Deposit_1 = require("../models/Deposit");
const PlatformPolicy_1 = require("../models/PlatformPolicy");
const router = (0, express_1.Router)();
const submitSchema = joi_1.default.object({
    amount: joi_1.default.number().positive().required(),
    toAddress: joi_1.default.string().allow("", null),
});
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
router.post("/submit", async (req, res) => {
    const { error, value } = submitSchema.validate(req.body);
    if (error)
        return res.status(400).json({ message: error.message });
    const userId = req.userId;
    const policy = await currentPolicy();
    if (policy.withdrawalsPaused)
        return res.status(423).json({ message: "Capital withdrawals are temporarily paused" });
    const activeRequest = await Withdrawal_1.Withdrawal.findOne({
        userId,
        kind: "capital",
        status: "pending",
        queueStatus: { $in: ["pending", "processing"] },
    });
    if (activeRequest) {
        return res.status(400).json({ message: "You already have a pending capital withdrawal request" });
    }
    const amount = Math.abs(Number(value.amount));
    if (isNaN(amount))
        return res.status(400).json({ message: "Invalid amount" });
    const now = new Date();
    await Deposit_1.Deposit.updateMany({
        userId,
        status: "approved",
        capitalWithdrawalStatus: "locked",
        capitalUnlockAt: { $lte: now },
    }, { $set: { capitalWithdrawalStatus: "eligible" } });
    const eligibleDeposits = await Deposit_1.Deposit.find({
        userId,
        status: "approved",
        capitalWithdrawalStatus: "eligible",
        withdrawalQueueStatus: "none",
        capitalUnlockAt: { $lte: now },
    }).sort({ capitalUnlockAt: 1, createdAt: 1 });
    const totalEligible = eligibleDeposits.reduce((acc, d) => acc + (d.amount || 0), 0);
    if (totalEligible <= 0) {
        return res.status(400).json({ message: "No unlocked capital available for withdrawal yet" });
    }
    if (amount > totalEligible) {
        return res.status(400).json({ message: `Requested amount exceeds eligible capital ($${totalEligible.toFixed(2)})` });
    }
    const selected = [];
    let running = 0;
    for (const dep of eligibleDeposits) {
        if (running >= amount)
            break;
        selected.push(dep);
        running += dep.amount || 0;
    }
    if (running < amount)
        return res.status(400).json({ message: "Eligible capital is not enough for this request" });
    if (Math.abs(running - amount) > 0.000001) {
        return res.status(400).json({ message: "Withdrawal amount must match complete unlocked deposit capital blocks" });
    }
    const queuedAt = new Date();
    const actionBase = { at: queuedAt, by: userId, ip: requestIp(req) };
    const w = await Withdrawal_1.Withdrawal.create({
        userId,
        amount,
        toAddress: value.toAddress,
        status: "pending",
        kind: "capital",
        queueStatus: "pending",
        queuedAt,
        policyVersion: policy.policyVersion,
        relatedDepositIds: selected.map((d) => d._id),
        actions: [
            { action: "requested", ...actionBase },
            { action: "queued", ...actionBase },
        ],
    });
    await Deposit_1.Deposit.updateMany({ _id: { $in: selected.map((d) => d._id) } }, { $set: { withdrawalQueueStatus: "pending" } });
    const queuePosition = await Withdrawal_1.Withdrawal.countDocuments({
        kind: "capital",
        status: "pending",
        queueStatus: "pending",
        queuedAt: { $lt: queuedAt },
    }) + 1;
    res.json({ message: "Submitted", withdrawalId: w.id, queuePosition });
});
router.get("/mine", async (req, res) => {
    const userId = req.userId;
    const now = new Date();
    await Deposit_1.Deposit.updateMany({
        userId,
        status: "approved",
        capitalWithdrawalStatus: "locked",
        capitalUnlockAt: { $lte: now },
    }, { $set: { capitalWithdrawalStatus: "eligible" } });
    const list = await Withdrawal_1.Withdrawal.find({ userId }).sort({ createdAt: -1 }).limit(20);
    const mapped = await Promise.all(list.map(async (w) => {
        let queuePosition = undefined;
        let estimatedMinutes = undefined;
        if (w.kind === "capital" && w.status === "pending" && w.queueStatus === "pending" && w.queuedAt) {
            queuePosition = await Withdrawal_1.Withdrawal.countDocuments({
                kind: "capital",
                status: "pending",
                queueStatus: "pending",
                queuedAt: { $lt: w.queuedAt },
            }) + 1;
            estimatedMinutes = queuePosition * 10;
        }
        return {
            ...w.toObject(),
            queuePosition,
            estimatedMinutes,
        };
    }));
    res.json(mapped);
});
exports.default = router;
