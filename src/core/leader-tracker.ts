import { Connection, Commitment } from "@solana/web3.js";
import { Logger } from "../utils/logger";
import { CacheManager } from "../utils/cache";
import { config } from "../config";

const logger = new Logger("LeaderTracker");
const cache = new CacheManager();

export interface LeaderInfo {
  identity: string;
  vote: string;
  ip: string;
  ports: {
    gossip: number;
    tpu: number;
    tpuQuic: number;
    tpuForward: number;
    tvu: number;
    tvuQuic: number;
    repair: number;
  };
  slot: number;
  epoch: number;
  expiresAt: number;
}

export interface ClusterNode {
  pubkey: string;
  gossip: string | null;
  tpu: string | null;
  tpuQuic: string | null;
  rpc: string | null;
  version: string;
}

/**
 * 端口偏移量定义
 * Solana 验证者节点的端口分配规则
 */
const PORT_OFFSETS = {
  GOSSIP: 0,
  TPU: 1,
  TPU_QUIC: 2,
  TPU_FORWARD: 3,
  TVU: 4,
  TVU_QUIC: 5,
  REPAIR: 6,
  REPAIR_QUIC: 7,
  RPC: 8,
  RPC_WEBSOCKET: 9
} as const;

export class LeaderTracker {
  private connection: Connection;
  private currentLeader: LeaderInfo | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private nextLeaders: LeaderInfo[] = [];
  
  // 缓存配置
  private readonly CACHE_TTL = config.CACHE.LEADER_CACHE_TTL;
  private readonly UPDATE_INTERVAL = 10000;  // 10 秒更新间隔
  
  constructor(connection: Connection) {
    this.connection = connection;
  }
  
  /**
   * 启动 Leader 追踪
   */
  async start(): Promise<void> {
    logger.info("Starting Leader Tracker...");
    
    // 初始获取
    await this.updateLeader();
    
    // 定时更新
    this.updateInterval = setInterval(async () => {
      try {
        await this.updateLeader();
      } catch (error: unknown) {
        logger.error("Failed to update leader", error instanceof Error ? error : String(error));
      }
    }, this.UPDATE_INTERVAL);
    
    logger.info("Leader Tracker started");
  }
  
  /**
   * 停止 Leader 追踪
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    cache.close();
    logger.info("Leader Tracker stopped");
  }
  
  /**
   * 获取当前 Leader 信息
   */
  getCurrentLeader(): LeaderInfo | null {
    // 检查缓存是否过期
    if (this.currentLeader && Date.now() < this.currentLeader.expiresAt) {
      return this.currentLeader;
    }
    return null;
  }
  
  /**
   * 获取当前 Leader (强制刷新)
   */
  async getCurrentLeaderFresh(): Promise<LeaderInfo> {
    await this.updateLeader();
    if (!this.currentLeader) {
      throw new Error("Failed to get current leader");
    }
    return this.currentLeader;
  }
  
  /**
   * 获取接下来 N 个 Slot 的 Leader
   */
  async getNextLeaders(count: number): Promise<LeaderInfo[]> {
    const cacheKey = `nextLeaders_${count}`;
    
    const cached = cache.get<LeaderInfo[]>(cacheKey);
    if (cached) {
      return cached;
    }
    
    const epochInfo = await this.connection.getEpochInfo("processed" as Commitment);
    const schedule = await this.connection.getLeaderSchedule();
    
    if (!schedule) {
      throw new Error("Failed to get leader schedule");
    }
    
    // 构建完整的 Slot-Leader 映射
    const slotLeaderMap = this.buildSlotLeaderMap(schedule);
    
    const leaders: LeaderInfo[] = [];
    const clusterNodes = await this.connection.getClusterNodes();
    const voteAccounts = await this.connection.getVoteAccounts();
    const allValidators = [...voteAccounts.current, ...voteAccounts.delinquent];
    
    for (let i = 0; i < count; i++) {
      const targetSlot = epochInfo.slotIndex + i;
      const leaderVotePubkey = slotLeaderMap.get(targetSlot);
      
      if (!leaderVotePubkey) continue;
      
      const validator = allValidators.find(v => v.votePubkey === leaderVotePubkey);
      if (!validator) continue;
      
      const node = clusterNodes.find(n => n.pubkey === validator.nodePubkey);
      if (!node || !node.gossip) continue;
      
      const [ip, gossipPort] = node.gossip.split(':');
      const ports = this.calculatePorts(parseInt(gossipPort, 10));
      
      leaders.push({
        identity: validator.nodePubkey,
        vote: leaderVotePubkey,
        ip,
        ports,
        slot: epochInfo.absoluteSlot + i,
        epoch: epochInfo.epoch,
        expiresAt: Date.now() + this.CACHE_TTL
      });
    }
    
    cache.set(cacheKey, leaders, this.CACHE_TTL);
    this.nextLeaders = leaders;
    
    return leaders;
  }
  
