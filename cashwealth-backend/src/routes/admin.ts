import { Router } from "express";
import { Deposit } from "../models/Deposit";
import { User } from "../models/User";
import { Transaction } from "../models/Transaction";
import { Notification } from "../models/Notification";
import { Withdrawal } from "../models/Withdrawal";
import { PlatformPolicy } from "../models/PlatformPolicy";
import Joi from "joi";
import mongoose from "mongoose";

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (req.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  next();
}

async function currentPolicy() {
  const found = await PlatformPolicy.findOne().sort({ createdAt: -1 });
  if (found) return found;
  return PlatformPolicy.create({
    policyVersion: "v1.0.0",
    policyText: "By investing, you agree that your capital will be locked for 3 months (90 days) and cannot be withdrawn during this period.",
    miningDisclaimerText: "Your invested capital is locked for 3 months (90 days) from the date of deposit. You may only withdraw your initial capital after the lock period expires.",
    lockDurationDays: 90,
    withdrawalsPaused: false,
    availableLiquidity: 0,
  });
}

function requestIp(req: any): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (Array.isArray(forwarded) && forwarded.length > 0) return String(forwarded[0]).trim();
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return String(req.ip || req.socket?.remoteAddress || "");
}

router.get("/deposits", requireAdmin, async (_req, res) => {
  const list = await Deposit.find().sort({ createdAt: -1 }).populate({ path: "userId", select: "email name publicId balance" });
  const mapped = list.map((d: any) => {
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

const reviewSchema = Joi.object({
  status: Joi.string().valid("approved", "rejected").required(),
});

router.post("/deposits/:id/review", requireAdmin, async (req: any, res) => {
  const { error, value } = reviewSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });
  const policy = await currentPolicy();
  const dep = await Deposit.findById(req.params.id);
  if (!dep) return res.status(404).json({ message: "Not found" });
  if (dep.status !== "pending") return res.status(400).json({ message: "Already reviewed" });

  dep.status = value.status as any;
  dep.reviewedBy = req.userId;
  if (value.status === "approved") {
    const lockDays = Number(dep.lockDurationDays || policy.lockDurationDays || 180);
    const createdAtValue = (dep as any).createdAt;
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
    await User.findByIdAndUpdate(dep.userId, { $inc: { balance: dep.amount } });
    await Transaction.create({ userId: dep.userId, type: "deposit", amount: dep.amount, meta: { depositId: dep.id } });
    // Referral bonus: 7% of deposit to referrer if exists
    const depositor = await User.findById(dep.userId);
    if (depositor?.referredBy) {
      const bonus = Number((dep.amount * 0.07).toFixed(2));
      if (bonus > 0) {
        await User.findByIdAndUpdate(depositor.referredBy, { $inc: { balance: bonus } });
        await Transaction.create({
          userId: depositor.referredBy,
          type: "adjustment",
          amount: bonus,
          meta: { referralBonus: true, fromUserId: depositor._id, depositId: dep.id }
        });
      }
    }
    await Notification.create({
      userId: dep.userId,
      type: "deposit_approved",
      message: `Deposit of $${dep.amount.toFixed(2)} approved`,
      meta: { depositId: dep.id },
    });
  } else {
    await Notification.create({
      userId: dep.userId,
      type: "deposit_rejected",
      message: `Deposit of $${dep.amount.toFixed(2)} rejected`,
      meta: { depositId: dep.id },
    });
  }
  res.json({ message: "Updated" });
});

router.get("/withdrawals", requireAdmin, async (_req, res) => {
  const list = await Withdrawal.find().sort({ createdAt: -1 }).populate({ path: "userId", select: "email name publicId balance" });
  const mapped = await Promise.all(list.map(async (w: any) => {
    const obj = w.toObject();
    const u = obj.userId;
    let queuePosition: number | undefined = undefined;
    if (obj.kind === "capital" && obj.status === "pending" && obj.queueStatus === "pending" && obj.queuedAt) {
      queuePosition = await Withdrawal.countDocuments({
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

const wReviewSchema = Joi.object({
  status: Joi.string().valid("approved", "rejected").required(),
});

router.post("/withdrawals/:id/review", requireAdmin, async (req: any, res) => {
  const { error, value } = wReviewSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });
  const w = await Withdrawal.findById(req.params.id);
  if (!w) return res.status(404).json({ message: "Not found" });
  if (w.status !== "pending") return res.status(400).json({ message: "Already reviewed" });
  const policy = await currentPolicy();

  if (w.kind === "capital" && w.queueStatus === "pending" && w.queuedAt) {
    const head = await Withdrawal.findOne({
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
    } as any);
    await w.save();
  }

  w.status = value.status as any;
  w.reviewedBy = req.userId;
  w.processedAt = new Date();
  if (w.kind === "capital") w.queueStatus = "completed";
  w.actions.push({
    action: value.status === "approved" ? "approved" : "rejected",
    at: new Date(),
    by: req.userId,
    ip: requestIp(req),
  } as any);
  await w.save();
  if (value.status === "approved") {
    await User.findByIdAndUpdate(w.userId, { $inc: { balance: -Math.abs(w.amount) } });
    await Transaction.create({
      userId: w.userId,
      type: "withdrawal",
      amount: Math.abs(w.amount),
      meta: { withdrawalId: w.id, kind: w.kind === "standard" ? "earnings" : "capital" },
    });
    if (w.kind === "capital") {
      await PlatformPolicy.updateOne({ _id: policy._id }, { $inc: { availableLiquidity: -Math.abs(w.amount) } });
      if (Array.isArray(w.relatedDepositIds) && w.relatedDepositIds.length > 0) {
        await Deposit.updateMany(
          { _id: { $in: w.relatedDepositIds } },
          {
            $set: {
              capitalWithdrawalStatus: "withdrawn",
              withdrawalQueueStatus: "completed",
              capitalWithdrawnAt: new Date(),
            },
          }
        );
      }
    }
    await Notification.create({
      userId: w.userId,
      type: "withdrawal_approved",
      message: `Withdrawal of $${w.amount.toFixed(2)} approved`,
      meta: { withdrawalId: w.id },
    });
  } else {
    if (w.kind === "capital" && Array.isArray(w.relatedDepositIds) && w.relatedDepositIds.length > 0) {
      await Deposit.updateMany(
        { _id: { $in: w.relatedDepositIds } },
        { $set: { capitalWithdrawalStatus: "eligible", withdrawalQueueStatus: "none" } }
      );
    }
    await Notification.create({
      userId: w.userId,
      type: "withdrawal_rejected",
      message: `Withdrawal of $${w.amount.toFixed(2)} rejected`,
      meta: { withdrawalId: w.id },
    });
  }
  res.json({ message: "Updated" });
});

const policyUpdateSchema = Joi.object({
  policyVersion: Joi.string().trim().min(1),
  policyText: Joi.string().trim().min(1),
  miningDisclaimerText: Joi.string().trim().min(1),
  lockDurationDays: Joi.number().integer().min(1),
  withdrawalsPaused: Joi.boolean(),
  availableLiquidity: Joi.number().min(0),
});

const broadcastSchema = Joi.object({
  message: Joi.string().trim().min(1).max(500).required(),
});

const manualCreditSchema = Joi.object({
  userId: Joi.string().trim().required(),
  amount: Joi.number().positive().required(),
  reason: Joi.string().trim().max(200).allow("", null),
});

const activityQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(200).default(50),
});

router.get("/policy", requireAdmin, async (_req, res) => {
  const policy = await currentPolicy();
  res.json(policy);
});

router.put("/policy", requireAdmin, async (req: any, res) => {
  const { error, value } = policyUpdateSchema.validate(req.body || {});
  if (error) return res.status(400).json({ message: error.message });
  const policy = await currentPolicy();
  if (value.lockDurationDays && !value.policyVersion) {
    return res.status(400).json({ message: "Updating lock duration requires a new policyVersion" });
  }
  await PlatformPolicy.updateOne({ _id: policy._id }, { $set: value });
  const next = await PlatformPolicy.findById(policy._id);
  res.json(next);
});

router.post("/broadcast", requireAdmin, async (req: any, res) => {
  const { error, value } = broadcastSchema.validate(req.body || {});
  if (error) return res.status(400).json({ message: error.message });
  const users = await User.find({}, "_id");
  if (!users.length) return res.json({ message: "No users to notify", sent: 0 });
  const docs = users.map((u) => ({
    userId: u._id,
    type: "admin_broadcast" as any,
    message: String(value.message),
    meta: { scope: "broadcast", fromAdmin: req.userId },
  }));
  await Notification.insertMany(docs);
  res.json({ message: "Broadcast sent", sent: docs.length });
});

router.post("/manual-credit", requireAdmin, async (req: any, res) => {
  const { error, value } = manualCreditSchema.validate(req.body || {});
  if (error) return res.status(400).json({ message: error.message });
  const rawId = String(value.userId || "").trim();
  const amount = Number(value.amount);
  if (!rawId) return res.status(400).json({ message: "userId is required" });
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "amount must be a positive number" });
  }
  const policy = await currentPolicy();
  const lockDays = Number(policy.lockDurationDays || 90);
  const now = new Date();
  const capitalUnlockAt = new Date(now.getTime() + lockDays * 24 * 60 * 60 * 1000);
  let user = null as any;
  if (mongoose.Types.ObjectId.isValid(rawId)) {
    user = await User.findById(rawId);
  }
  if (!user) {
    user = await User.findOne({ publicId: rawId.toUpperCase() });
  }
  if (!user) return res.status(404).json({ message: "User not found" });
  const dep = await Deposit.create({
    userId: user._id,
    asset: "USDT_TRC20",
    txHash: `ADMIN_MANUAL_${Date.now()}`,
    amount,
    status: "approved",
    txAt: now,
    capitalUnlockAt,
    capitalWithdrawalStatus: "locked",
    withdrawalQueueStatus: "none",
    lockDurationDays: lockDays,
    policyVersionAccepted: policy.policyVersion,
    agreementAcceptedAt: now,
    agreementAcceptedIp: requestIp(req),
  });
  await User.updateOne({ _id: user._id }, { $inc: { balance: amount } });
  await Transaction.create({
    userId: user._id,
    type: "deposit",
    amount,
    meta: {
      source: "admin_manual_capital",
      depositId: dep._id,
      reason: value.reason || undefined,
      adminId: req.userId,
    },
  });
  await Notification.create({
    userId: user._id,
    type: "deposit_approved",
    message: `Manual capital credit of $${amount.toFixed(2)} approved`,
    meta: { depositId: dep.id, manual: true },
  });
  const updated = await User.findById(user._id, { balance: 1 });
  res.json({
    message: "Balance credited as locked capital",
    userId: String(user._id),
    publicId: user.publicId,
    amount,
    depositId: dep.id,
    capitalUnlockAt,
    balance: updated ? updated.balance : user.balance + amount,
  });
});

router.get("/users/:id/activity", requireAdmin, async (req: any, res) => {
  const { error, value } = activityQuerySchema.validate(req.query || {});
  if (error) return res.status(400).json({ message: error.message });
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ message: "Missing user id" });
  let user = null as any;
  if (mongoose.Types.ObjectId.isValid(id)) {
    user = await User.findById(id);
  }
  if (!user) {
    user = await User.findOne({ publicId: id.toUpperCase() });
  }
  if (!user) return res.status(404).json({ message: "User not found" });
  const limit = Number(value.limit || 50);
  const txs = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(limit);
  const activity = txs.map((t: any) => ({
    id: String(t._id),
    type: t.type,
    amount: Number(t.amount || 0),
    createdAt: t.createdAt,
    meta: t.meta || {},
  }));
  res.json({
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      publicId: user.publicId,
    },
    activity,
  });
});

