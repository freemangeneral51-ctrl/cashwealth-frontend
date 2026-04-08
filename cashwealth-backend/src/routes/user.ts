import { Router } from "express";
import { User } from "../models/User";
import { Transaction } from "../models/Transaction";
import { requireAuth } from "../middleware/auth";
import { Notification } from "../models/Notification";
import Joi from "joi";

import { env } from "../config/env";
import { LoginActivity } from "../models/LoginActivity";
import { Deposit } from "../models/Deposit";
import { Withdrawal } from "../models/Withdrawal";
import { PlatformPolicy } from "../models/PlatformPolicy";

const router = Router();

router.get("/referral/code", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  const pid = (user.publicId || "").toUpperCase().replace(/-/g, "");
  res.json({ referralCode: pid });
});

router.post("/id/reset", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  // Generate numeric code: CW + 6 digits, ensure uniqueness
  let pid = "";
  for (let i = 0; i < 30; i++) {
    const candidate = "CW" + Math.floor(100000 + Math.random() * 900000).toString();
    const taken = await User.findOne({ $or: [{ publicId: candidate }, { referralCode: candidate }], _id: { $ne: user._id } });
    if (!taken) {
      pid = candidate;
      break;
    }
  }
  if (!pid) pid = "CW" + Math.floor(100000 + Math.random() * 900000).toString();
  // Enforce referralCode === publicId (no hyphens)
  await User.updateOne({ _id: user._id }, { $set: { publicId: pid, referralCode: pid } });
  res.json({ publicId: pid, referralCode: pid });
});

router.post("/referral/reset", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  // Enforce referralCode === publicId (no hyphens)
  const pid = (user.publicId || "").toUpperCase().replace(/-/g, "");
  await User.updateOne({ _id: user._id }, { $set: { referralCode: pid } });
  res.json({ referralCode: pid });
});

router.get("/team", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const referrals = await User.find(
    { referredBy: userId },
    { _id: 1, publicId: 1, referralCode: 1 }
  ).sort({ createdAt: -1 });

  if (referrals.length === 0) {
    return res.json({ totalRegistered: 0, totalDeposited: 0, members: [] });
  }

  const referredIds = referrals.map((u: any) => u._id);
  const depositUserIds = await Deposit.distinct("userId", {
    userId: { $in: referredIds },
    status: "approved",
  });
  const depositSet = new Set(
    (depositUserIds as any[]).map((id: any) => id.toString())
  );

  const members = referrals.map((u: any) => {
    const baseId = (u.publicId || u.referralCode || "") as string;
    const normalized = baseId.toUpperCase().replace(/-/g, "");
    return {
      publicId: normalized,
      hasDeposited: depositSet.has(u._id.toString()),
    };
  });

  const totalDeposited = members.filter((m) => m.hasDeposited).length;

  res.json({
    totalRegistered: referrals.length,
    totalDeposited,
    members,
  });
});

