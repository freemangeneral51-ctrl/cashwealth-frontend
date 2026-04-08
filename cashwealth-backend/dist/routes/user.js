"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const User_1 = require("../models/User");
const Transaction_1 = require("../models/Transaction");
const auth_1 = require("../middleware/auth");
const Notification_1 = require("../models/Notification");
const env_1 = require("../config/env");
const LoginActivity_1 = require("../models/LoginActivity");
const Deposit_1 = require("../models/Deposit");
const Withdrawal_1 = require("../models/Withdrawal");
const PlatformPolicy_1 = require("../models/PlatformPolicy");
const router = (0, express_1.Router)();
router.get("/referral/code", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const user = await User_1.User.findById(userId);
    if (!user)
        return res.status(404).json({ message: "User not found" });
    const pid = (user.publicId || "").toUpperCase().replace(/-/g, "");
    res.json({ referralCode: pid });
});
router.post("/id/reset", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const user = await User_1.User.findById(userId);
    if (!user)
        return res.status(404).json({ message: "User not found" });
    // Generate numeric code: CW + 6 digits, ensure uniqueness
    let pid = "";
    for (let i = 0; i < 30; i++) {
        const candidate = "CW" + Math.floor(100000 + Math.random() * 900000).toString();
        const taken = await User_1.User.findOne({ $or: [{ publicId: candidate }, { referralCode: candidate }], _id: { $ne: user._id } });
        if (!taken) {
            pid = candidate;
            break;
        }
    }
    if (!pid)
        pid = "CW" + Math.floor(100000 + Math.random() * 900000).toString();
    // Enforce referralCode === publicId (no hyphens)
    await User_1.User.updateOne({ _id: user._id }, { $set: { publicId: pid, referralCode: pid } });
    res.json({ publicId: pid, referralCode: pid });
});
router.post("/referral/reset", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const user = await User_1.User.findById(userId);
    if (!user)
        return res.status(404).json({ message: "User not found" });
    // Enforce referralCode === publicId (no hyphens)
    const pid = (user.publicId || "").toUpperCase().replace(/-/g, "");
    await User_1.User.updateOne({ _id: user._id }, { $set: { referralCode: pid } });
    res.json({ referralCode: pid });
});
router.get("/metrics", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const [user, policy] = await Promise.all([
        User_1.User.findById(userId),
        PlatformPolicy_1.PlatformPolicy.findOne().sort({ createdAt: -1 }),
    ]);
    if (!user)
        return res.status(404).json({ message: "User not found" });
    const pid = (user.publicId || "").toUpperCase().replace(/-/g, "");
    const ref = pid;
    const now = new Date();
    const txs = await Transaction_1.Transaction.find({ userId });
    await Deposit_1.Deposit.updateMany({
        userId,
        status: "approved",
        capitalWithdrawalStatus: "locked",
        capitalUnlockAt: { $lte: now },
    }, { $set: { capitalWithdrawalStatus: "eligible" } });
    const deposits = await Deposit_1.Deposit.find({ userId, status: "approved" }).sort({ createdAt: 1 });
    const activeQueue = await Withdrawal_1.Withdrawal.findOne({
        userId,
        kind: "capital",
        status: "pending",
        queueStatus: { $in: ["pending", "processing"] },
    }).sort({ queuedAt: 1 });
    let queuePosition = 0;
    if (activeQueue?.queuedAt && activeQueue.queueStatus === "pending") {
        queuePosition = await Withdrawal_1.Withdrawal.countDocuments({
            kind: "capital",
            status: "pending",
            queueStatus: "pending",
            queuedAt: { $lt: activeQueue.queuedAt },
        }) + 1;
    }
    const totalDeposited = txs.filter(t => t.type === "deposit").reduce((acc, t) => acc + t.amount, 0);
    const totalWithdrawals = txs.filter(t => t.type === "withdrawal").reduce((acc, t) => acc + t.amount, 0);
    function dailyRateFor(amount) {
        if (amount >= 10000 && amount <= 100000)
            return 0.10;
        if (amount >= 1000 && amount < 10000)
            return 0.06;
        if (amount >= 100 && amount < 1000)
            return 0.05;
        if (amount >= 20 && amount < 100)
            return 0.04;
        return 0;
    }
    const dailyRate = dailyRateFor(user.balance || 0);
    const dailyEarnings = Math.round(((user.balance || 0) * dailyRate + Number.EPSILON) * 100) / 100;
    const totalInitialCapital = deposits.reduce((acc, d) => acc + (d.amount || 0), 0);
    const withdrawnCapital = deposits
        .filter((d) => d.capitalWithdrawalStatus === "withdrawn")
        .reduce((acc, d) => acc + (d.amount || 0), 0);
    const lockedDeposits = deposits.filter((d) => d.capitalWithdrawalStatus === "locked");
    const eligibleDeposits = deposits.filter((d) => d.capitalWithdrawalStatus === "eligible" && d.withdrawalQueueStatus === "none");
    const lockedAmount = lockedDeposits.reduce((acc, d) => acc + (d.amount || 0), 0);
    const eligibleAmount = eligibleDeposits.reduce((acc, d) => acc + (d.amount || 0), 0);
    const nextUnlock = lockedDeposits
        .map((d) => new Date(d.capitalUnlockAt || d.createdAt))
        .sort((a, b) => a.getTime() - b.getTime())[0];
    const msToUnlock = nextUnlock ? Math.max(0, nextUnlock.getTime() - now.getTime()) : 0;
    const daysRemaining = nextUnlock ? Math.ceil(msToUnlock / (24 * 60 * 60 * 1000)) : 0;
    res.json({
        userName: user.name,
        email: user.email,
        publicId: pid,
        referralCode: ref,
        balance: user.balance,
        totalDeposited,
        totalWithdrawals,
        transactions: txs.slice(-10).reverse(), // Last 10 txs
        platformWallets: {
            USDT_TRC20: env_1.env.PLATFORM_USDT_ADDRESS,
            TRON_TRX: env_1.env.PLATFORM_TRX_ADDRESS
        },
        dailyRate,
        dailyEarnings,
        capital: {
            policyVersion: policy?.policyVersion || "v1.0.0",
            lockDurationDays: Number(policy?.lockDurationDays || 180),
            totalInitialCapital,
            withdrawnCapital,
            lockedAmount,
            eligibleAmount,
            nextUnlockDate: nextUnlock || null,
            daysRemaining,
            withdrawalButtonEnabled: eligibleAmount > 0 && !activeQueue,
            withdrawalStatus: activeQueue
                ? activeQueue.queueStatus === "processing"
                    ? "Processing"
                    : "Pending"
                : eligibleAmount > 0
                    ? "Eligible"
                    : lockedAmount > 0
                        ? "Locked"
                        : "Completed",
            queue: activeQueue
                ? {
                    status: activeQueue.queueStatus,
                    position: activeQueue.queueStatus === "pending" ? queuePosition : 0,
                    estimatedMinutes: activeQueue.queueStatus === "pending" && queuePosition > 0 ? queuePosition * 10 : 0,
                    amount: activeQueue.amount,
                }
                : null,
        },
        capitalDeposits: deposits.map((d) => ({
            id: d._id,
            amount: d.amount,
            depositDate: d.createdAt,
            unlockDate: d.capitalUnlockAt,
            capitalWithdrawalStatus: d.capitalWithdrawalStatus,
            withdrawalQueueStatus: d.withdrawalQueueStatus,
            policyVersionAccepted: d.policyVersionAccepted,
            agreementAcceptedAt: d.agreementAcceptedAt,
        })),
    });
});
router.get("/activity", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const txs = await Transaction_1.Transaction.find({ userId }).sort({ createdAt: -1 }).limit(50);
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
    const todays = txs.filter((t) => {
        const d = new Date(t.createdAt);
        return d >= start && d <= end;
    });
    const deposits = todays.filter((t) => t.type === "deposit").reduce((a, t) => a + t.amount, 0);
    const withdrawals = todays.filter((t) => t.type === "withdrawal").reduce((a, t) => a + t.amount, 0);
    function dailyRateFor(amount) {
        if (amount >= 10000 && amount <= 100000)
            return 0.10;
        if (amount >= 1000 && amount < 10000)
            return 0.06;
        if (amount >= 100 && amount < 1000)
            return 0.05;
        if (amount >= 20 && amount < 100)
            return 0.04;
        return 0;
    }
    const user = await User_1.User.findById(userId);
    const rate = dailyRateFor(user?.balance || 0);
    const dailyEarnings = Math.round(((user?.balance || 0) * rate + Number.EPSILON) * 100) / 100;
    res.json({ dailyEarnings, transactions: txs, deposits, withdrawals, rate });
});
router.get("/notifications", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const list = await Notification_1.Notification.find({ userId }).sort({ read: 1, createdAt: -1 }).limit(50);
    res.json(list);
});
router.post("/notifications/read-all", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    await Notification_1.Notification.updateMany({ userId, read: false }, { $set: { read: true } });
    res.json({ message: "Updated" });
});
router.get("/notifications/unread-count", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const count = await Notification_1.Notification.countDocuments({ userId, read: false });
    res.json({ count });
});
router.post("/notifications/:id/mark-read", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const id = req.params.id;
    await Notification_1.Notification.updateOne({ _id: id, userId }, { $set: { read: true } });
    res.json({ message: "Updated" });
});
router.get("/login-history", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const role = req.role;
    const qUser = String(req.query.userId || "");
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || "20"), 10) || 20));
    const filter = {};
    if (role === "admin" && qUser)
        filter.userId = qUser;
    else
        filter.userId = userId;
    const total = await LoginActivity_1.LoginActivity.countDocuments(filter);
    const list = await LoginActivity_1.LoginActivity.find(filter).sort({ loginTime: -1 }).skip((page - 1) * limit).limit(limit);
    res.json({
        page,
        limit,
        total,
        items: list.map((i) => ({
            loginTime: i.loginTime,
            logoutTime: i.logoutTime,
            ipAddress: i.ipAddress,
            deviceInfo: i.deviceInfo,
            status: i.status,
            sessionId: i.sessionId,
        })),
    });
});
router.get("/session", auth_1.requireAuth, async (req, res) => {
    res.json({ sessionId: req.sessionId });
});
router.post("/login-logs/record", auth_1.requireAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const sessionId = req.sessionId;
        const event = String((req.body || {}).event || "").toLowerCase();
        if (!sessionId)
            return res.status(400).json({ message: "Missing session" });
        if (event === "login") {
            const existing = await LoginActivity_1.LoginActivity.findOne({ userId, sessionId });
            if (!existing) {
                const ip = req.ip || req.headers["x-forwarded-for"] || "";
                const ua = String(req.headers["user-agent"] || "");
                await LoginActivity_1.LoginActivity.create({
                    userId,
                    loginTime: new Date(),
                    ipAddress: Array.isArray(ip) ? ip[0] : String(ip),
                    userAgent: ua,
                    sessionId,
                    status: "active",
                });
            }
            else if (existing.status !== "active") {
                await LoginActivity_1.LoginActivity.updateOne({ _id: existing._id }, { $set: { status: "active" } });
            }
            return res.json({ message: "Recorded" });
        }
        if (event === "logout") {
            await LoginActivity_1.LoginActivity.updateOne({ userId, sessionId, status: "active" }, { $set: { status: "logged_out", logoutTime: new Date() } });
            return res.json({ message: "Recorded" });
        }
        res.status(400).json({ message: "Invalid event" });
    }
    catch {
        res.status(500).json({ message: "Server error" });
    }
});
exports.default = router;
