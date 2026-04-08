import { Request, Response, NextFunction } from "express";
import jwt, { Secret, SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import { LoginActivity } from "../models/LoginActivity";

export function requireAuth(req: Request & { userId?: string; role?: string; sessionId?: string }, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = (req as any).cookies?.token || (header?.startsWith("Bearer ") ? header.slice(7) : undefined);
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const payload = jwt.verify(token, env.JWT_SECRET as Secret) as any;
    req.userId = payload.sub;
    req.role = payload.role;
    req.sessionId = payload.sid;
    if (!req.sessionId) return res.status(401).json({ message: "Unauthorized" });
    LoginActivity.findOne({ userId: req.userId, sessionId: req.sessionId }).then((act) => {
      if (!act || act.status !== "active") return res.status(401).json({ message: "Unauthorized" });
      try {
        const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
        const refreshed = jwt.sign({ sub: payload.sub, role: payload.role, sid: req.sessionId }, env.JWT_SECRET as Secret, options);
        const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production" || env.FRONTEND_ORIGIN.startsWith("https");
        const allowCross = !!env.DEV_CROSS_SITE;
        res.cookie("token", refreshed, { httpOnly: true, sameSite: allowCross ? "none" : "lax", secure: allowCross ? true : isProd });
      } catch {}
      next();
    }).catch(() => res.status(401).json({ message: "Unauthorized" }));
  } catch (e: any) {
    try {
      const decoded: any = jwt.decode(token);
      const sid = decoded?.sid;
      const sub = decoded?.sub;
      if (sid && sub) {
        LoginActivity.updateOne({ userId: sub, sessionId: sid, status: "active" }, { $set: { status: "expired" } }).catch(() => {});
      }
    } catch {}
    return res.status(401).json({ message: "Unauthorized" });
  }
}
