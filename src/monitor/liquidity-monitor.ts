import { Connection, PublicKey } from "@solana/web3.js";
import { EventEmitter } from "events";
import { Logger } from "../utils/logger";

const logger = new Logger("LiquidityMonitor");

// Program IDs (真实地址)
const RAYDIUM_AMM_PROGRAM = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const ORCA_WHIRLPOOL_PROGRAM = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");

export interface LiquidityEvent {
  type: "raydium" | "pumpfun" | "orca";
  signature: string;
  mint?: string;
  poolId?: string;
  timestamp: number;
  slot: number;
  logs: string[];
}

export interface PumpFunCreateEvent extends LiquidityEvent {
  type: "pumpfun";
  mint: string;
  name: string;
  symbol: string;
  creator: string;
}

export interface RaydiumPoolEvent extends LiquidityEvent {
  type: "raydium";
  mint: string;
  poolId: string;
  baseMint: string;
  quoteMint: string;
}

export type LiquidityCallback = (event: LiquidityEvent) => void;

/**
 * 流动性监听器
 * 
 * 监听目标:
 * 1. Raydium AMM - initialize2 指令 (创建池子)
 * 2. Pump.fun - Create 指令 (发币)
 * 3. Orca Whirlpool - 创建池子
 */
export class LiquidityMonitor extends EventEmitter {
  private connection: Connection;
  private subscriptions: number[] = [];
  private callbacks: Map<string, LiquidityCallback[]> = new Map();
  private isRunning: boolean = false;
  
  constructor(connection: Connection) {
    super();
    this.connection = connection;
  }
  
  /**
   * 启动监听
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Monitor is already running");
      return;
    }
    
    logger.info("Starting Liquidity Monitor...");
    this.isRunning = true;
    
    // 并行启动所有监听
    await Promise.all([
      this.startRaydiumMonitor(),
      this.startPumpFunMonitor(),
      this.startOrcaMonitor()
    ]);
    
    logger.info("Liquidity Monitor started successfully");
  }
  
  /**
   * 停止监听
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    logger.info("Stopping Liquidity Monitor...");
    this.isRunning = false;
    
    // 移除所有订阅
    for (const subId of this.subscriptions) {
      try {
        await this.connection.removeOnLogsListener(subId);
      } catch (error) {
        logger.debug(`Failed to remove subscription ${subId}`);
      }
    }
    
    this.subscriptions = [];
    this.callbacks.clear();
    
    logger.info("Liquidity Monitor stopped");
  }
  
  /**
   * 监听 Raydium 流动性添加
   */
  private async startRaydiumMonitor(): Promise<void> {
    logger.info("Starting Raydium monitor...");
    
    const subId = this.connection.onLogs(
      RAYDIUM_AMM_PROGRAM,
      (logs, context) => {
        this.handleRaydiumLogs(logs, context);
      },
      "processed"
    );
    
    this.subscriptions.push(subId);
    logger.info(`Raydium monitor started, subscription: ${subId}`);
  }
  
  /**
   * 监听 Pump.fun 发币
   */
  private async startPumpFunMonitor(): Promise<void> {
    logger.info("Starting Pump.fun monitor...");
    
    const subId = this.connection.onLogs(
      PUMP_FUN_PROGRAM,
      (logs, context) => {
        this.handlePumpFunLogs(logs, context);
      },
      "processed"
    );
    
    this.subscriptions.push(subId);
    logger.info(`Pump.fun monitor started, subscription: ${subId}`);
  }
  
  /**
   * 监听 Orca Whirlpool
   */
  private async startOrcaMonitor(): Promise<void> {
    logger.info("Starting Orca monitor...");
    
    const subId = this.connection.onLogs(
      ORCA_WHIRLPOOL_PROGRAM,
      (logs, context) => {
        this.handleOrcaLogs(logs, context);
      },
      "processed"
    );
    
    this.subscriptions.push(subId);
    logger.info(`Orca monitor started, subscription: ${subId}`);
  }
  
  /**
   * 处理 Raydium 日志
   */
  private handleRaydiumLogs(
    logs: { logs: string[]; err: any; signature: string },
    context: { slot: number }
  ): void {
    // 忽略失败的交易
    if (logs.err) {
      return;
    }
    
    // 检查是否是 initialize2 指令
    const isPoolInit = logs.logs.some(log => 
      log.includes("initialize2") || 
      log.includes("Instruction: InitializePool2")
    );
    
    if (isPoolInit) {
      logger.info("Raydium pool detected!", {
        signature: logs.signature,
        slot: context.slot
      });
      
      const event: LiquidityEvent = {
        type: "raydium",
        signature: logs.signature,
        timestamp: Date.now(),
        slot: context.slot,
        logs: logs.logs
      };
      
      // 解析 Mint 地址 (需要从交易详情获取)
      this.parseRaydiumEvent(logs.signature, event);
      
      // 立即触发事件
      this.emit("raydium", event);
      this.emit("liquidity", event);
    }
  }
  
