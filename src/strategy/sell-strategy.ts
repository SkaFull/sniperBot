import { Connection, PublicKey } from "@solana/web3.js";
import { EventEmitter } from "events";
import { Logger } from "../utils/logger";
import { config } from "../config";

const logger = new Logger("SellStrategy");

export interface Position {
  mint: string;
  buyPrice: number;
  buyAmount: number;
  buySignature: string;
  buyTimestamp: number;
  currentPrice: number;
  athPrice: number;  // All-Time High (历史最高价)
  pnl: number;       // 盈亏比例
  pnlUsd: number;    // 盈亏金额
}

export interface SellSignal {
  type: "take_profit" | "stop_loss" | "trailing_stop" | "time_stop";
  position: Position;
  sellPercentage: number;  // 卖出比例 (0-1)
  reason: string;
  timestamp: number;
}

export interface StrategyConfig {
  takeProfit: number;      // 止盈比例 (如 2.0 表示翻倍)
  stopLoss: number;        // 止损比例 (如 0.5 表示亏50%)
  trailingStop: number;    // 移动止损回撤比例 (如 0.2 表示回撤20%)
  timeStop: number;        // 时间止损 (分钟)
  sellOnProfit: number;    // 止盈时卖出比例 (如 0.5 表示卖出50%)
}

export type SellCallback = (signal: SellSignal) => void;

/**
 * 卖出策略管理器
 * 
 * 策略类型:
 * 1. 硬止盈 - 达到目标涨幅卖出部分
 * 2. 硬止损 - 达到亏损阈值全部卖出
 * 3. 移动止损 - 从 ATH 回撤一定比例卖出
 * 4. 时间止损 - 超过时间未盈利卖出
 */
export class SellStrategyManager extends EventEmitter {
  private connection: Connection;
  private config: StrategyConfig;
  private positions: Map<string, Position> = new Map();
  private priceMonitors: Map<string, NodeJS.Timeout> = new Map();
  private callbacks: SellCallback[] = [];
  
  constructor(connection: Connection, configOverrides?: Partial<StrategyConfig>) {
    super();
    this.connection = connection;
    
    this.config = {
      takeProfit: config.TRADING.TAKE_PROFIT,
      stopLoss: config.TRADING.STOP_LOSS,
      trailingStop: config.TRADING.TRAILING_STOP,
      timeStop: 10,  // 默认 10 分钟
      sellOnProfit: 0.5,  // 止盈时卖出 50%
      ...configOverrides
    };
    
    logger.info("SellStrategyManager initialized", this.config);
  }
  
  /**
   * 添加持仓监控
   */
  addPosition(
    mint: string,
    buyPrice: number,
    buyAmount: number,
    buySignature: string
  ): void {
    const position: Position = {
      mint,
      buyPrice,
      buyAmount,
      buySignature,
      buyTimestamp: Date.now(),
      currentPrice: buyPrice,
      athPrice: buyPrice,
      pnl: 0,
      pnlUsd: 0
    };
    
    this.positions.set(mint, position);
    
    // 启动价格监控
    this.startPriceMonitor(mint);
    
    logger.info("Position added", {
      mint,
      buyPrice,
      buyAmount,
      totalPositions: this.positions.size
    });
  }
  
  /**
   * 移除持仓监控
   */
  removePosition(mint: string): void {
    this.positions.delete(mint);
    
    // 停止价格监控
    const monitor = this.priceMonitors.get(mint);
    if (monitor) {
      clearInterval(monitor);
      this.priceMonitors.delete(mint);
    }
    
    logger.info("Position removed", { mint });
  }
  
