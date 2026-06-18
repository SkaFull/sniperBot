import { 
  Connection, 
  VersionedTransaction,
  SendOptions
} from "@solana/web3.js";
import { Logger } from "../utils/logger";
import { LeaderTracker, LeaderInfo } from "./leader-tracker";
import { TpuSender, TpuSendResult } from "./tpu-sender";
import { SlotMonitor } from "./slot-monitor";
import { config } from "../config";

const logger = new Logger("SniperSender");

export interface SniperConfig {
  // 是否使用 TPU 直连
  useTpuDirect: boolean;
  
  // 是否发送到多个 Leader
  sendToMultipleLeaders: boolean;
  
  // 预发送的 Leader 数量
  preSendLeaderCount: number;
  
  // 超时时间
  timeout: number;
  
  // 重试次数
  maxRetries: number;
  
  // 是否启用预测性发送
  enablePredictiveSend: boolean;
}

export interface SendResult {
  success: boolean;
  signature?: string;
  method: "tpu" | "rpc" | "jito" | "multiple";
  leader?: string;
  latency?: number;
  error?: string;
  tpuResults?: TpuSendResult[];
}

/**
 * 狙击交易发送器
 * 
 * 策略:
 * 1. 首先尝试 TPU 直连当前 Leader
 * 2. 同时发送到下一个 Leader (防止 Leader 切换)
 * 3. 如果 TPU 失败，回退到 RPC
 */
export class SniperSender {
  private connection: Connection;
  private leaderTracker: LeaderTracker;
  private slotMonitor: SlotMonitor;
  private tpuSender: TpuSender;
  private config: SniperConfig;
  
  constructor(
    connection: Connection,
    leaderTracker: LeaderTracker,
    slotMonitor: SlotMonitor,
    configOverrides?: Partial<SniperConfig>
  ) {
    this.connection = connection;
    this.leaderTracker = leaderTracker;
    this.slotMonitor = slotMonitor;
    this.tpuSender = new TpuSender(configOverrides?.timeout || config.SNIPER.TIMEOUT);
    
    this.config = {
      useTpuDirect: config.SNIPER.USE_TPU_DIRECT,
      sendToMultipleLeaders: config.SNIPER.SEND_TO_MULTIPLE_LEADERS,
      preSendLeaderCount: config.SNIPER.PRE_SEND_LEADER_COUNT,
      timeout: config.SNIPER.TIMEOUT,
      maxRetries: config.SNIPER.MAX_RETRIES,
      enablePredictiveSend: true,
      ...configOverrides
    };
    
    logger.info("SniperSender initialized", this.config);
  }
  
  /**
   * 发送交易 (极速模式)
   */
  async sendTransaction(
    transaction: VersionedTransaction
  ): Promise<SendResult> {
    const startTime = Date.now();
    
    // 获取签名
    const signature = this.getTransactionSignature(transaction);
    
    try {
      // 策略 1: TPU 直连
      if (this.config.useTpuDirect) {
        const tpuResult = await this.sendViaTpu(transaction);
        
        if (tpuResult.success) {
          return {
            success: true,
            signature,
            method: tpuResult.leadersCount > 1 ? "multiple" : "tpu",
            leader: tpuResult.primaryLeader,
            latency: Date.now() - startTime,
            tpuResults: tpuResult.results
          };
        }
      }
      
      // 策略 2: 回退到 RPC
      const rpcResult = await this.sendViaRpc(transaction);
      
      return {
        success: rpcResult.success,
        signature,
        method: "rpc",
        latency: Date.now() - startTime,
        error: rpcResult.error
      };
      
    } catch (error) {
      return {
        success: false,
        signature,
        method: "tpu",
        error: error instanceof Error ? error.message : String(error),
        latency: Date.now() - startTime
      };
    }
  }
  