router.get("/capital/summary", requireAdmin, async (_req, res) => {
  const now = new Date();
  const [policy, withdrawableAgg, pendingAgg] = await Promise.all([
    currentPolicy(),
    Deposit.aggregate([
      { $match: { status: "approved", capitalWithdrawalStatus: { $in: ["eligible", "locked"] }, capitalUnlockAt: { $lte: now } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Withdrawal.aggregate([
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

router.get("/accounts/summary", requireAdmin, async (_req, res) => {
  const [balanceAgg, topAgg] = await Promise.all([
    User.aggregate([
      { $group: { _id: null, totalBalance: { $sum: "$balance" }, totalUsers: { $sum: 1 } } },
    ]),
    Deposit.aggregate([
      { $match: { status: "approved" } },
      { $group: { _id: "$userId", totalDeposited: { $sum: "$amount" }, depositCount: { $sum: 1 } } },
      { $sort: { totalDeposited: -1 } },
      { $limit: 10 },
    ]),
  ]);
  const totalBalance = Number(balanceAgg[0]?.totalBalance || 0);
  const totalUsers = Number(balanceAgg[0]?.totalUsers || 0);
  const ids = topAgg.map((t: any) => t._id);
  const users = await User.find({ _id: { $in: ids } }, { name: 1, email: 1, publicId: 1 });
  const byId = new Map(users.map((u: any) => [String(u._id), u]));
  const topDepositors = topAgg.map((t: any) => {
    const u: any = byId.get(String(t._id));
    return {
      userId: String(t._id),
      publicId: u?.publicId || "",
      name: u?.name || "",
      email: u?.email || "",
      totalDeposited: Number(t.totalDeposited || 0),
      depositCount: Number(t.depositCount || 0),
    };
  });
  res.json({ totalUsers, totalBalance, topDepositors });
});

router.post("/dev/reset-db", requireAdmin, async (_req, res) => {
  const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production";
  if (isProd) return res.status(403).json({ message: "Forbidden" });
  try {
    await mongoose.connection.dropDatabase();
    res.json({ message: "Database dropped" });
  } catch (e) {
    res.status(500).json({ message: "Failed to drop database" });
  }
});

export default router;
