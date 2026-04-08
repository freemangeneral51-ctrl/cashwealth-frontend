import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import csrf from "csurf";
import { env } from "../config/env";
import express from "express";

export function applySecurity(app: express.Express) {
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  const isDev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
  const allowCrossSite = !!env.DEV_CROSS_SITE;
  const origins = env.FRONTEND_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
  const corsOptions: cors.CorsOptions = {
    origin: isDev
      ? (_origin, cb) => cb(null, true)
      : origins.length > 0
        ? origins
        : env.FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  };
  app.use(cors(corsOptions));
  app.use(cookieParser());
  app.use(express.json());
  app.use(morgan("combined"));

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 2000 : 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  const csrfProtection = csrf({
    cookie: allowCrossSite ? { sameSite: "none", secure: true } : { sameSite: "lax", secure: !isDev },
  });
  app.use((req, res, next) => {
    if (allowCrossSite) return next();
    if (req.path === "/auth/csrf") return csrfProtection(req, res, next);
    const openAuth = /^\/auth\/(register|verify|verify-code|verify-email|resend-code|dev\/last-code|dev\/send-test)$/.test(req.path);
    if (openAuth) return next();
    return csrfProtection(req, res, next);
  });
}
