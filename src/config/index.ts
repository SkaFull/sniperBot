import dotenv from "dotenv";
import path from "path";

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export interface SniperConfigType {
  USE_TPU_DIRECT: boolean;
  SEND_TO_MULTIPLE_LEADERS: boolean;
  PRE_SEND_LEADER_COUNT: number;
  TIMEOUT: number;
  MAX_RETRIES: number;
}

export interface CacheConfigType {
  LEADER_CACHE_TTL: number;
  CLUSTER_NODES_CACHE_TTL: number;
  VOTE_ACCOUNTS_CACHE_TTL: number;
}

export interface TradingConfigType {
  BUY_AMOUNT: number;
  JITO_TIP: number;
  TAKE_PROFIT: number;
  STOP_LOSS: number;
  TRAILING_STOP: number;
}

export interface SecurityConfigType {
  MAX_TOP10_HOLDERS: number;
  MIN_LP_LOCKED: number;
}

export interface AppConfig {
  // RPC 配置
  RPC_URL: string;
  RPC_WS_URL: string;
  BACKUP_RPC_URLS: string[];
  
  // 钱包配置
  PRIVATE_KEY: string;
  
  // 狙击配置
  SNIPER: SniperConfigType;
  
  // 缓存配置
  CACHE: CacheConfigType;
  
  // 交易配置
  TRADING: TradingConfigType;
  
  // 安全配置
  SECURITY: SecurityConfigType;
  
  // 日志配置
  LOG_LEVEL: string;
}

/**
 * 解析布尔值环境变量
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value === "true";
}

/**
 * 解析数字环境变量
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * 解析浮点数环境变量
 */
function parseFloatValue(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * 解析数组环境变量 (逗号分隔)
 */
function parseArray(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(",").map(v => v.trim()).filter(v => v.length > 0);
}

export const config: AppConfig = {
  // RPC 配置
  RPC_URL: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
  RPC_WS_URL: process.env.RPC_WS_URL || "wss://api.mainnet-beta.solana.com",
  BACKUP_RPC_URLS: parseArray(process.env.BACKUP_RPC_URLS),
  
  // 钱包配置
  PRIVATE_KEY: process.env.PRIVATE_KEY || "",
  
  // 狙击配置
  SNIPER: {
    USE_TPU_DIRECT: parseBoolean(process.env.USE_TPU_DIRECT, true),
    SEND_TO_MULTIPLE_LEADERS: parseBoolean(process.env.SEND_TO_MULTIPLE_LEADERS, true),
    PRE_SEND_LEADER_COUNT: parseNumber(process.env.PRE_SEND_LEADER_COUNT, 2),
    TIMEOUT: parseNumber(process.env.TIMEOUT, 5000),
    MAX_RETRIES: parseNumber(process.env.MAX_RETRIES, 3)
  },
  
  // 缓存配置
  CACHE: {
    LEADER_CACHE_TTL: parseNumber(process.env.LEADER_CACHE_TTL, 300000),
    CLUSTER_NODES_CACHE_TTL: parseNumber(process.env.CLUSTER_NODES_CACHE_TTL, 600000),
    VOTE_ACCOUNTS_CACHE_TTL: parseNumber(process.env.VOTE_ACCOUNTS_CACHE_TTL, 300000)
  },
  
  // 交易配置
  TRADING: {
    BUY_AMOUNT: parseFloatValue(process.env.BUY_AMOUNT, 0.1),
    JITO_TIP: parseFloatValue(process.env.JITO_TIP, 0.001),
    TAKE_PROFIT: parseFloatValue(process.env.TAKE_PROFIT, 2.0),
    STOP_LOSS: parseFloatValue(process.env.STOP_LOSS, 0.5),
    TRAILING_STOP: parseFloatValue(process.env.TRAILING_STOP, 0.2)
  },
  
  // 安全配置
  SECURITY: {
    MAX_TOP10_HOLDERS: parseNumber(process.env.MAX_TOP10_HOLDERS, 30),
    MIN_LP_LOCKED: parseNumber(process.env.MIN_LP_LOCKED, 95)
  },
  
  // 日志配置
  LOG_LEVEL: process.env.LOG_LEVEL || "info"
};

/**
 * 验证配置
 */
export function validateConfig(): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!config.RPC_URL) {
    errors.push("RPC_URL is required");
  }
  
  if (!config.PRIVATE_KEY || config.PRIVATE_KEY.length === 0) {
    warnings.push("PRIVATE_KEY not configured - running in demo mode (no real trades)");
  }
  
  if (config.SNIPER.TIMEOUT < 1000) {
    errors.push("TIMEOUT should be at least 1000ms");
  }
  
  if (config.TRADING.BUY_AMOUNT <= 0) {
    errors.push("BUY_AMOUNT must be positive");
  }
  
  // 打印警告
  if (warnings.length > 0) {
    console.warn("Configuration warnings:");
    warnings.forEach(w => console.warn(`  - ${w}`));
  }
  
  // 只有错误才抛出
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join("\n")}`);
  }
}

export default config;