  /**
   * 更新 Leader 信息
   */
  private async updateLeader(): Promise<void> {
    const startTime = Date.now();
    
    try {
      // 并行获取所有需要的数据
      const [epochInfo, clusterNodes, voteAccounts, schedule] = await Promise.all([
        this.connection.getEpochInfo("processed" as Commitment),
        this.connection.getClusterNodes(),
        this.connection.getVoteAccounts(),
        this.connection.getLeaderSchedule()
      ]);
      
      if (!schedule) {
        throw new Error("Failed to get leader schedule");
      }
      
      // 找到当前 Leader
      const leaderVotePubkey = this.findLeaderForSlot(schedule, epochInfo.slotIndex);
      
      if (!leaderVotePubkey) {
        throw new Error("Leader not found for current slot");
      }
      
      // 找到验证者信息
      const allValidators = [...voteAccounts.current, ...voteAccounts.delinquent];
      const validator = allValidators.find(v => v.votePubkey === leaderVotePubkey);
      
      if (!validator) {
        throw new Error(`Validator not found for vote pubkey: ${leaderVotePubkey}`);
      }
      
      // 找到节点信息
      const node = clusterNodes.find(n => n.pubkey === validator.nodePubkey);
      
      if (!node) {
        throw new Error(`Node not found for identity: ${validator.nodePubkey}`);
      }
      
      if (!node.gossip) {
        throw new Error(`Node gossip address is null for identity: ${validator.nodePubkey}`);
      }
      
      // 解析地址
      const [ip, gossipPort] = node.gossip.split(':');
      const ports = this.calculatePorts(parseInt(gossipPort, 10));
      
      // 更新缓存
      this.currentLeader = {
        identity: validator.nodePubkey,
        vote: leaderVotePubkey,
        ip,
        ports,
        slot: epochInfo.absoluteSlot,
        epoch: epochInfo.epoch,
        expiresAt: Date.now() + this.CACHE_TTL
      };
      
      const elapsed = Date.now() - startTime;
      logger.debug(`Leader updated in ${elapsed}ms`, {
        identity: this.currentLeader.identity,
        ip: this.currentLeader.ip,
        tpu: this.currentLeader.ports.tpu
      });
      
    } catch (error: unknown) {
      logger.error("Failed to update leader", error instanceof Error ? error : String(error));
      throw error;
    }
  }
  
  /**
   * 查找指定 Slot 的 Leader
   */
  private findLeaderForSlot(
    schedule: { [key: string]: number[] },
    slotIndex: number
  ): string | null {
    for (const [pubkey, slots] of Object.entries(schedule)) {
      if (slots.includes(slotIndex)) {
        return pubkey;
      }
    }
    return null;
  }
  
  /**
   * 构建 Slot -> Leader 映射
   */
  private buildSlotLeaderMap(
    schedule: { [key: string]: number[] }
  ): Map<number, string> {
    const map = new Map<number, string>();
    
    for (const [pubkey, slots] of Object.entries(schedule)) {
      for (const slot of slots) {
        map.set(slot, pubkey);
      }
    }
    
    return map;
  }
  
  /**
   * 计算所有端口
   * 
   * 端口偏移规则:
   * - Gossip    = base_port + 0
   * - TPU       = base_port + 1  (核心!)
   * - TPU QUIC  = base_port + 2
   * - TPU Forward = base_port + 3
   * - TVU       = base_port + 4
   * - TVU QUIC  = base_port + 5
   * - Repair    = base_port + 6
   */
  private calculatePorts(gossipPort: number): LeaderInfo['ports'] {
    return {
      gossip: gossipPort,
      tpu: gossipPort + PORT_OFFSETS.TPU,
      tpuQuic: gossipPort + PORT_OFFSETS.TPU_QUIC,
      tpuForward: gossipPort + PORT_OFFSETS.TPU_FORWARD,
      tvu: gossipPort + PORT_OFFSETS.TVU,
      tvuQuic: gossipPort + PORT_OFFSETS.TVU_QUIC,
      repair: gossipPort + PORT_OFFSETS.REPAIR
    };
  }
  
  /**
   * 获取 Leader 统计信息
   */
  getStats(): {
    currentLeader: LeaderInfo | null;
    nextLeadersCount: number;
    cacheStats: ReturnType<CacheManager['getStats']>;
  } {
    return {
      currentLeader: this.currentLeader,
      nextLeadersCount: this.nextLeaders.length,
      cacheStats: cache.getStats()
    };
  }
}

export default LeaderTracker;