router.get("/metrics", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const [user, policy] = await Promise.all([
    User.findById(userId),
    PlatformPolicy.findOne().sort({ createdAt: -1 }),
  ]);
  if (!user) return res.status(404).json({ message: "User not found" });
  const pid = (user.publicId || "").toUpperCase().replace(/-/g, "");
  const ref = pid;
  const now = new Date();

  const txs = await Transaction.find({ userId });
  await Deposit.updateMany(
    {
      userId,
      status: "approved",
      capitalWithdrawalStatus: "locked",
      capitalUnlockAt: { $lte: now },
    },
    { $set: { capitalWithdrawalStatus: "eligible" } }
  );
  const deposits = await Deposit.find({ userId, status: "approved" }).sort({ createdAt: 1 });
  const activeQueue = await Withdrawal.findOne({
    userId,
    kind: "capital",
    status: "pending",
    queueStatus: { $in: ["pending", "processing"] },
  }).sort({ queuedAt: 1 });
  let queuePosition = 0;
  if (activeQueue?.queuedAt && activeQueue.queueStatus === "pending") {
    queuePosition = await Withdrawal.countDocuments({
      kind: "capital",
      status: "pending",
      queueStatus: "pending",
      queuedAt: { $lt: activeQueue.queuedAt },
    }) + 1;
  }
  const totalDeposited = txs.filter(t => t.type === "deposit").reduce((acc, t) => acc + t.amount, 0);
  const totalWithdrawals = txs.filter(t => t.type === "withdrawal").reduce((acc, t) => acc + t.amount, 0);
  const earningsTxs = txs
    .filter(t => t.type === "interest" || (t.type === "adjustment" && Number(t.amount || 0) > 0))
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const totalEarningsRecorded = earningsTxs.reduce((acc, t) => acc + Number(t.amount || 0), 0);
  const totalEarningsWithdrawn = txs
    .filter((t: any) => t.type === "withdrawal" && t.meta?.kind === "earnings")
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);
  const pendingEarningsWithdrawals = await Withdrawal.find({
    userId,
    kind: "standard",
    status: "pending",
  });
  const pendingEarningsAmount = pendingEarningsWithdrawals.reduce((acc, w: any) => acc + Number(w.amount || 0), 0);
  const withdrawableEarnings = Math.max(0, totalEarningsRecorded - totalEarningsWithdrawn - pendingEarningsAmount);
  const earningsWithdrawalThreshold = 5;
  const thresholdRemaining = Math.max(0, earningsWithdrawalThreshold - totalEarningsRecorded);
  function dailyRateFor(amount: number): number {
    if (amount >= 10000 && amount <= 100000) return 0.10;
    if (amount >= 1000 && amount < 10000) return 0.06;
    if (amount >= 100 && amount < 1000) return 0.05;
    if (amount >= 20 && amount < 100) return 0.04;
    return 0;
  }
  const dailyRate = dailyRateFor(user.balance || 0);
  const dailyEarnings = Math.round(((user.balance || 0) * dailyRate + Number.EPSILON) * 100) / 100;
  const withdrawnCapital = deposits
    .filter((d: any) => d.capitalWithdrawalStatus === "withdrawn")
    .reduce((acc, d) => acc + (d.amount || 0), 0);
  const lockedDeposits = deposits.filter((d: any) => d.capitalWithdrawalStatus === "locked");
  const eligibleDeposits = deposits.filter((d: any) => d.capitalWithdrawalStatus === "eligible" && d.withdrawalQueueStatus === "none");
  const lockedAmount = lockedDeposits.reduce((acc, d) => acc + (d.amount || 0), 0);
  const eligibleAmount = eligibleDeposits.reduce((acc, d) => acc + (d.amount || 0), 0);
  const totalInitialCapital = lockedAmount + eligibleAmount;
  const nextUnlock = lockedDeposits
    .map((d: any) => new Date(d.capitalUnlockAt || d.createdAt))
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
      USDT_TRC20: env.PLATFORM_USDT_ADDRESS,
      TRON_TRX: env.PLATFORM_TRX_ADDRESS
    },
    dailyRate,
    dailyEarnings,
    earnings: {
      totalRecorded: Math.round((totalEarningsRecorded + Number.EPSILON) * 100) / 100,
      totalWithdrawn: Math.round((totalEarningsWithdrawn + Number.EPSILON) * 100) / 100,
      withdrawableAmount: Math.round((withdrawableEarnings + Number.EPSILON) * 100) / 100,
      withdrawalThreshold: earningsWithdrawalThreshold,
      thresholdRemaining: Math.round((thresholdRemaining + Number.EPSILON) * 100) / 100,
      eligibleToWithdraw: withdrawableEarnings >= earningsWithdrawalThreshold,
      history: earningsTxs.slice(0, 20).map((t: any) => ({
        id: t._id,
        type: t.type,
        amount: t.amount,
        createdAt: t.createdAt,
      })),
    },
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
    capitalDeposits: deposits.map((d: any) => ({
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

router.get("/activity", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const txs = await Transaction.find({ userId }).sort({ createdAt: -1 }).limit(50);
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  const todays = txs.filter((t: any) => {
    const d = new Date(t.createdAt);
    return d >= start && d <= end;
  });
  const deposits = todays.filter((t: any) => t.type === "deposit").reduce((a: number, t: any) => a + t.amount, 0);
  const withdrawals = todays.filter((t: any) => t.type === "withdrawal").reduce((a: number, t: any) => a + t.amount, 0);
  function dailyRateFor(amount: number): number {
    if (amount >= 10000 && amount <= 100000) return 0.10;
    if (amount >= 1000 && amount < 10000) return 0.06;
    if (amount >= 100 && amount < 1000) return 0.05;
    if (amount >= 20 && amount < 100) return 0.04;
    return 0;
  }
  const user = await User.findById(userId);
  const rate = dailyRateFor(user?.balance || 0);
  const dailyEarnings = Math.round(((user?.balance || 0) * rate + Number.EPSILON) * 100) / 100;
  res.json({ dailyEarnings, transactions: txs, deposits, withdrawals, rate });
});

router.get("/notifications", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const list = await Notification.find({ userId }).sort({ read: 1, createdAt: -1 }).limit(50);
  res.json(list);
});

router.post("/notifications/read-all", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  await Notification.updateMany({ userId, read: false }, { $set: { read: true } });
  res.json({ message: "Updated" });
});

router.get("/notifications/unread-count", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const count = await Notification.countDocuments({ userId, read: false });
  res.json({ count });
});

router.post("/notifications/:id/mark-read", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const id = req.params.id;
  await Notification.updateOne({ _id: id, userId }, { $set: { read: true } });
  res.json({ message: "Updated" });
});

router.get("/login-history", requireAuth, async (req: any, res) => {
  const userId = req.userId;
  const role = req.role;
  const qUser = String(req.query.userId || "");
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || "20"), 10) || 20));
  const filter: any = {};
  if (role === "admin" && qUser) filter.userId = qUser;
  else filter.userId = userId;
  const total = await LoginActivity.countDocuments(filter);
  const list = await LoginActivity.find(filter).sort({ loginTime: -1 }).skip((page - 1) * limit).limit(limit);
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

router.get("/session", requireAuth, async (req: any, res) => {
  res.json({ sessionId: req.sessionId });
});

router.post("/login-logs/record", requireAuth, async (req: any, res) => {
  try {
    const userId = req.userId;
    const sessionId = req.sessionId;
    const event = String((req.body || {}).event || "").toLowerCase();
    if (!sessionId) return res.status(400).json({ message: "Missing session" });
    if (event === "login") {
      const existing = await LoginActivity.findOne({ userId, sessionId });
      if (!existing) {
        const ip = (req as any).ip || req.headers["x-forwarded-for"] || "";
        const ua = String(req.headers["user-agent"] || "");
        await LoginActivity.create({
          userId,
          loginTime: new Date(),
          ipAddress: Array.isArray(ip) ? ip[0] : String(ip),
          userAgent: ua,
          sessionId,
          status: "active",
        } as any);
      } else if (existing.status !== "active") {
        await LoginActivity.updateOne({ _id: existing._id }, { $set: { status: "active" } });
      }
      return res.json({ message: "Recorded" });
    }
    if (event === "logout") {
      await LoginActivity.updateOne(
        { userId, sessionId, status: "active" },
        { $set: { status: "logged_out", logoutTime: new Date() } }
      );
      return res.json({ message: "Recorded" });
    }
    res.status(400).json({ message: "Invalid event" });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
