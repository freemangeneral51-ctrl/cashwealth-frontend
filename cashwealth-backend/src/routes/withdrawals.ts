import { Router } from "express";
import Joi from "joi";
import { Withdrawal } from "../models/Withdrawal";
import { Deposit } from "../models/Deposit";
import { PlatformPolicy } from "../models/PlatformPolicy";
import { Transaction } from "../models/Transaction";

const router = Router();

const submitSchema = Joi.object({
  amount: Joi.number().positive().required(),
  toAddress: Joi.string().allow("", null),
  kind: Joi.string().valid("capital", "earnings").default("capital"),
});

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

router.post("/submit", async (req: any, res) => {
  const { error, value } = submitSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });
  const userId = req.userId;
  const policy = await currentPolicy();
  const amount = Math.abs(Number(value.amount));
  if (isNaN(amount)) return res.status(400).json({ message: "Invalid amount" });
  if (value.kind === "earnings") {
    const hasApprovedDeposit = await Deposit.exists({ userId, status: "approved" });
    if (!hasApprovedDeposit) {
      return res.status(400).json({ message: "Referral earnings are locked until you complete at least one approved deposit" });
    }
    const threshold = 5;
    if (amount < threshold) return res.status(400).json({ message: `Minimum earnings withdrawal is $${threshold}` });
    const activeEarningsRequest = await Withdrawal.findOne({
      userId,
      kind: "standard",
      status: "pending",
    });
    if (activeEarningsRequest) {
      return res.status(400).json({ message: "You already have a pending earnings withdrawal request" });
    }
    const txs = await Transaction.find({ userId });
    const totalEarningsRecorded = txs
      .filter((t: any) => t.type === "interest" || (t.type === "adjustment" && Number(t.amount || 0) > 0))
      .reduce((acc, t) => acc + Number(t.amount || 0), 0);
    const totalEarningsWithdrawn = txs
      .filter((t: any) => t.type === "withdrawal" && t.meta?.kind === "earnings")
      .reduce((acc, t) => acc + Number(t.amount || 0), 0);
    const pendingEarningsAmount = await Withdrawal.aggregate([
      { $match: { userId, kind: "standard", status: "pending" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const availableEarnings = Math.max(0, totalEarningsRecorded - totalEarningsWithdrawn - Number(pendingEarningsAmount[0]?.total || 0));
    if (amount > availableEarnings) {
      return res.status(400).json({ message: `Requested amount exceeds withdrawable earnings ($${availableEarnings.toFixed(2)})` });
    }
    const w = await Withdrawal.create({
      userId,
      amount,
      toAddress: value.toAddress,
      status: "pending",
      kind: "standard",
      queueStatus: "none",
      policyVersion: policy.policyVersion,
      actions: [{ action: "requested", at: new Date(), by: userId, ip: requestIp(req) }],
    });
    return res.json({ message: "Submitted", withdrawalId: w.id });
  }
  if (policy.withdrawalsPaused) return res.status(423).json({ message: "Capital withdrawals are temporarily paused" });
  const activeRequest = await Withdrawal.findOne({
    userId,
    kind: "capital",
    status: "pending",
    queueStatus: { $in: ["pending", "processing"] },
  });
  if (activeRequest) {
    return res.status(400).json({ message: "You already have a pending capital withdrawal request" });
  }
  const now = new Date();
  await Deposit.updateMany(
    {
      userId,
      status: "approved",
      capitalWithdrawalStatus: "locked",
      capitalUnlockAt: { $lte: now },
    },
    { $set: { capitalWithdrawalStatus: "eligible" } }
  );
  const eligibleDeposits = await Deposit.find({
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
  const selected: any[] = [];
  let running = 0;
  for (const dep of eligibleDeposits) {
    if (running >= amount) break;
    selected.push(dep);
    running += dep.amount || 0;
  }
  if (running < amount) return res.status(400).json({ message: "Eligible capital is not enough for this request" });
  if (Math.abs(running - amount) > 0.000001) {
    return res.status(400).json({ message: "Withdrawal amount must match complete unlocked deposit capital blocks" });
  }
  const queuedAt = new Date();
  const actionBase = { at: queuedAt, by: userId, ip: requestIp(req) };
  const w = await Withdrawal.create({
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
  await Deposit.updateMany(
    { _id: { $in: selected.map((d) => d._id) } },
    { $set: { withdrawalQueueStatus: "pending" } }
  );
  const queuePosition = await Withdrawal.countDocuments({
    kind: "capital",
    status: "pending",
    queueStatus: "pending",
    queuedAt: { $lt: queuedAt },
  }) + 1;
  res.json({ message: "Submitted", withdrawalId: w.id, queuePosition });
});

router.get("/mine", async (req: any, res) => {
  const userId = req.userId;
  const now = new Date();
  await Deposit.updateMany(
    {
      userId,
      status: "approved",
      capitalWithdrawalStatus: "locked",
      capitalUnlockAt: { $lte: now },
    },
    { $set: { capitalWithdrawalStatus: "eligible" } }
  );
  const list = await Withdrawal.find({ userId }).sort({ createdAt: -1 }).limit(20);
  const mapped = await Promise.all(list.map(async (w: any) => {
    let queuePosition: number | undefined = undefined;
    let estimatedMinutes: number | undefined = undefined;
    if (w.kind === "capital" && w.status === "pending" && w.queueStatus === "pending" && w.queuedAt) {
      queuePosition = await Withdrawal.countDocuments({
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

export default router;
