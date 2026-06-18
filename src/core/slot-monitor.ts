import { Connection } from "@solana/web3.js";
import { Logger } from "../utils/logger";
import { LeaderTracker, LeaderInfo } from "./leader-tracker";

const logger = new Logger("SlotMonitor");

export interface SlotInfo {
  slot: number;
  epoch: number;
  slotIndex: number;
  leader: LeaderInfo | null;
  timestamp: number;
  blockTime?: number;
}

export type SlotCallback = (slotInfo: SlotInfo) => void;

/**
 * Slot 监控器
 * 
 * 监控 Solana Slot 变化，实时更新 Leader 信息
 */
export class SlotMonitor {
  private connection: Connection;
  private leaderTracker: LeaderTracker;
  private subscriptionId: number | null = null;
  private callbacks: SlotCallback[] = [];
  private lastSlot: number = 0;
  private slotStartTime: number = 0;
  
  // Solana 每个 Slot 约 400ms
  private readonly SLOT_DURATION_MS = 400;
  
  constructor(connection: Connection, leaderTracker: LeaderTracker) {
    this.connection = connection;
    this.leaderTracker = leaderTracker;
  }
  
  /**
   * 启动 Slot 监控
   */
  async start(): Promise<void> {
    logger.info("Starting Slot Monitor...");
    
    // 启动 Leader 追踪器
    await this.leaderTracker.start();
    
    // 订阅 Slot 更新
    this.subscriptionId = this.connection.onSlotChange(
      (slotInfo) => {
        this.handleSlotChange(slotInfo);
      }
    );
    
    logger.info(`Slot Monitor started, subscriptionId: ${this.subscriptionId}`);
  }
  
  /**
   * 停止 Slot 监控
   */
  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      await this.connection.removeSlotChangeListener(this.subscriptionId);
      this.subscriptionId = null;
    }
    
    this.leaderTracker.stop();
    this.callbacks = [];
    logger.info("Slot Monitor stopped");
  }
  
  /**
   * 订阅 Slot 更新
   */
  onSlot(callback: SlotCallback): void {
    this.callbacks.push(callback);
    logger.debug(`Slot callback registered, total: ${this.callbacks.length}`);
  }
  
  /**
   * 移除 Slot 回调
   */
  removeCallback(callback: SlotCallback): void {
    this.callbacks = this.callbacks.filter(cb => cb !== callback);
  }
  
  /**
   * 处理 Slot 变化
   */
  private handleSlotChange(slotInfo: { slot: number; parent: number }): void {
    // 避免重复处理
    if (slotInfo.slot <= this.lastSlot) {
      return;
    }
    
    // 记录 Slot 开始时间
    this.slotStartTime = Date.now();
    this.lastSlot = slotInfo.slot;
    
    // 获取当前 Leader
    const leader = this.leaderTracker.getCurrentLeader();
    
    // 计算 Epoch 信息
    const slotsPerEpoch = 432000;  // 每个 Epoch 约 432,000 slots
    const epoch = Math.floor(slotInfo.slot / slotsPerEpoch);
    const slotIndex = slotInfo.slot % slotsPerEpoch;
    
    const info: SlotInfo = {
      slot: slotInfo.slot,
      epoch,
      slotIndex,
      leader,
      timestamp: Date.now()
    };
    
    // 触发回调
    this.callbacks.forEach(callback => {
      try {
        callback(info);
      } catch (error: unknown) {
        logger.error("Callback error", error instanceof Error ? error : String(error));
      }
    });
    
    logger.debug(`Slot ${slotInfo.slot}`, {
      epoch,
      slotIndex,
      leader: leader?.identity,
      ip: leader?.ip,
      tpu: leader?.ports?.tpu
    });
  }
  
  /**
   * 获取当前 Slot 信息
   */
  async getCurrentSlot(): Promise<SlotInfo> {
    const epochInfo = await this.connection.getEpochInfo();
    const leader = this.leaderTracker.getCurrentLeader();
    
    const slotsPerEpoch = 432000;
    
    return {
      slot: epochInfo.absoluteSlot,
      epoch: epochInfo.epoch,
      slotIndex: epochInfo.slotIndex,
      leader,
      timestamp: Date.now()
    };
  }
  
  /**
   * 等待下一个 Slot
   */
  async waitForNextSlot(): Promise<SlotInfo> {
    return new Promise((resolve) => {
      const callback = (slotInfo: SlotInfo) => {
        this.removeCallback(callback);
        resolve(slotInfo);
      };
      this.callbacks.push(callback);
    });
  }
  
  /**
   * 计算当前 Slot 剩余时间
   */
  getSlotRemainingTime(): number {
    if (this.slotStartTime === 0) {
      return this.SLOT_DURATION_MS;
    }
    
    const elapsed = Date.now() - this.slotStartTime;
    return Math.max(0, this.SLOT_DURATION_MS - elapsed);
  }
  
  /**
   * 判断是否接近 Slot 切换
   */
  isNearSlotSwitch(thresholdMs: number = 100): boolean {
    return this.getSlotRemainingTime() < thresholdMs;
  }
  
  /**
   * 获取 Slot 统计信息
   */
  getStats(): {
    lastSlot: number;
    slotStartTime: number;
    slotRemainingMs: number;
    callbacksCount: number;
    leaderStats: ReturnType<LeaderTracker['getStats']>;
  } {
    return {
      lastSlot: this.lastSlot,
      slotStartTime: this.slotStartTime,
      slotRemainingMs: this.getSlotRemainingTime(),
      callbacksCount: this.callbacks.length,
      leaderStats: this.leaderTracker.getStats()
    };
  }
}

export default SlotMonitor;