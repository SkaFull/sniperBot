[简体中文](./sniper-mode.md) | [English](./sniper-mode_EN.md) | [繁體中文](./sniper-mode_HK.md)

# Solana 狙擊模式（極速通道）詳細實現方案

## 目錄

1. [概述](#概述)
2. [Solana 共識機制基礎](#solana-共識機制基礎)
3. [Leader 調度原理](#leader-調度原理)
4. [Leader IP 地址計算](#leader-ip-地址計算)
5. [Leader TPU 端口計算](#leader-tpu-端口計算)
6. [完整代碼實現](#完整代碼實現)
7. [性能優化策略](#性能優化策略)
8. [部署與測試](#部署與測試)

---

## 概述

### 什麼是狙擊模式？

狙擊模式是 Solana 交易系統中的一種極速交易策略，通過**直接向當前 Leader 的 TPU 端口發送交易**，繞過傳統的 RPC 路由，實現毫秒級交易確認。

### 交易傳播路徑對比

```
┌─────────────────────────────────────────────────────────────────────┐
│                        傳統路徑 (慢)                                 │
├─────────────────────────────────────────────────────────────────────┤
│  機器人 → RPC(HTTP) → Gossip廣播 → 多節點轉發 → Leader              │
│  延遲: 200-500ms                                                    │
│  問題: 經過多次網絡跳轉，容易被 MEV 機器人夾擊                        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        狙擊路徑 (快)                                 │
├─────────────────────────────────────────────────────────────────────┤
│  機器人 → Leader TPU(UDP) → 直接打包                                │
│  延遲: 10-50ms                                                      │
│  優勢: 最少網絡跳轉，直接進入 Leader 交易池                           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      Jito 路徑 (最快+安全)                           │
├─────────────────────────────────────────────────────────────────────┤
│  機器人 → Jito Block Engine → Jito Validator                        │
│  延遲: 10-30ms                                                      │
│  優勢: 原子性執行 + 防夾子 + 失敗不付費                               │
└─────────────────────────────────────────────────────────────────────┘
```

### 核心目標

1. **計算當前 Leader 的 IP 地址**
2. **計算 Leader 的 TPU 端口**
3. **直接通過 UDP 發送交易到 Leader**

---

## Solana 共識機制基礎

### 2.1 驗證者節點架構

```
┌────────────────────────────────────────────────────────────────────┐
│                      Solana 驗證者節點架構                           │
└────────────────────────────────────────────────────────────────────┘

                        ┌─────────────────┐
                        │   RPC Service   │ ← HTTP/HTTPS (端口 8899)
                        │   (查詢服務)     │
                        └────────┬────────┘
                                 │
┌────────────────────────────────┼────────────────────────────────────┐
│                                │                                    │
│  ┌──────────────┐    ┌────────▼────────┐    ┌──────────────┐      │
│  │ Gossip Layer │◄───│  Banking Stage   │───►│  TPU         │      │
│  │ (Gossip 協議) │    │  (交易處理)       │    │ (交易處理單元)│      │
│  └──────────────┘    └─────────────────┘    └──────────────┘      │
│         │                                          │               │
│         │                                          │               │
│         ▼                                          ▼               │
│  ┌──────────────┐                         ┌──────────────┐        │
│  │  TPU Quic    │                         │  TPU Forward │        │
│  │  (QUIC 協議)  │                         │  (轉發服務)    │        │
│  └──────────────┘                         └──────────────┘        │
│                                                                    │
│                        ┌─────────────────┐                         │
│                        │   TVU (電視)    │ ← 區塊傳播              │
│                        └─────────────────┘                         │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

關鍵端口說明:
┌────────────────┬──────────────┬────────────────────────────────────┐
│ 端口名稱        │ 預設端口      │ 用途                                │
├────────────────┼──────────────┼────────────────────────────────────┤
│ RPC            │ 8899         │ HTTP RPC 查詢                      │
│ RPC WebSocket  │ 8900         │ WebSocket 訂閱                     │
│ Gossip         │ 8001         │ 節點發現和集群協調                  │
│ TPU            │ 動態計算      │ 接收交易 (核心!)                    │
│ TPU Quic       │ 動態計算+1    │ QUIC 協議交易接收                  │
│ TPU Forward    │ 動態計算+2    │ 轉發交易到下一個 Leader            │
│ TVU            │ 動態計算+3    │ 區塊傳播                           │
│ Repair         │ 動態計算+4   │ 數據修復                           │
└────────────────┴──────────────┴────────────────────────────────────┘
```

### 2.2 Leader 調度週期

```
┌────────────────────────────────────────────────────────────────────┐
│                      Solana Leader 調度週期                         │
└────────────────────────────────────────────────────────────────────┘

Epoch (紀元) ≈ 2-3 天
    │
    ├── 包含約 432,000 個 Slot
    │
    └── 每個 Slot = 400ms
        │
        ├── 每個 Slot 有一個指定的 Leader
        │
        └── Leader Schedule 在 Epoch 開始前就已確定

時間線:
┌─────────────────────────────────────────────────────────────────────┐
│ Epoch N-1          │ Epoch N            │ Epoch N+1               │
├────────────────────┼────────────────────┼─────────────────────────┤
│ ...Leader A...     │ ...Leader B...     │ ...Leader C...           │
│     Slot 100       │     Slot 200       │     Slot 300             │
│     (400ms)        │     (400ms)        │     (400ms)              │
└────────────────────┴────────────────────┴─────────────────────────┘

關鍵點:
1. Leader Schedule 是確定性的，可以提前計算
2. 當前 Epoch 的 Leader Schedule 在 Epoch 開始時就已經確定
3. 下一個 Epoch 的 Leader Schedule 在當前 Epoch 中期確定
```

---

## Leader 調度原理

### 3.1 Leader Schedule 計算公式

```typescript
/**
 * Leader Schedule 計算原理
 *
 * Solana 使用確定性算法計算每個 Slot 的 Leader
 * 公式: leader_slot = slot % leader_schedule.num_slots
 */

interface LeaderSchedule {
  // 每個 Epoch 的 Slot 數量
  slotsPerEpoch: number;  // ≈ 432,000

  // Leader 排序表
  leaderSchedule: Uint8Array;  // 按順序排列的 Leader 索引

  // 驗證者列表
  validators: ValidatorInfo[];
}

interface ValidatorInfo {
  pubkey: string;           // 驗證者公鑰
  votePubkey: string;       // 投票賬戶公鑰
  stake: number;            // 質押權重
  identityPubkey: string;   // 身份公鑰
}
```

### 3.2 獲取 Leader Schedule 的方法

```typescript
/**
 * 方法一: 通過 RPC 獲取
 */
async function getLeaderScheduleViaRPC(
  connection: Connection,
  epoch?: number
): Promise<LeaderSchedule> {
  // 獲取指定 Epoch 的 Leader Schedule
  const schedule = await connection.getLeaderSchedule(epoch);

  // schedule 格式: { validatorPubkey: [slot1, slot2, ...], ... }
  return schedule;
}

/**
 * 方法二: 通過 Gossip 協議獲取
 */
async function getLeaderScheduleViaGossip(
  gossipClient: GossipClient
): Promise<LeaderSchedule> {
  // 從 Gossip 網絡獲取集群信息
  const clusterNodes = await gossipClient.getClusterNodes();

  // 解析 Leader Schedule
  return parseLeaderSchedule(clusterNodes);
}
```

### 3.3 計算當前 Slot 的 Leader

```typescript
/**
 * 計算當前 Slot 的 Leader
 */
async function getCurrentLeader(
  connection: Connection
): Promise<string> {
  // 1. 獲取當前 Slot
  const currentSlot = await connection.getSlot();

  // 2. 獲取當前 Epoch
  const epochInfo = await connection.getEpochInfo();
  const currentEpoch = epochInfo.epoch;

  // 3. 獲取 Leader Schedule
  const schedule = await connection.getLeaderSchedule(currentEpoch);

  // 4. 找到當前 Slot 對應的 Leader
  const slotIndex = currentSlot % Object.values(schedule)[0].length;

  for (const [validator, slots] of Object.entries(schedule)) {
    if (slots.includes(slotIndex)) {
      return validator;
    }
  }

  throw new Error("Leader not found");
}
```

---

## Leader IP 地址計算

### 4.1 驗證者身份解析流程

```
┌────────────────────────────────────────────────────────────────────┐
│                    Leader IP 地址計算流程                           │
└────────────────────────────────────────────────────────────────────┘

步驟 1: 獲取當前 Slot
         │
         ▼
步驟 2: 獲取 Leader Schedule
         │
         ▼
步驟 3: 找到當前 Slot 的 Leader (Validator Vote Pubkey)
         │
         ▼
步驟 4: 通過 Vote Pubkey 獲取 Identity Pubkey
         │
         ▼
步驟 5: 通過 Gossip 協議獲取 Identity 的網絡信息
         │
         ▼
步驟 6: 解析出 IP 地址和端口
```

### 4.2 詳細實現代碼

```typescript
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Leader 信息結構
 */
interface LeaderInfo {
  identityPubkey: string;    // 驗證者身份公鑰
  votePubkey: string;        // 投票賬戶公鑰
  ip: string;                // IP 地址
  tpu: number;               // TPU 端口
  tpuQuic: number;           // TPU QUIC 端口
  gossip: number;            // Gossip 端口
}

/**
 * 步驟 1: 獲取當前 Slot 和 Epoch 信息
 */
async function getCurrentSlotInfo(connection: Connection): Promise<{
  slot: number;
  epoch: number;
  slotIndex: number;
}> {
  const epochInfo = await connection.getEpochInfo();

  return {
    slot: epochInfo.absoluteSlot,
    epoch: epochInfo.epoch,
    slotIndex: epochInfo.slotIndex
  };
}

/**
 * 步驟 2: 獲取 Leader Schedule
 */
async function getLeaderSchedule(
  connection: Connection,
  epoch: number
): Promise<{ [key: string]: number[] }> {
  // 使用 'processed' 承諾級別獲取最新數據
  const schedule = await connection.getLeaderSchedule(epoch, {
    commitment: 'processed'
  });

  if (!schedule) {
    throw new Error(`Failed to get leader schedule for epoch ${epoch}`);
  }

  return schedule;
}

/**
 * 步驟 3: 找到當前 Slot 的 Leader
 */
function findLeaderForSlot(
  schedule: { [key: string]: number[] },
  slotIndex: number
): string | null {
  for (const [validatorPubkey, slots] of Object.entries(schedule)) {
    if (slots.includes(slotIndex)) {
      return validatorPubkey;
    }
  }
  return null;
}

/**
 * 步驟 4: 獲取驗證者完整信息
 *
 * 通過 RPC 的 getClusterNodes 方法獲取所有驗證者的網絡信息
 */
async function getClusterNodes(connection: Connection): Promise<ClusterNode[]> {
  const nodes = await connection.getClusterNodes();
  return nodes;
}

interface ClusterNode {
  pubkey: string;      // 驗證者公鑰 (Gossip ID)
  gossip: string;     // Gossip 地址 (ip:port)
  tpu: string;        // TPU 地址 (ip:port)
  tpuQuic: string;    // TPU QUIC 地址 (ip:port)
  rpc: string | null; // RPC 地址 (可選)
  version: string;    // 節點版本
}

/**
 * 步驟 5: 匹配 Leader 和節點信息
 *
 * 關鍵點: Leader Schedule 返回的是 Vote Pubkey
 *         而 getClusterNodes 返回的是 Identity Pubkey
 *         需要通過 Vote Accounts 進行映射
 */
async function getLeaderIdentity(
  connection: Connection,
  votePubkey: string
): Promise<string> {
  // 獲取所有投票賬戶
  const voteAccounts = await connection.getVoteAccounts();

  // 在當前驗證者中查找
  const currentValidator = voteAccounts.current.find(
    v => v.votePubkey === votePubkey
  );

  if (currentValidator) {
    return currentValidator.nodePubkey;  // Identity Pubkey
  }

  // 在待激活驗證者中查找
  const delinquentValidator = voteAccounts.delinquent.find(
    v => v.votePubkey === votePubkey
  );

  if (delinquentValidator) {
    return delinquentValidator.nodePubkey;
  }

  throw new Error(`Identity not found for vote pubkey: ${votePubkey}`);
}

/**
 * 步驟 6: 解析 IP 和端口
 */
function parseAddress(address: string): { ip: string; port: number } {
  // 地址格式: "ip:port" 或 "[ipv6]:port"
  const lastColonIndex = address.lastIndexOf(':');

  if (lastColonIndex === -1) {
    throw new Error(`Invalid address format: ${address}`);
  }

  const ip = address.substring(0, lastColonIndex);
  const port = parseInt(address.substring(lastColonIndex + 1), 10);

  // 處理 IPv6 格式
  const cleanIp = ip.replace(/^\[|\]$/g, '');

  return { ip: cleanIp, port };
}

/**
 * 完整流程: 獲取當前 Leader 的完整信息
 */
async function getCurrentLeaderInfo(connection: Connection): Promise<LeaderInfo> {
  console.log("=== 開始獲取 Leader 信息 ===");

  // 1. 獲取當前 Slot 信息
  console.log("步驟 1: 獲取當前 Slot 信息...");
  const slotInfo = await getCurrentSlotInfo(connection);
  console.log(`  當前 Slot: ${slotInfo.slot}`);
  console.log(`  當前 Epoch: ${slotInfo.epoch}`);
  console.log(`  Slot Index: ${slotInfo.slotIndex}`);

  // 2. 獲取 Leader Schedule
  console.log("步驟 2: 獲取 Leader Schedule...");
  const schedule = await getLeaderSchedule(connection, slotInfo.epoch);
  console.log(`  獲取到 ${Object.keys(schedule).length} 個驗證者的調度信息`);

  // 3. 找到當前 Slot 的 Leader (Vote Pubkey)
  console.log("步驟 3: 查找當前 Slot 的 Leader...");
  const leaderVotePubkey = findLeaderForSlot(schedule, slotInfo.slotIndex);

  if (!leaderVotePubkey) {
    throw new Error("Leader not found for current slot");
  }
  console.log(`  Leader Vote Pubkey: ${leaderVotePubkey}`);

  // 4. 獲取 Identity Pubkey
  console.log("步驟 4: 獲取 Identity Pubkey...");
  const identityPubkey = await getLeaderIdentity(connection, leaderVotePubkey);
  console.log(`  Identity Pubkey: ${identityPubkey}`);

  // 5. 獲取集群節點信息
  console.log("步驟 5: 獲取集群節點信息...");
  const clusterNodes = await getClusterNodes(connection);
  console.log(`  獲取到 ${clusterNodes.length} 個節點信息`);

  // 6. 匹配節點信息
  console.log("步驟 6: 匹配 Leader 節點信息...");
  const leaderNode = clusterNodes.find(node => node.pubkey === identityPubkey);

  if (!leaderNode) {
    throw new Error(`Node info not found for identity: ${identityPubkey}`);
  }

  // 7. 解析地址
  console.log("步驟 7: 解析網絡地址...");
  const tpuAddr = parseAddress(leaderNode.tpu);
  const tpuQuicAddr = parseAddress(leaderNode.tpuQuic);
  const gossipAddr = parseAddress(leaderNode.gossip);

  const leaderInfo: LeaderInfo = {
    identityPubkey: identityPubkey,
    votePubkey: leaderVotePubkey,
    ip: tpuAddr.ip,
    tpu: tpuAddr.port,
    tpuQuic: tpuQuicAddr.port,
    gossip: gossipAddr.port
  };

  console.log("=== Leader 信息獲取完成 ===");
  console.log(`  IP: ${leaderInfo.ip}`);
  console.log(`  TPU 端口: ${leaderInfo.tpu}`);
  console.log(`  TPU QUIC 端口: ${leaderInfo.tpuQuic}`);
  console.log(`  Gossip 端口: ${leaderInfo.gossip}`);

  return leaderInfo;
}
```

---

## Leader TPU 端口計算

### 5.1 端口偏移規則

```typescript
/**
 * Solana 端口偏移規則
 *
 * 所有端口都基於一個基礎端口計算
 * 不同服務使用不同的偏移量
 */

const PORT_OFFSETS = {
  GOSSIP: 0,
  TPU: 1,          // 核心! 交易接收端口
  TPU_QUIC: 2,
  TPU_FORWARD: 3,
  TVU: 4,
  TVU_QUIC: 5,
  REPAIR: 6,
  REPAIR_QUIC: 7,
  RPC: 8,
  RPC_WEBSOCKET: 9
};

/**
 * 根據已知端口計算其他端口
 */
function calculatePorts(knownPort: number, knownType: keyof typeof PORT_OFFSETS): {
  gossip: number;
  tpu: number;
  tpuQuic: number;
  tpuForward: number;
  tvu: number;
  tvuQuic: number;
  repair: number;
  repairQuic: number;
  rpc: number;
  rpcWebsocket: number;
} {
  // 計算基礎端口
  const knownOffset = PORT_OFFSETS[knownType];
  const basePort = knownPort - knownOffset;

  return {
    gossip: basePort + PORT_OFFSETS.GOSSIP,
    tpu: basePort + PORT_OFFSETS.TPU,
    tpuQuic: basePort + PORT_OFFSETS.TPU_QUIC,
    tpuForward: basePort + PORT_OFFSETS.TPU_FORWARD,
    tvu: basePort + PORT_OFFSETS.TVU,
    tvuQuic: basePort + PORT_OFFSETS.TVU_QUIC,
    repair: basePort + PORT_OFFSETS.REPAIR,
    repairQuic: basePort + PORT_OFFSETS.REPAIR_QUIC,
    rpc: basePort + PORT_OFFSETS.RPC,
    rpcWebsocket: basePort + PORT_OFFSETS.RPC_WEBSOCKET
  };
}

/**
 * 從 Gossip 端口計算 TPU 端口
 */
function calculateTpuFromGossip(gossipPort: number): number {
  return gossipPort + 1;  // TPU = Gossip + 1
}

/**
 * 從 TPU 端口計算其他端口
 */
function calculateAllPortsFromTpu(tpuPort: number): {
  gossip: number;
  tpu: number;
  tpuQuic: number;
  tpuForward: number;
  tvu: number;
} {
  return {
    gossip: tpuPort - 1,
    tpu: tpuPort,
    tpuQuic: tpuPort + 1,
    tpuForward: tpuPort + 2,
    tvu: tpuPort + 3
  };
}
```

---

## 完整代碼實現

### 6.1 項目結構

```
sniperBot/
├── src/
│   ├── core/
│   │   ├── leader-tracker.ts      # Leader 追蹤器
│   │   ├── tpu-sender.ts          # TPU 直接發送器
│   │   └── slot-monitor.ts        # Slot 監控器
│   ├── utils/
│   │   ├── connection.ts          # RPC 連接管理
│   │   ├── logger.ts              # 日誌工具
│   │   └── cache.ts               # 緩存管理
│   ├── config/
│   │   └── index.ts               # 配置管理
│   └── index.ts                   # 入口文件
├── package.json
├── tsconfig.json
└── .env
```

### 6.2 Leader 追蹤器實現

```typescript
// src/core/leader-tracker.ts

import { Connection } from "@solana/web3.js";
import { Logger } from "../utils/logger";
import { CacheManager } from "../utils/cache";

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
  expiresAt: number;  // 過期時間戳
}

export class LeaderTracker {
  private connection: Connection;
  private currentLeader: LeaderInfo | null = null;
  private updateInterval: NodeJS.Timeout | null = null;

  // 緩存配置
  private readonly CACHE_TTL = 1000 * 60 * 5;  // 5 分鐘緩存
  private readonly UPDATE_INTERVAL = 1000 * 10;  // 10 秒更新間隔

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * 啟動 Leader 追蹤
   */
  async start(): Promise<void> {
    logger.info("Starting Leader Tracker...");

    // 初始獲取
    await this.updateLeader();

    // 定時更新
    this.updateInterval = setInterval(async () => {
      try {
        await this.updateLeader();
      } catch (error) {
        logger.error("Failed to update leader", error);
      }
    }, this.UPDATE_INTERVAL);

    logger.info("Leader Tracker started");
  }

  /**
   * 停止 Leader 追蹤
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    logger.info("Leader Tracker stopped");
  }

  /**
   * 獲取當前 Leader 信息
   */
  getCurrentLeader(): LeaderInfo | null {
    // 檢查緩存是否過期
    if (this.currentLeader && Date.now() < this.currentLeader.expiresAt) {
      return this.currentLeader;
    }
    return null;
  }

  /**
   * 獲取當前 Leader (強制刷新)
   */
  async getCurrentLeaderFresh(): Promise<LeaderInfo> {
    await this.updateLeader();
    if (!this.currentLeader) {
      throw new Error("Failed to get current leader");
    }
    return this.currentLeader;
  }

  /**
   * 獲取接下來 N 個 Slot 的 Leader
   */
  async getNextLeaders(count: number): Promise<LeaderInfo[]> {
    const epochInfo = await this.connection.getEpochInfo();
    const schedule = await this.connection.getLeaderSchedule(epochInfo.epoch);

    if (!schedule) {
      throw new Error("Failed to get leader schedule");
    }

    // 構建完整的 Slot-Leader 映射
    const slotLeaderMap = this.buildSlotLeaderMap(schedule);

    const leaders: LeaderInfo[] = [];
    const clusterNodes = await this.connection.getClusterNodes();
    const voteAccounts = await this.connection.getVoteAccounts();

    for (let i = 0; i < count; i++) {
      const targetSlot = epochInfo.slotIndex + i;
      const leaderVotePubkey = slotLeaderMap.get(targetSlot);

      if (!leaderVotePubkey) continue;

      const validator = [...voteAccounts.current, ...voteAccounts.delinquent]
        .find(v => v.votePubkey === leaderVotePubkey);

      if (!validator) continue;

      const node = clusterNodes.find(n => n.pubkey === validator.nodePubkey);
      if (!node) continue;

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

    return leaders;
  }

  /**
   * 計算所有端口
   */
  private calculatePorts(gossipPort: number): LeaderInfo['ports'] {
    return {
      gossip: gossipPort,
      tpu: gossipPort + 1,
      tpuQuic: gossipPort + 2,
      tpuForward: gossipPort + 3,
      tvu: gossipPort + 4,
      tvuQuic: gossipPort + 5,
      repair: gossipPort + 6
    };
  }
}
```

---

## 性能優化策略

### 7.1 緩存策略

```typescript
/**
 * Leader 信息緩存策略
 *
 * 1. 緩存時間: 5 分鐘 (Leader Schedule 在 Epoch 內不變)
 * 2. 預取策略: 提前獲取下一個 Epoch 的 Leader Schedule
 * 3. 失效策略: Slot 變化時檢查是否需要更新
 */

interface CacheConfig {
  // Leader 信息緩存 TTL
  leaderCacheTTL: number;  // 預設 5 分鐘

  // 集群節點緩存 TTL
  clusterNodesCacheTTL: number;  // 預設 10 分鐘

  // 投票賬戶緩存 TTL
  voteAccountsCacheTTL: number;  // 預設 5 分鐘

  // 是否啟用預取
  enablePrefetch: boolean;

  // 預取提前量 (Slot 數)
  prefetchSlots: number;  // 預設 10
}
```

### 7.2 並行請求優化

```typescript
/**
 * 並行獲取所有需要的數據
 *
 * 關鍵優化: 使用 Promise.all 並行請求
 */
async function getLeaderInfoOptimized(connection: Connection): Promise<LeaderInfo> {
  // 並行請求所有數據
  const [epochInfo, clusterNodes, voteAccounts, schedule] = await Promise.all([
    connection.getEpochInfo({ commitment: 'processed' }),
    connection.getClusterNodes(),
    connection.getVoteAccounts(),
    connection.getLeaderSchedule(undefined, { commitment: 'processed' })
  ]);

  // 後續處理...
  // 這樣可以將 4 個串行請求 (約 200-400ms) 優化為 1 個並行請求 (約 50-100ms)
}
```

### 7.3 預測性發送

```typescript
/**
 * 預測性發送策略
 *
 * 在 Leader 切換前提前發送到下一個 Leader
 * 避免 Leader 切換時的延遲
 */
async function predictiveSend(
  transaction: VersionedTransaction,
  leaderTracker: LeaderTracker,
  tpuSender: TpuSender
): Promise<void> {
  // 獲取當前和下一個 Leader
  const currentLeader = leaderTracker.getCurrentLeader();
  const nextLeaders = await leaderTracker.getNextLeaders(2);

  // 計算當前 Slot 剩餘時間
  const slotRemainingMs = calculateSlotRemainingTime();

  // 如果剩餘時間小於 100ms，同時發送到當前和下一個 Leader
  if (slotRemainingMs < 100) {
    const leaders = [currentLeader, ...nextLeaders].filter(Boolean) as LeaderInfo[];
    await tpuSender.sendToMultipleLeaders(transaction, leaders);
  } else {
    // 只發送到當前 Leader
    if (currentLeader) {
      await tpuSender.sendTransaction(transaction, currentLeader);
    }
  }
}
```

---

## 部署與測試

### 8.1 環境要求

```yaml
# 系統要求
OS: Ubuntu 22.04 LTS 或 CentOS 8+
CPU: 8 核心以上
RAM: 16GB 以上
Network: 低延遲網絡 (建議 < 50ms 到 Solana 節點)

# 軟件要求
Node.js: 18.x LTS
TypeScript: 5.x
npm: 9.x 或 pnpm: 8.x

# 網絡要求
- 能夠訪問 Solana RPC 節點
- 能夠訪問 Solana Gossip 網絡 (可選)
- UDP 出站端口開放
```

### 8.2 配置文件

```typescript
// config/index.ts

import dotenv from "dotenv";
dotenv.config();

export const config = {
  // RPC 配置
  RPC_URL: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
  RPC_WS_URL: process.env.RPC_WS_URL || "wss://api.mainnet-beta.solana.com",

  // 錢包配置
  PRIVATE_KEY: process.env.PRIVATE_KEY || "",

  // 狙擊配置
  SNIPER: {
    // 是否啟用 TPU 直連
    USE_TPU_DIRECT: process.env.USE_TPU_DIRECT === "true",

    // 是否發送到多個 Leader
    SEND_TO_MULTIPLE_LEADERS: process.env.SEND_TO_MULTIPLE_LEADERS === "true",

    // 預發送 Leader 數量
    PRE_SEND_LEADER_COUNT: parseInt(process.env.PRE_SEND_LEADER_COUNT || "2"),

    // 超時時間 (ms)
    TIMEOUT: parseInt(process.env.TIMEOUT || "5000"),

    // 最大重試次數
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES || "3")
  },

  // 緩存配置
  CACHE: {
    LEADER_CACHE_TTL: parseInt(process.env.LEADER_CACHE_TTL || "300000"),  // 5 分鐘
    CLUSTER_NODES_CACHE_TTL: parseInt(process.env.CLUSTER_NODES_CACHE_TTL || "600000"),  // 10 分鐘
    VOTE_ACCOUNTS_CACHE_TTL: parseInt(process.env.VOTE_ACCOUNTS_CACHE_TTL || "300000")  // 5 分鐘
  },

  // 日誌配置
  LOG_LEVEL: process.env.LOG_LEVEL || "info"
};
```

---

## 總結

### 關鍵要點

1. **Leader IP 計算流程**:
   ```
   獲取當前 Slot → 獲取 Leader Schedule → 找到 Vote Pubkey
   → 通過 Vote Accounts 獲取 Identity Pubkey
   → 通過 getClusterNodes 獲取網絡信息
   → 解析 IP 和端口
   ```

2. **TPU 端口計算規則**:
   ```
   TPU = Gossip Port + 1
   TPU QUIC = Gossip Port + 2
   TPU Forward = Gossip Port + 3
   ```

3. **性能優化關鍵**:
   - 並行請求所有需要的數據
   - 緩存 Leader 信息 (5 分鐘 TTL)
   - 預測性發送到下一個 Leader
   - UDP 連接池復用

4. **最佳實踐**:
   - 使用 `processed` 承諾級別獲取最新數據
   - 同時發送到當前和下一個 Leader
   - 監控 Leader 切換時間點
   - 實現回退機制 (TPU → RPC)

### 參考資源

- [Solana 官方文檔 - Leader Schedule](https://docs.solana.com/cluster/leader-rotation)
- [Solana 官方文檔 - TPU](https://docs.solana.com/cluster/overview#transaction-processing-unit-tpu)
- [Jito Labs - MEV 和 Bundle](https://jito-labs.gitbook.io/mev/)
- [Solana Web3.js 文檔](https://solana-labs.github.io/solana-web3.js/)
