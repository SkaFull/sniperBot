import { Connection, ConnectionConfig } from "@solana/web3.js";
import { Logger } from "./logger";
import { config } from "../config";

const logger = new Logger("ConnectionManager");

export interface ConnectionPool {
  connections: Connection[];
  currentIndex: number;
}

export class ConnectionManager {
  private primaryConnection: Connection;
  private backupConnections: Connection[] = [];
  private currentIndex: number = 0;

  constructor() {
    // 创建主连接
    this.primaryConnection = this.createConnection(config.RPC_URL);

    // 创建备用连接 (如果有配置)
    if (config.BACKUP_RPC_URLS && config.BACKUP_RPC_URLS.length > 0) {
      config.BACKUP_RPC_URLS.forEach(url => {
        this.backupConnections.push(this.createConnection(url));
      });
      logger.info(`Created ${this.backupConnections.length} backup connections`);
    }
  }

  /**
   * 创建连接
   */
  private createConnection(url: string): Connection {
    const connectionConfig: ConnectionConfig = {
      commitment: "processed",
      disableRetryOnRateLimit: false,
      confirmTransactionInitialTimeout: 60000
    };

    const connection = new Connection(url, connectionConfig);

    logger.info(`Connection created: ${url}`);

    return connection;
  }

  /**
   * 获取主连接
   */
  getPrimaryConnection(): Connection {
    return this.primaryConnection;
  }

  /**
   * 获取下一个连接 (轮询)
   */
  getNextConnection(): Connection {
    if (this.backupConnections.length === 0) {
      return this.primaryConnection;
    }

    this.currentIndex = (this.currentIndex + 1) % (this.backupConnections.length + 1);
    
    if (this.currentIndex === 0) {
      return this.primaryConnection;
    }
    
    return this.backupConnections[this.currentIndex - 1];
  }

  /**
   * 获取所有连接
   */
  getAllConnections(): Connection[] {
    return [this.primaryConnection, ...this.backupConnections];
  }

  /**
   * 并行请求 (使用所有连接)
   */
  async parallelRequest<T>(
    requestFn: (connection: Connection) => Promise<T>
  ): Promise<T> {
    const connections = this.getAllConnections();
    
    // 并行发送请求，返回第一个成功的结果
    const results = await Promise.allSettled(
      connections.map(conn => requestFn(conn))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        return result.value;
      }
    }

    // 所有请求都失败
    const errors = results
      .filter(r => r.status === "rejected")
      .map(r => (r as PromiseRejectedResult).reason);

    throw new Error(`All requests failed: ${errors.map(e => e.message).join(", ")}`);
  }

  /**
   * 测试连接健康状态
   */
  async healthCheck(): Promise<{
    url: string;
    healthy: boolean;
    latency: number;
    error?: string;
  }[]> {
    const results: { url: string; healthy: boolean; latency: number; error?: string }[] = [];

    for (const connection of this.getAllConnections()) {
      const startTime = Date.now();
      try {
        await connection.getLatestBlockhash();
        const latency = Date.now() - startTime;
        results.push({
          url: connection.rpcEndpoint,
          healthy: true,
          latency
        });
        logger.debug(`Health check passed: ${connection.rpcEndpoint}, latency: ${latency}ms`);
      } catch (error) {
        const latency = Date.now() - startTime;
        results.push({
          url: connection.rpcEndpoint,
          healthy: false,
          latency,
          error: error instanceof Error ? error.message : String(error)
        });
        logger.warn(`Health check failed: ${connection.rpcEndpoint}`);
      }
    }

    return results;
  }

  /**
   * 获取最快的连接
   */
  async getFastestConnection(): Promise<Connection> {
    const healthResults = await this.healthCheck();
    
    const healthyResults = healthResults
      .filter(r => r.healthy)
      .sort((a, b) => a.latency - b.latency);

    if (healthyResults.length === 0) {
      logger.warn("No healthy connections, using primary");
      return this.primaryConnection;
    }

    const fastestUrl = healthyResults[0].url;
    
    if (fastestUrl === this.primaryConnection.rpcEndpoint) {
      return this.primaryConnection;
    }

    const fastestBackup = this.backupConnections.find(
      conn => conn.rpcEndpoint === fastestUrl
    );

    return fastestBackup || this.primaryConnection;
  }
}

export default ConnectionManager;