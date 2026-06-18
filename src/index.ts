import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { LeaderTracker } from "./core/leader-tracker";
import { SlotMonitor } from "./core/slot-monitor";
import { SniperSender } from "./core/sniper-sender";
import { TokenAuditor } from "./security/token-audit";
import { LiquidityMonitor } from "./monitor/liquidity-monitor";
import { SwapBuilder } from "./executor/swap-builder";
import { JitoBundleSender } from "./executor/jito-bundle";
import { SellStrategyManager } from "./strategy/sell-strategy";
import { Logger } from "./utils/logger";
import { config, validateConfig } from "./config";

const logger = new Logger("Main");

/**
 * 狙击机器人主类 - 完整版
 * 
 * 功能模块:
 * 1. Leader Tracker - Leader IP 和 TPU 端口计算
 * 2. Slot Monitor - Slot 监控
 * 3. Liquidity Monitor - 流动性监听 (Raydium/Pump.fun)
 * 4. Token Auditor - 代币安全审计
 * 5. Swap Builder - Swap 指令构建
 * 6. Jito Bundle - Jito Bundle 发送
 * 7. Sell Strategy - 止盈止损策略
 */
export class SniperBot {
  private connection: Connection;
  private wallet: Keypair;
  
  // 核心组件
  private leaderTracker: LeaderTracker;
  private slotMonitor: SlotMonitor;
  private sniperSender: SniperSender;
  
  // 新增组件
  private tokenAuditor: TokenAuditor;
  private liquidityMonitor: LiquidityMonitor;
  private swapBuilder: SwapBuilder;
  private jitoSender: JitoBundleSender;
  private sellStrategy: SellStrategyManager;
  
  private isRunning: boolean = false;

  constructor() {
    // 验证配置
    try {
      validateConfig();
    } catch (error: unknown) {
      logger.error("Configuration validation failed", error instanceof Error ? error : String(error));
      throw error;
    }

    // 初始化连接
    this.connection = new Connection(config.RPC_URL, {
      commitment: "processed"
    });

    // 初始化钱包 (如果私钥配置了)
    const privateKey = config.PRIVATE_KEY;
    // 检查是否是占位符或空值
    if (privateKey && privateKey.length > 0 && privateKey !== "your_private_key_here") {
      try {
        this.wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
      } catch (error) {
        logger.warn("Invalid PRIVATE_KEY format, using random wallet for demo mode");
        this.wallet = Keypair.generate();
      }
    } else {
      // 演示模式：使用随机钱包
      this.wallet = Keypair.generate();
      logger.warn("PRIVATE_KEY not configured, using random wallet for demo mode");
    }

    // 初始化核心组件
    this.leaderTracker = new LeaderTracker(this.connection);
    this.slotMonitor = new SlotMonitor(this.connection, this.leaderTracker);
    this.sniperSender = new SniperSender(
      this.connection,
      this.leaderTracker,
      this.slotMonitor
    );

    // 初始化新增组件
    this.tokenAuditor = new TokenAuditor(this.connection);
    this.liquidityMonitor = new LiquidityMonitor(this.connection);
    this.swapBuilder = new SwapBuilder(this.connection, this.wallet);
    this.jitoSender = new JitoBundleSender(this.connection, this.wallet);
    this.sellStrategy = new SellStrategyManager(this.connection);

    logger.info("SniperBot initialized with all modules");
  }

