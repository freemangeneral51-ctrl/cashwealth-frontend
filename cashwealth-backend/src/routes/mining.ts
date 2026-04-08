import { Router } from "express";
import { MiningSession } from "../models/MiningSession";
import { User } from "../models/User";
import { PlatformPolicy } from "../models/PlatformPolicy";

const router = Router();

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

function defaultRateFor(amount: number): number {
  if (amount >= 10000 && amount <= 100000) return 0.10;
  if (amount >= 1000 && amount < 10000) return 0.06;
  if (amount >= 100 && amount < 1000) return 0.05;
  if (amount >= 20 && amount < 100) return 0.04;
  return 0.03;
}

router.get("/status", async (req: any, res) => {
  try {
    const userId = req.userId;
    const active = await MiningSession.findOne({ userId, status: "active" }).sort({ activatedAt: -1 });
    if (!active) {
      const last = await MiningSession.findOne({ userId }).sort({ activatedAt: -1 });
      return res.json({
        status: "inactive",
        lastActivatedAt: last?.activatedAt,
        lastExpiresAt: last?.expiresAt,
        lastEarnedAmount: last?.earnedAmount || 0,
        lastRate: last?.rate || 0,
      });
    }
    const now = Date.now();
    const remainingMs = Math.max(0, (active.expiresAt?.getTime() || 0) - now);
    const remainingSeconds = Math.floor(remainingMs / 1000);
    res.json({
      status: "active",
      activatedAt: active.activatedAt,
      expiresAt: active.expiresAt,
      rate: active.rate,
      earnedAmount: active.earnedAmount,
      remainingSeconds,
    });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/activate", async (req: any, res) => {
  try {
    const userId = req.userId;
    const policy = await currentPolicy();
    const existing = await MiningSession.findOne({ userId, status: "active" });
    if (existing) return res.status(400).json({ message: "Mining already active" });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    const disclaimerAccepted = !!req.body?.disclaimerAccepted;
    if (!user.miningDisclaimerAcceptedAt && !disclaimerAccepted) {
      return res.status(400).json({
        message: "You must accept the mining capital lock disclaimer before first activation",
        disclaimerText: policy.miningDisclaimerText,
      });
    }
    if (!user.miningDisclaimerAcceptedAt && disclaimerAccepted) {
      user.miningDisclaimerAcceptedAt = new Date();
      await user.save();
    }
    const balance = user.balance || 0;
    if (balance <= 0) return res.status(400).json({ message: "Insufficient balance to start mining" });
    const rate = defaultRateFor(balance);
    const activatedAt = new Date();
    const expiresAt = new Date(activatedAt.getTime() + 24 * 60 * 60 * 1000);
    const earn = Math.round(((balance * rate) + Number.EPSILON) * 100) / 100;
    const sess = await MiningSession.create({
      userId,
      activatedAt,
      expiresAt,
      status: "active",
      rate,
      earnedAmount: earn,
      balanceAtActivation: balance,
    });
    res.json({
      message: "Mining activated",
      activatedAt: sess.activatedAt,
      expiresAt: sess.expiresAt,
      rate: sess.rate,
      earnedAmount: sess.earnedAmount,
    });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/history", async (req: any, res) => {
  const userId = req.userId;
  const list = await MiningSession.find({ userId }).sort({ activatedAt: -1 }).limit(20);
  res.json(list);
});

router.get("/disclaimer", async (req: any, res) => {
  const userId = req.userId;
  const [policy, user] = await Promise.all([currentPolicy(), User.findById(userId)]);
  res.json({
    text: policy.miningDisclaimerText,
    requiresAcceptance: !user?.miningDisclaimerAcceptedAt,
  });
});

export default router;
