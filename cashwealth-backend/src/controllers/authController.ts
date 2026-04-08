import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt, { Secret, SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { env } from "../config/env";
import { User } from "../models/User";
import { LoginActivity } from "../models/LoginActivity";

function deviceFromUA(ua: string): string {
  const s = (ua || "").toLowerCase();
  if (!s) return "";
  if (s.includes("iphone")) return "iPhone";
  if (s.includes("ipad")) return "iPad";
  if (s.includes("android")) return "Android";
  if (s.includes("windows")) return "Windows";
  if (s.includes("mac os") || s.includes("macintosh")) return "Mac";
  if (s.includes("linux")) return "Linux";
  return ua;
}

export async function handleLogin(req: Request, res: Response, email: string, password: string) {
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ message: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });
  if (user.suspended) return res.status(403).json({ message: "Account suspended" });

  const sessionId = crypto.randomUUID();
  const ip = (req as any).ip || req.headers["x-forwarded-for"] || "";
  const ua = String(req.headers["user-agent"] || "");
  const device = deviceFromUA(ua);
  const now = new Date();

  if (env.SINGLE_SESSION) {
    await LoginActivity.updateMany({ userId: user._id, status: "active" }, { $set: { status: "expired" } });
  }
  await LoginActivity.create({
    userId: user._id,
    loginTime: now,
    ipAddress: Array.isArray(ip) ? ip[0] : String(ip),
    userAgent: ua,
    deviceInfo: device,
    sessionId,
    status: "active",
  });

  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
  const token = jwt.sign({ sub: user.id, role: user.role, sid: sessionId }, env.JWT_SECRET as Secret, options);

  const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production" || env.FRONTEND_ORIGIN.startsWith("https");
  const allowCross = !!env.DEV_CROSS_SITE;
  res
    .cookie("token", token, { httpOnly: true, sameSite: allowCross ? "none" : "lax", secure: allowCross ? true : isProd })
    .json({
      message: "Logged in",
      role: user.role,
      userId: user.id,
      csrfToken: (req as any).csrfToken?.(),
      token: isProd ? undefined : token,
      sessionId,
    });
}

export async function handleLogout(req: Request, res: Response) {
  const header = req.headers.authorization;
  const token = (req as any).cookies?.token || (header?.startsWith("Bearer ") ? header.slice(7) : undefined);
  try {
    if (token) {
      const payload = jwt.verify(token, env.JWT_SECRET as Secret) as any;
      const sid = payload?.sid;
      const sub = payload?.sub;
      if (sid && sub) {
        await LoginActivity.updateOne({ userId: sub, sessionId: sid, status: "active" }, { $set: { status: "logged_out", logoutTime: new Date() } });
      }
    }
  } catch {}
  const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production" || env.FRONTEND_ORIGIN.startsWith("https");
  const allowCross = !!env.DEV_CROSS_SITE;
  res.clearCookie("token", { httpOnly: true, sameSite: allowCross ? "none" : "lax", secure: allowCross ? true : isProd });
  res.json({ message: "Logged out" });
}

export async function handleLogoutSession(req: Request & { userId?: string; role?: string }, res: Response) {
  const userId = req.userId;
  const role = req.role;
  const body: any = req.body || {};
  const sid: string = String(body.sessionId || "");
  if (!sid) return res.status(400).json({ message: "Missing sessionId" });
  const filter: any = { sessionId: sid, status: "active" };
  if (role !== "admin") filter.userId = userId;
  const act = await LoginActivity.findOne(filter);
  if (!act) return res.status(404).json({ message: "Session not found" });
  await LoginActivity.updateOne({ _id: act._id }, { $set: { status: "logged_out", logoutTime: new Date() } });
  res.json({ message: "Session logged out" });
}