  /**
   * 启动狙击机器人
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("SniperBot is already running");
      return;
    }

    logger.info("Starting SniperBot...");
    this.isRunning = true;

    // 启动核心组件
    await this.slotMonitor.start();

    // 启动流动性监听
    await this.liquidityMonitor.start();

    // 注册流动性事件处理
    this.liquidityMonitor.onLiquidity(async (event) => {
      await this.handleLiquidityEvent(event);
    });

    // 注册卖出信号处理
    this.sellStrategy.onSell(async (signal) => {
      await this.handleSellSignal(signal);
    });

    // 监听 Slot 变化
    this.slotMonitor.onSlot((slotInfo) => {
      this.handleSlotChange(slotInfo);
    });

    logger.info("SniperBot started successfully");
  }

  /**
   * 停止狙击机器人
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn("SniperBot is not running");
      return;
    }

    logger.info("Stopping SniperBot...");
    this.isRunning = false;

    // 停止所有组件
    await this.slotMonitor.stop();
    await this.liquidityMonitor.stop();
    this.sellStrategy.stop();
    this.sniperSender.close();

    logger.info("SniperBot stopped");
  }

  /**
   * 处理 Slot 变化
   */
  private handleSlotChange(slotInfo: any): void {
    logger.debug(`Slot ${slotInfo.slot}`, {
      epoch: slotInfo.epoch,
      leader: slotInfo.leader?.identity,
      ip: slotInfo.leader?.ip,
      tpu: slotInfo.leader?.ports?.tpu
    });
  }

  /**
   * 处理流动性事件
   */
  private async handleLiquidityEvent(event: any): Promise<void> {
    logger.info("Liquidity event detected", {
      type: event.type,
      signature: event.signature,
      mint: event.mint
    });

    // 如果有 Mint 地址，执行安全检查
    if (event.mint) {
      const auditResult = await this.tokenAuditor.quickCheck(event.mint);
      
      if (!auditResult) {
        logger.warn("Token security check failed, skipping", { mint: event.mint });
        return;
      }

      // 执行完整审计 (可选)
      const fullAudit = await this.tokenAuditor.auditToken(event.mint);
      logger.info("Token audit result", {
        mint: event.mint,
        score: fullAudit.score,
        safe: fullAudit.safe,
        issues: fullAudit.issues
      });

      // 如果安全，执行买入
      if (fullAudit.safe) {
        await this.executeBuy(event.mint);
      }
    }
  }

  /**
   * 执行买入
   */
  private async executeBuy(mint: string): Promise<void> {
    try {
      logger.info("Executing buy", { mint });

      // 构建 Swap 交易
      const swapResult = await this.swapBuilder.buildBuyTransaction({
        mint,
        amount: config.TRADING.BUY_AMOUNT,
        slippage: 50,  // 50% 滑点
        side: "buy"
      });

      // 模拟交易验证
      const simulation = await this.swapBuilder.simulateTransaction(swapResult.transaction);
      
      if (!simulation.success) {
        logger.error("Buy simulation failed", simulation.error);
        return;
      }

      // 通过 Jito 发送
      const jitoResult = await this.jitoSender.sendBundle(swapResult.transaction);
      
      if (jitoResult.success) {
        logger.info("Buy executed via Jito", {
          bundleId: jitoResult.bundleId,
          latency: jitoResult.latency
        });

        // 添加到卖出策略监控
        this.sellStrategy.addPosition(
          mint,
          config.TRADING.BUY_AMOUNT,
          config.TRADING.BUY_AMOUNT,
          jitoResult.bundleId || ""
        );
      } else {
        logger.error("Jito send failed", jitoResult.error);
      }

    } catch (error: unknown) {
      logger.error("Execute buy failed", error instanceof Error ? error : String(error));
    }
  }

  /**
   * 处理卖出信号
   */
  private async handleSellSignal(signal: any): Promise<void> {
    logger.info("Sell signal received", {
      type: signal.type,
      mint: signal.position.mint,
      sellPercentage: signal.sellPercentage,
      reason: signal.reason
    });

    try {
      // 构建卖出交易
      const sellResult = await this.swapBuilder.buildSellTransaction({
        mint: signal.position.mint,
        amount: signal.position.buyAmount * signal.sellPercentage,
        slippage: 50,
        side: "sell"
      });

      // 发送卖出交易
      const sendResult = await this.sniperSender.sendTransaction(sellResult.transaction);
      
      if (sendResult.success) {
        logger.info("Sell executed", {
          signature: sendResult.signature,
          method: sendResult.method
        });
      } else {
        logger.error("Sell failed", sendResult.error);
      }

    } catch (error: unknown) {
      logger.error("Execute sell failed", error instanceof Error ? error : String(error));
    }
  }

