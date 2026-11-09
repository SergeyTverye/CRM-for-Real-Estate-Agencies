import pino from "pino";
import { getRequestContext } from "../context";


const REDACT_PATHS = [
  "password",
  "*.password",
  "newPassword",
  "*.newPassword",
  "currentPassword",
  "*.currentPassword",
  "temporaryPassword",
  "*.temporaryPassword",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "tokenHash",
  "*.tokenHash",
  "cookie",
  "*.cookie",
  "headers.cookie",
  "headers.authorization",
  "*.headers.cookie",
  "*.headers.authorization",
  "authorization",
  "secret",
  "*.secret",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "crm-app" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  formatters: { level: (label) => ({ level: label }) },
  mixin() {
    const ctx = getRequestContext();
    return ctx ? { correlationId: ctx.correlationId, actorUserId: ctx.actorUserId } : {};
  },
});

export type Logger = typeof logger;