  /**
   * 处理 Pump.fun 日志
   */
  private handlePumpFunLogs(
    logs: { logs: string[]; err: any; signature: string },
    context: { slot: number }
  ): void {
    // 忽略失败的交易
    if (logs.err) {
      return;
    }
    
    // 检查是否是 Create 指令
    const isCreate = logs.logs.some(log => 
      log.includes("Instruction: Create") ||
      log.includes("Program log: Create")
    );
    
    if (isCreate) {
      logger.info("Pump.fun new token detected!", {
        signature: logs.signature,
        slot: context.slot
      });
      
      const event: LiquidityEvent = {
        type: "pumpfun",
        signature: logs.signature,
        timestamp: Date.now(),
        slot: context.slot,
        logs: logs.logs
      };
      
      // 解析 Mint 地址
      this.parsePumpFunEvent(logs.signature, event);
      
      // 立即触发事件
      this.emit("pumpfun", event);
      this.emit("liquidity", event);
    }
  }
  
  /**
   * 处理 Orca 日志
   */
  private handleOrcaLogs(
    logs: { logs: string[]; err: any; signature: string },
    context: { slot: number }
  ): void {
    // 忽略失败的交易
    if (logs.err) {
      return;
    }
    
    // 检查是否是创建池子指令
    const isPoolInit = logs.logs.some(log => 
      log.includes("InitializePool") ||
      log.includes("Instruction: InitializePool")
    );
    
    if (isPoolInit) {
      logger.info("Orca pool detected!", {
        signature: logs.signature,
        slot: context.slot
      });
      
      const event: LiquidityEvent = {
        type: "orca",
        signature: logs.signature,
        timestamp: Date.now(),
        slot: context.slot,
        logs: logs.logs
      };
      
      this.emit("orca", event);
      this.emit("liquidity", event);
    }
  }
  
  /**
   * 解析 Raydium 事件详情
   */
  private async parseRaydiumEvent(
    signature: string,
    event: LiquidityEvent
  ): Promise<void> {
    try {
      // 获取交易详情
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0
      });
      
      if (!tx) {
        logger.debug("Failed to get transaction details");
        return;
      }
      
      // 从账户列表中提取 Mint 地址
      const accountKeys = tx.transaction.message.accountKeys;
      
      // Raydium V4 池子创建的账户顺序:
      // 0: Token Program
      // 1: System Program
      // 2: Rent
      // 3: AMM Program
      // 4: Pool Coin Token Account
      // 5: Pool PC Token Account
      // 6: Coin Mint (目标代币)
      // 7: PC Mint (通常是 SOL 或 USDC)
      // ...
      
      if (accountKeys.length >= 8) {
        event.mint = accountKeys[6].pubkey.toString();
        event.poolId = accountKeys[4].pubkey.toString();
      }
      
      logger.debug("Raydium event parsed", {
        signature,
        mint: event.mint,
        poolId: event.poolId
      });
      
    } catch (error) {
      logger.debug("Failed to parse Raydium event", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  /**
   * 解析 Pump.fun 事件详情
   */
  private async parsePumpFunEvent(
    signature: string,
    event: LiquidityEvent
  ): Promise<void> {
    try {
      // 获取交易详情
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0
      });
      
      if (!tx) {
        logger.debug("Failed to get transaction details");
        return;
      }
      
      // 从账户列表中提取 Mint 地址
      const accountKeys = tx.transaction.message.accountKeys;
      
      // Pump.fun Create 指令的账户顺序:
      // Mint 地址通常在固定位置 (如 index 1 或 2)
      
      if (accountKeys.length >= 2) {
        event.mint = accountKeys[1].pubkey.toString();
      }
      
      logger.debug("Pump.fun event parsed", {
        signature,
        mint: event.mint
      });
      
    } catch (error) {
      logger.debug("Failed to parse Pump.fun event", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  /**
   * 注册回调
   */
  onLiquidity(callback: LiquidityCallback): void {
    this.on("liquidity", callback);
  }
  
  /**
   * 注册 Raydium 回调
   */
  onRaydium(callback: LiquidityCallback): void {
    this.on("raydium", callback);
  }
  
  /**
   * 注册 Pump.fun 回调
   */
  onPumpFun(callback: LiquidityCallback): void {
    this.on("pumpfun", callback);
  }
  
  /**
   * 获取统计信息
   */
  getStats(): {
    isRunning: boolean;
    subscriptionsCount: number;
    callbacksCount: number;
  } {
    return {
      isRunning: this.isRunning,
      subscriptionsCount: this.subscriptions.length,
      callbacksCount: this.listenerCount("liquidity")
    };
  }
}

export default LiquidityMonitor;