  /**
   * 获取当前 Leader 信息
   */
  async getCurrentLeader(): Promise<any> {
    return await this.leaderTracker.getCurrentLeaderFresh();
  }

  /**
   * 获取接下来的 Leaders
   */
  async getNextLeaders(count: number): Promise<any[]> {
    return await this.leaderTracker.getNextLeaders(count);
  }

  /**
   * 获取当前 Slot 信息
   */
  async getCurrentSlot(): Promise<any> {
    return await this.slotMonitor.getCurrentSlot();
  }

  /**
   * 审计代币
   */
  async auditToken(mint: string): Promise<any> {
    return await this.tokenAuditor.auditToken(mint);
  }

  /**
   * 获取所有持仓
   */
  getPositions(): any[] {
    return this.sellStrategy.getPositions();
  }

  /**
   * 手动卖出
   */
  manualSell(mint: string, percentage: number = 1.0): any | null {
    return this.sellStrategy.manualSell(mint, percentage);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    isRunning: boolean;
    sniperStats: ReturnType<SniperSender['getStats']>;
    liquidityStats: ReturnType<LiquidityMonitor['getStats']>;
    sellStats: ReturnType<SellStrategyManager['getStats']>;
    jitoStats: ReturnType<JitoBundleSender['getStats']>;
  } {
    return {
      isRunning: this.isRunning,
      sniperStats: this.sniperSender.getStats(),
      liquidityStats: this.liquidityMonitor.getStats(),
      sellStats: this.sellStrategy.getStats(),
      jitoStats: this.jitoSender.getStats()
    };
  }
}

/**
 * 主函数 - 完整演示
 */
async function main(): Promise<void> {
  logger.info("=== Solana Sniper Bot - Full Demo ===");

  const bot = new SniperBot();

  try {
    // 启动
    await bot.start();

    // 获取当前 Leader 信息
    const leader = await bot.getCurrentLeader();
    console.log("\n=== Current Leader ===");
    console.log(`Identity: ${leader.identity}`);
    console.log(`Vote: ${leader.vote}`);
    console.log(`IP: ${leader.ip}`);
    console.log(`TPU Port: ${leader.ports.tpu}`);
    console.log(`TPU QUIC Port: ${leader.ports.tpuQuic}`);

    // 获取接下来的 Leaders
    const nextLeaders = await bot.getNextLeaders(4);
    console.log("\n=== Next 4 Leaders ===");
    nextLeaders.forEach((l: any, i: number) => {
      console.log(`${i + 1}. Slot ${l.slot}`);
      console.log(`   Identity: ${l.identity}`);
      console.log(`   IP: ${l.ip}`);
      console.log(`   TPU: ${l.ports.tpu}`);
    });

    // 获取统计信息
    const stats = bot.getStats();
    console.log("\n=== Stats ===");
    console.log(`Running: ${stats.isRunning}`);
    console.log(`Liquidity Subscriptions: ${stats.liquidityStats.subscriptionsCount}`);
    console.log(`Positions: ${stats.sellStats.positionsCount}`);

    // 运行 30 秒后停止
    console.log("\n=== Running for 30 seconds... ===");
    await new Promise(resolve => setTimeout(resolve, 30000));

  } catch (error: unknown) {
    logger.error("Main error", error instanceof Error ? error : String(error));
  } finally {
    await bot.stop();
    logger.info("=== Demo Complete ===");
  }
}

// 导出所有模块
export { 
  LeaderTracker, 
  SlotMonitor, 
  SniperSender,
  TokenAuditor,
  LiquidityMonitor,
  SwapBuilder,
  JitoBundleSender,
  SellStrategyManager
};

export default SniperBot;

// 运行主函数
if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error("Fatal error", error instanceof Error ? error : String(error));
    process.exit(1);
  });
}