  /**
   * 启动价格监控
   */
  private startPriceMonitor(mint: string): void {
    // 每 1 秒更新价格
    const monitor = setInterval(async () => {
      try {
        await this.updatePrice(mint);
      } catch (error) {
        logger.debug("Price update failed", {
          mint,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, 1000);
    
    this.priceMonitors.set(mint, monitor);
  }
  
  /**
   * 更新价格
   */
  private async updatePrice(mint: string): Promise<void> {
    const position = this.positions.get(mint);
    if (!position) return;
    
    // 获取当前价格 (模拟实现)
    // 真实实现需要从池子获取价格
    const currentPrice = await this.fetchPrice(mint);
    
    // 更新持仓信息
    position.currentPrice = currentPrice;
    
    // 更新 ATH
    if (currentPrice > position.athPrice) {
      position.athPrice = currentPrice;
      logger.debug("ATH updated", {
        mint,
        newAth: position.athPrice,
        pnl: position.pnl
      });
    }
    
    // 计算盈亏
    position.pnl = (currentPrice - position.buyPrice) / position.buyPrice;
    position.pnlUsd = (currentPrice - position.buyPrice) * position.buyAmount;
    
    // 检查策略触发
    this.checkStrategies(position);
  }
  
  /**
   * 获取当前价格
   */
  private async fetchPrice(mint: string): Promise<number> {
    // 模拟实现
    // 真实实现需要:
    // 1. 查找池子地址
    // 2. 获取池子储备
    // 3. 计算价格 = SOL_Reserve / Token_Reserve
    
    // 或使用模拟卖出获取真实价格
    
    const position = this.positions.get(mint);
    if (!position) return 0;
    
    // 模拟价格波动
    const randomChange = (Math.random() - 0.5) * 0.1;  // ±5% 波动
    return position.currentPrice * (1 + randomChange);
  }
  
  /**
   * 检查所有策略
   */
  private checkStrategies(position: Position): void {
    // 1. 检查止盈
    if (position.pnl >= this.config.takeProfit - 1) {
      this.triggerSell(position, "take_profit", this.config.sellOnProfit);
      return;
    }
    
    // 2. 检查止损
    if (position.pnl <= -(1 - this.config.stopLoss)) {
      this.triggerSell(position, "stop_loss", 1.0);  // 全部卖出
      return;
    }
    
    // 3. 检查移动止损
    const drawdownFromAth = (position.athPrice - position.currentPrice) / position.athPrice;
    if (drawdownFromAth >= this.config.trailingStop) {
      this.triggerSell(position, "trailing_stop", 1.0);
      return;
    }
    
    // 4. 检查时间止损
    const elapsedMinutes = (Date.now() - position.buyTimestamp) / 60000;
    if (elapsedMinutes >= this.config.timeStop && position.pnl < 0.2) {
      this.triggerSell(position, "time_stop", 1.0);
      return;
    }
  }
  
  /**
   * 触发卖出信号
   */
  private triggerSell(
    position: Position,
    type: SellSignal['type'],
    sellPercentage: number
  ): void {
    const signal: SellSignal = {
      type,
      position,
      sellPercentage,
      reason: this.getReason(type, position),
      timestamp: Date.now()
    };
    
    logger.info("Sell signal triggered", {
      type,
      mint: position.mint,
      pnl: position.pnl,
      sellPercentage,
      reason: signal.reason
    });
    
    // 触发事件
    this.emit("sell", signal);
    
    // 执行回调
    this.callbacks.forEach(callback => {
      try {
        callback(signal);
      } catch (error) {
        logger.error("Callback error", error instanceof Error ? error : String(error));
      }
    });
    
    // 如果全部卖出，移除持仓
    if (sellPercentage >= 1.0) {
      this.removePosition(position.mint);
    }
  }
  
  /**
   * 获取卖出原因
   */
  private getReason(type: SellSignal['type'], position: Position): string {
    switch (type) {
      case "take_profit":
        return `达到止盈目标 (+${((position.pnl) * 100).toFixed(1)}%)`;
      case "stop_loss":
        return `触发止损 (${((position.pnl) * 100).toFixed(1)}%)`;
      case "trailing_stop":
        return `移动止损触发，从 ATH 回撤 ${(((position.athPrice - position.currentPrice) / position.athPrice) * 100).toFixed(1)}%`;
      case "time_stop":
        return `时间止损，持仓 ${((Date.now() - position.buyTimestamp) / 60000).toFixed(1)} 分钟未盈利`;
      default:
        return "未知原因";
    }
  }
  
  /**
   * 注册卖出回调
   */
  onSell(callback: SellCallback): void {
    this.callbacks.push(callback);
    this.on("sell", callback);
  }
  
  /**
   * 获取所有持仓
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }
  
  /**
   * 获取指定持仓
   */
  getPosition(mint: string): Position | undefined {
    return this.positions.get(mint);
  }
  
  /**
   * 手动触发卖出
   */
  manualSell(mint: string, percentage: number = 1.0): SellSignal | null {
    const position = this.positions.get(mint);
    if (!position) {
      logger.warn("Position not found", { mint });
      return null;
    }
    
    const signal: SellSignal = {
      type: "take_profit",
      position,
      sellPercentage: percentage,
      reason: "手动卖出",
      timestamp: Date.now()
    };
    
    this.emit("sell", signal);
    
    if (percentage >= 1.0) {
      this.removePosition(mint);
    }
    
    return signal;
  }
  
  /**
   * 停止所有监控
   */
  stop(): void {
    // 停止所有价格监控
    for (const [mint, monitor] of this.priceMonitors) {
      clearInterval(monitor);
      logger.debug("Price monitor stopped", { mint });
    }
    
    this.priceMonitors.clear();
    this.positions.clear();
    this.callbacks = [];
    
    logger.info("SellStrategyManager stopped");
  }
  
  /**
   * 获取统计信息
   */
  getStats(): {
    positionsCount: number;
    monitorsCount: number;
    config: StrategyConfig;
    totalPnl: number;
  } {
    const positions = this.getPositions();
    const totalPnl = positions.reduce((sum, p) => sum + p.pnlUsd, 0);
    
    return {
      positionsCount: positions.length,
      monitorsCount: this.priceMonitors.size,
      config: this.config,
      totalPnl
    };
  }
}

export default SellStrategyManager;