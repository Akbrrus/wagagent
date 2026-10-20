import pino from "pino";

/**
 * Logger tunggal untuk seluruh aplikasi (dan dipakai juga oleh Baileys).
 * Level bisa diatur lewat env LOG_LEVEL (default: info).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
});
