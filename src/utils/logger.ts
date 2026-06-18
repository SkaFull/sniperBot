import winston from "winston";
import { config } from "../config";

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : "";
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
  })
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : "";
    return `${timestamp} ${level}: ${message} ${metaStr}`;
  })
);

export class Logger {
  private logger: winston.Logger;

  constructor(module: string) {
    this.logger = winston.createLogger({
      level: config.LOG_LEVEL,
      defaultMeta: { module },
      transports: [
        new winston.transports.Console({
          format: consoleFormat
        }),
        new winston.transports.File({
          filename: "logs/error.log",
          level: "error",
          format: logFormat
        }),
        new winston.transports.File({
          filename: "logs/sniper.log",
          format: logFormat
        })
      ]
    });
  }

  info(message: string, meta?: object): void {
    this.logger.info(message, meta);
  }

  debug(message: string, meta?: object): void {
    this.logger.debug(message, meta);
  }

  warn(message: string, meta?: object): void {
    this.logger.warn(message, meta);
  }

  error(message: string, error?: Error | object | string): void {
    if (error instanceof Error) {
      this.logger.error(message, { error: error.message, stack: error.stack });
    } else if (typeof error === "string") {
      this.logger.error(message, { error });
    } else {
      this.logger.error(message, error);
    }
  }

  trace(message: string, meta?: object): void {
    this.logger.verbose(message, meta);
  }
}

export default Logger;