  /**
   * 通过 TPU 发送
   */
  private async sendViaTpu(transaction: VersionedTransaction): Promise<{
    success: boolean;
    primaryLeader?: string;
    leadersCount: number;
    results: TpuSendResult[];
  }> {
    try {
      // 获取当前 Leader
      const currentLeader = this.leaderTracker.getCurrentLeader();
      
      if (!currentLeader) {
        logger.warn("No leader info available, falling back to RPC");
        return { success: false, leadersCount: 0, results: [] };
      }
      
      // 构建要发送的 Leader 列表
      const leaders: LeaderInfo[] = [currentLeader];
      
      // 如果配置了多 Leader 发送
      if (this.config.sendToMultipleLeaders) {
        const nextLeaders = await this.leaderTracker.getNextLeaders(
          this.config.preSendLeaderCount
        );
        leaders.push(...nextLeaders.slice(0, this.config.preSendLeaderCount));
      }
      
      // 预测性发送: 如果接近 Slot 切换，额外发送到下一个 Leader
      if (this.config.enablePredictiveSend && this.slotMonitor.isNearSlotSwitch(100)) {
        logger.debug("Near slot switch, enabling predictive send");
        // 已经在 sendToMultipleLeaders 中包含了下一个 Leader
      }
      
      // 并行发送到所有 Leader
      const results = await this.tpuSender.sendToMultipleLeaders(
        transaction,
        leaders
      );
      
      // 只要有一个成功就认为成功
      const successResult = results.find(r => r.success);
      
      if (successResult) {
        logger.info("Transaction sent via TPU", {
          leader: successResult.leader,
          ip: successResult.ip,
          port: successResult.port,
          latency: successResult.latency,
          totalLeaders: leaders.length
        });
        
        return {
          success: true,
          primaryLeader: successResult.leader,
          leadersCount: leaders.length,
          results
        };
      }
      
      // 所有 TPU 发送都失败
      logger.warn("All TPU sends failed, falling back to RPC", {
        results: results.map(r => ({ leader: r.leader, error: r.error }))
      });
      
      return {
        success: false,
        leadersCount: leaders.length,
        results
      };
      
    } catch (error: unknown) {
      logger.error("TPU send failed", error instanceof Error ? error : String(error));
      return { success: false, leadersCount: 0, results: [] };
    }
  }
  
  /**
   * 通过 RPC 发送
   */
  private async sendViaRpc(transaction: VersionedTransaction): Promise<{
    success: boolean;
    signature?: string;
    error?: string;
  }> {
    try {
      const sendOptions: SendOptions = {
        skipPreflight: true,
        maxRetries: this.config.maxRetries,
        preflightCommitment: "processed"
      };
      
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        sendOptions
      );
      
      logger.info("Transaction sent via RPC", { signature });
      
      return { success: true, signature };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("RPC send failed", { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }
  
  /**
   * 发送并确认交易
   */
  async sendAndConfirm(
    transaction: VersionedTransaction,
    confirmationTimeout: number = 30000
  ): Promise<SendResult & { confirmed?: boolean }> {
    const sendResult = await this.sendTransaction(transaction);
    
    if (!sendResult.success || !sendResult.signature) {
      return { ...sendResult, confirmed: false };
    }
    
    try {
      // 等待确认
      const confirmed = await this.confirmTransaction(
        sendResult.signature,
        confirmationTimeout
      );
      
      return { ...sendResult, confirmed };
      
    } catch (error: unknown) {
      logger.error("Transaction confirmation failed", error instanceof Error ? error : String(error));
      return { ...sendResult, confirmed: false };
    }
  }
  
  /**
   * 确认交易
   */
  private async confirmTransaction(
    signature: string,
    timeout: number
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const status = await this.connection.getSignatureStatus(signature);
        
        if (status && status.value) {
          if (status.value.confirmationStatus === "finalized") {
            logger.info("Transaction finalized", { signature });
            return true;
          }
          
          if (status.value.confirmationStatus === "confirmed") {
            logger.debug("Transaction confirmed", { signature });
            return true;
          }
          
          if (status.value.err) {
            logger.error("Transaction failed", { signature, error: JSON.stringify(status.value.err) });
            return false;
          }
        }
        
        // 等待 500ms 后再次检查
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error: unknown) {
        logger.debug("Signature status check error", { error: error instanceof Error ? error.message : String(error) });
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    logger.warn("Transaction confirmation timeout", { signature, timeout });
    return false;
  }
  
  /**
   * 获取交易签名
   */
  private getTransactionSignature(transaction: VersionedTransaction): string {
    const signatures = transaction.signatures;
    if (signatures.length === 0) {
      throw new Error("Transaction has no signatures");
    }
    return Buffer.from(signatures[0]).toString("base64");
  }
  
  /**
   * 获取发送统计
   */
  getStats(): {
    config: SniperConfig;
    slotStats: ReturnType<SlotMonitor['getStats']>;
  } {
    return {
      config: this.config,
      slotStats: this.slotMonitor.getStats()
    };
  }
  
  /**
   * 关闭资源
   */
  close(): void {
    this.tpuSender.close();
    logger.info("SniperSender closed");
  }
}

export default SniperSender;