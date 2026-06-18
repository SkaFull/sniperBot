import { VersionedTransaction } from "@solana/web3.js";
import dgram from "dgram";
import { Logger } from "../utils/logger";
import { LeaderInfo } from "./leader-tracker";

const logger = new Logger("TPUSender");

export interface TpuSendResult {
  success: boolean;
  leader: string;
  ip: string;
  port: number;
  error?: string;
  latency?: number;
  size?: number;
}

/**
 * UDP 连接池
 * 复用 UDP Socket，避免频繁创建销毁
 */
class UdpConnectionPool {
  private sockets: dgram.Socket[] = [];
  private currentIndex = 0;
  private poolSize: number;
  
  constructor(poolSize: number = 5) {
    this.poolSize = poolSize;
    this.initialize();
  }
  
  private initialize(): void {
    for (let i = 0; i < this.poolSize; i++) {
      const socket = dgram.createSocket("udp4");
      socket.on("error", (err) => {
        logger.error(`UDP socket ${i} error`, err);
      });
      this.sockets.push(socket);
    }
    logger.debug(`UDP connection pool initialized with ${this.poolSize} sockets`);
  }
  
  getSocket(): dgram.Socket {
    const socket = this.sockets[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.poolSize;
    return socket;
  }
  
  close(): void {
    this.sockets.forEach(socket => socket.close());
    this.sockets = [];
    logger.debug("UDP connection pool closed");
  }
}

export class TpuSender {
  private socketPool: UdpConnectionPool;
  private timeout: number;
  
  constructor(timeout: number = 5000) {
    this.timeout = timeout;
    this.socketPool = new UdpConnectionPool(5);
  }
  
  /**
   * 直接发送交易到 Leader TPU
   */
  async sendTransaction(
    transaction: VersionedTransaction,
    leader: LeaderInfo
  ): Promise<TpuSendResult> {
    const startTime = Date.now();
    
    try {
      // 序列化交易
      const serializedTx = Buffer.from(transaction.serialize());
      
      // 发送到 TPU 端口
      await this.sendUdp(
        serializedTx,
        leader.ip,
        leader.ports.tpu
      );
      
      const latency = Date.now() - startTime;
      
      logger.debug(`Transaction sent to Leader TPU`, {
        leader: leader.identity,
        ip: leader.ip,
        port: leader.ports.tpu,
        size: serializedTx.length,
        latency
      });
      
      return {
        success: true,
        leader: leader.identity,
        ip: leader.ip,
        port: leader.ports.tpu,
        latency,
        size: serializedTx.length
      };
      
    } catch (error) {
      const latency = Date.now() - startTime;
      
      logger.error("Failed to send transaction via TPU", {
        error: error instanceof Error ? error.message : String(error),
        leader: leader.identity,
        ip: leader.ip,
        port: leader.ports.tpu
      });
      
      return {
        success: false,
        leader: leader.identity,
        ip: leader.ip,
        port: leader.ports.tpu,
        error: error instanceof Error ? error.message : String(error),
        latency
      };
    }
  }
  
  /**
   * 发送到 TPU QUIC 端口
   * 
   * 注意: QUIC 是 Solana 推荐的交易传输协议
   * 但需要更复杂的实现，这里提供 UDP 作为基础版本
   */
  async sendTransactionQuic(
    transaction: VersionedTransaction,
    leader: LeaderInfo
  ): Promise<TpuSendResult> {
    // 当前版本使用 UDP 作为替代
    // TODO: 实现 QUIC 协议发送
    return this.sendTransaction(transaction, {
      ...leader,
      ports: { ...leader.ports, tpu: leader.ports.tpuQuic }
    });
  }
  
  /**
   * 发送到多个 Leader (当前和下一个)
   */
  async sendToMultipleLeaders(
    transaction: VersionedTransaction,
    leaders: LeaderInfo[]
  ): Promise<TpuSendResult[]> {
    const results = await Promise.all(
      leaders.map(leader => this.sendTransaction(transaction, leader))
    );
    
    // 统计结果
    const successCount = results.filter(r => r.success).length;
    logger.debug(`Sent to ${leaders.length} leaders, ${successCount} succeeded`);
    
    return results;
  }
  
  /**
   * 发送到 TPU Forward 端口
   * 用于转发交易到下一个 Leader
   */
  async sendToTpuForward(
    transaction: VersionedTransaction,
    leader: LeaderInfo
  ): Promise<TpuSendResult> {
    return this.sendTransaction(transaction, {
      ...leader,
      ports: { ...leader.ports, tpu: leader.ports.tpuForward }
    });
  }
  
  /**
   * UDP 发送
   */
  private sendUdp(data: Buffer, ip: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.socketPool.getSocket();
      
      const timeoutId = setTimeout(() => {
        reject(new Error("UDP send timeout"));
      }, this.timeout);
      
      socket.send(data, port, ip, (err) => {
        clearTimeout(timeoutId);
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
  
  /**
   * 关闭资源
   */
  close(): void {
    this.socketPool.close();
    logger.info("TPU Sender closed");
  }
}

export default TpuSender;