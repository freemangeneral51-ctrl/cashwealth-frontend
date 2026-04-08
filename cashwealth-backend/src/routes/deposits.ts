import { Router } from "express";
import { Deposit } from "../models/Deposit";
import { PlatformPolicy } from "../models/PlatformPolicy";
import Joi from "joi";

const router = Router();

const submitSchema = Joi.object({
  asset: Joi.string().valid("USDT_TRC20", "TRON_TRX").required(),
  txHash: Joi.string().required(),
  amount: Joi.number().positive().required(),
  agreementAccepted: Joi.boolean().valid(true).required(),
  policyVersion: Joi.string().trim().required(),
}).unknown(true);

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

router.post("/submit", async (req, res) => {
  const incoming: any = { ...(req.body || {}) };
  // Aggressively strip txAt variations before validation to prevent any library mismatch errors
  for (const k of Object.keys(incoming)) {
    if (k.toLowerCase() === "txat" || k.toLowerCase() === "tx_at") {
      // keep a copy for later parsing
      incoming.__txAtRaw = incoming[k];
      delete incoming[k];
    }
  }
  const { error, value } = submitSchema.validate(incoming, { allowUnknown: true });
  if (error) return res.status(400).json({ message: error.message });
  if (typeof value.amount !== "number" || value.amount < 20) {
    return res.status(400).json({ message: "Minimum deposit is $20" });
  }
  const policy = await currentPolicy();
  if (value.policyVersion !== policy.policyVersion) {
    return res.status(400).json({ message: "Policy version mismatch. Please refresh and accept latest policy." });
  }
  const userId = (req as any).userId;
  const now = new Date();
  let txAt: Date | undefined = undefined;
  const body: any = req.body || {};
  const rawTxAt =
    body.txAt ?? body.tx_at ?? body.TXAT ?? body.TxAt ?? body.txAT ?? incoming.__txAtRaw;
  if (rawTxAt !== undefined) {
    try {
      txAt = new Date(rawTxAt);
      if (isNaN(txAt.getTime())) txAt = undefined;
    } catch {
      txAt = undefined;
    }
  }
  const lockDurationDays = Number(policy.lockDurationDays || 180);
  const capitalUnlockAt = new Date(now.getTime() + lockDurationDays * 24 * 60 * 60 * 1000);
  const dep = await Deposit.create({
    userId,
    asset: value.asset,
    txHash: value.txHash,
    amount: value.amount,
    status: "pending",
    txAt,
    capitalUnlockAt,
    capitalWithdrawalStatus: "locked",
    withdrawalQueueStatus: "none",
    lockDurationDays,
    policyVersionAccepted: policy.policyVersion,
    agreementAcceptedAt: now,
    agreementAcceptedIp: requestIp(req),
  });
  res.json({ message: "Submitted", depositId: dep.id });
});

router.get("/policy", async (_req, res) => {
  const policy = await currentPolicy();
  res.json({
    policyVersion: policy.policyVersion,
    policyText: policy.policyText,
    lockDurationDays: policy.lockDurationDays,
  });
});

router.get("/mine", async (req: any, res) => {
  const userId = req.userId;
  const list = await Deposit.find({ userId }).sort({ createdAt: -1 }).limit(20);
  res.json(list);
});

export default router;
