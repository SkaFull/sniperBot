[简体中文](./sniper-mode.md) | [English](./sniper-mode_EN.md) | [繁體中文](./sniper-mode_HK.md)

# Solana Sniper Mode (Ultra-fast Channel) Detailed Implementation Plan

## Table of Contents

1. [Overview](#overview)
2. [Solana Consensus Mechanism Basics](#solana-consensus-mechanism-basics)
3. [Leader Scheduling Principles](#leader-scheduling-principles)
4. [Leader IP Address Calculation](#leader-ip-address-calculation)
5. [Leader TPU Port Calculation](#leader-tpu-port-calculation)
6. [Complete Code Implementation](#complete-code-implementation)
7. [Performance Optimization Strategies](#performance-optimization-strategies)
8. [Deployment and Testing](#deployment-and-testing)

---

## Overview

### What is Sniper Mode?

Sniper mode is an ultra-fast trading strategy in Solana transaction systems that achieves millisecond-level transaction confirmation by **sending transactions directly to the current Leader's TPU port**, bypassing traditional RPC routing.

### Transaction Propagation Path Comparison

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Traditional Path (Slow)                       │
├─────────────────────────────────────────────────────────────────────┤
│  Bot → RPC(HTTP) → Gossip broadcast → Multi-node relay → Leader    │
│  Latency: 200-500ms                                                  │
│  Issue: Multiple network hops, vulnerable to MEV bot sandwich attacks│
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        Sniper Path (Fast)                            │
├─────────────────────────────────────────────────────────────────────┤
│  Bot → Leader TPU(UDP) → Direct packaging                           │
│  Latency: 10-50ms                                                    │
│  Advantage: Minimal network hops, directly enters Leader tx pool    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      Jito Path (Fastest + Secure)                    │
├─────────────────────────────────────────────────────────────────────┤
│  Bot → Jito Block Engine → Jito Validator                           │
│  Latency: 10-30ms                                                    │
│  Advantage: Atomic execution + Anti-sandwich + No pay on failure    │
└─────────────────────────────────────────────────────────────────────┘
```

### Core Objectives

1. **Calculate current Leader's IP address**
2. **Calculate Leader's TPU port**
3. **Send transactions directly to Leader via UDP**

---

## Solana Consensus Mechanism Basics

### 2.1 Validator Node Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                      Solana Validator Node Architecture            │
└────────────────────────────────────────────────────────────────────┘

                        ┌─────────────────┐
                        │   RPC Service   │ ← HTTP/HTTPS (Port 8899)
                        │  (Query Service)│
                        └────────┬────────┘
                                 │
┌────────────────────────────────┼────────────────────────────────────┐
│                                │                                    │
│  ┌──────────────┐    ┌────────▼────────┐    ┌──────────────┐      │
│  │ Gossip Layer │◄───│  Banking Stage   │───►│  TPU         │      │
│  │(Gossip Proto)│    │(Tx Processing)   │    │(Tx Proc Unit)│      │
│  └──────────────┘    └─────────────────┘    └──────────────┘      │
│         │                                          │               │
│         │                                          │               │
│         ▼                                          ▼               │
│  ┌──────────────┐                         ┌──────────────┐        │
│  │  TPU Quic    │                         │  TPU Forward │        │
│  │(QUIC Protocol)                         │(Forward Svc) │        │
│  └──────────────┘                         └──────────────┘        │
│                                                                    │
│                        ┌─────────────────┐                         │
│                        │   TVU (TV Unit) │ ← Block propagation     │
│                        └─────────────────┘                         │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

Key Port Descriptions:
┌────────────────┬──────────────┬────────────────────────────────────┐
│ Port Name      │ Default Port │ Purpose                            │
├────────────────┼──────────────┼────────────────────────────────────┤
│ RPC            │ 8899         │ HTTP RPC queries                   │
│ RPC WebSocket  │ 8900         │ WebSocket subscriptions            │
│ Gossip         │ 8001         │ Node discovery and cluster coord   │
│ TPU            │ Dynamic calc │ Receive transactions (Core!)       │
│ TPU Quic       │ Dynamic +1   │ QUIC protocol tx reception         │
│ TPU Forward    │ Dynamic +2   │ Forward txs to next Leader         │
│ TVU            │ Dynamic +3   │ Block propagation                  │
│ Repair         │ Dynamic +4   │ Data repair                        │
└────────────────┴──────────────┴────────────────────────────────────┘
```

### 2.2 Leader Scheduling Cycle

```
┌────────────────────────────────────────────────────────────────────┐
│                      Solana Leader Scheduling Cycle                 │
└────────────────────────────────────────────────────────────────────┘

Epoch ≈ 2-3 days
    │
    ├── Contains ~432,000 Slots
    │
    └── Each Slot = 400ms
        │
        ├── Each Slot has a designated Leader
        │
        └── Leader Schedule is determined before Epoch starts

Timeline:
┌─────────────────────────────────────────────────────────────────────┐
│ Epoch N-1          │ Epoch N            │ Epoch N+1               │
├────────────────────┼────────────────────┼─────────────────────────┤
│ ...Leader A...     │ ...Leader B...     │ ...Leader C...           │
│     Slot 100       │     Slot 200       │     Slot 300             │
│     (400ms)        │     (400ms)        │     (400ms)              │
└────────────────────┴────────────────────┴─────────────────────────┘

Key Points:
1. Leader Schedule is deterministic and can be calculated in advance
2. Current Epoch's Leader Schedule is determined at Epoch start
3. Next Epoch's Leader Schedule is determined mid-current Epoch
```

---

## Leader Scheduling Principles

### 3.1 Leader Schedule Calculation Formula

```typescript
/**
 * Leader Schedule Calculation Principles
 *
 * Solana uses a deterministic algorithm to calculate each Slot's Leader
 * Formula: leader_slot = slot % leader_schedule.num_slots
 */

interface LeaderSchedule {
  // Number of Slots per Epoch
  slotsPerEpoch: number;  // ≈ 432,000

  // Leader ordering table
  leaderSchedule: Uint8Array;  // Leader indices in order

  // Validator list
  validators: ValidatorInfo[];
}

interface ValidatorInfo {
  pubkey: string;           // Validator public key
  votePubkey: string;       // Vote account public key
  stake: number;            // Stake weight
  identityPubkey: string;   // Identity public key
}
```

### 3.2 Methods to Get Leader Schedule

```typescript
/**
 * Method 1: Get via RPC
 */
async function getLeaderScheduleViaRPC(
  connection: Connection,
  epoch?: number
): Promise<LeaderSchedule> {
  // Get Leader Schedule for specified Epoch
  const schedule = await connection.getLeaderSchedule(epoch);

  // schedule format: { validatorPubkey: [slot1, slot2, ...], ... }
  return schedule;
}

/**
 * Method 2: Get via Gossip Protocol
 */
async function getLeaderScheduleViaGossip(
  gossipClient: GossipClient
): Promise<LeaderSchedule> {
  // Get cluster info from Gossip network
  const clusterNodes = await gossipClient.getClusterNodes();

  // Parse Leader Schedule
  return parseLeaderSchedule(clusterNodes);
}
```

### 3.3 Calculate Current Slot's Leader

```typescript
/**
 * Calculate current Slot's Leader
 */
async function getCurrentLeader(
  connection: Connection
): Promise<string> {
  // 1. Get current Slot
  const currentSlot = await connection.getSlot();

  // 2. Get current Epoch
  const epochInfo = await connection.getEpochInfo();
  const currentEpoch = epochInfo.epoch;

  // 3. Get Leader Schedule
  const schedule = await connection.getLeaderSchedule(currentEpoch);

  // 4. Find Leader for current Slot
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

## Leader IP Address Calculation

### 4.1 Validator Identity Resolution Flow

```
┌────────────────────────────────────────────────────────────────────┐
│                    Leader IP Address Calculation Flow               │
└────────────────────────────────────────────────────────────────────┘

Step 1: Get current Slot
         │
         ▼
Step 2: Get Leader Schedule
         │
         ▼
Step 3: Find current Slot's Leader (Validator Vote Pubkey)
         │
         ▼
Step 4: Get Identity Pubkey via Vote Pubkey
         │
         ▼
Step 5: Get Identity's network info via Gossip protocol
         │
         ▼
Step 6: Parse IP address and port
```

### 4.2 Detailed Implementation Code

```typescript
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Leader Info Structure
 */
interface LeaderInfo {
  identityPubkey: string;    // Validator identity public key
  votePubkey: string;        // Vote account public key
  ip: string;                // IP address
  tpu: number;               // TPU port
  tpuQuic: number;           // TPU QUIC port
  gossip: number;            // Gossip port
}

/**
 * Step 1: Get current Slot and Epoch info
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
 * Step 2: Get Leader Schedule
 */
async function getLeaderSchedule(
  connection: Connection,
  epoch: number
): Promise<{ [key: string]: number[] }> {
  // Use 'processed' commitment level for latest data
  const schedule = await connection.getLeaderSchedule(epoch, {
    commitment: 'processed'
  });

  if (!schedule) {
    throw new Error(`Failed to get leader schedule for epoch ${epoch}`);
  }

  return schedule;
}

/**
 * Step 3: Find current Slot's Leader
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
 * Step 4: Get validator complete info
 *
 * Get all validators' network info via RPC getClusterNodes method
 */
async function getClusterNodes(connection: Connection): Promise<ClusterNode[]> {
  const nodes = await connection.getClusterNodes();
  return nodes;
}

interface ClusterNode {
  pubkey: string;      // Validator public key (Gossip ID)
  gossip: string;     // Gossip address (ip:port)
  tpu: string;        // TPU address (ip:port)
  tpuQuic: string;    // TPU QUIC address (ip:port)
  rpc: string | null; // RPC address (optional)
  version: string;    // Node version
}

/**
 * Step 5: Match Leader and node info
 *
 * Key point: Leader Schedule returns Vote Pubkey
 *            while getClusterNodes returns Identity Pubkey
 *            Need to map through Vote Accounts
 */
async function getLeaderIdentity(
  connection: Connection,
  votePubkey: string
): Promise<string> {
  // Get all vote accounts
  const voteAccounts = await connection.getVoteAccounts();

  // Find in current validators
  const currentValidator = voteAccounts.current.find(
    v => v.votePubkey === votePubkey
  );

  if (currentValidator) {
    return currentValidator.nodePubkey;  // Identity Pubkey
  }

  // Find in delinquent validators
  const delinquentValidator = voteAccounts.delinquent.find(
    v => v.votePubkey === votePubkey
  );

  if (delinquentValidator) {
    return delinquentValidator.nodePubkey;
  }

  throw new Error(`Identity not found for vote pubkey: ${votePubkey}`);
}

/**
 * Step 6: Parse IP and port
 */
function parseAddress(address: string): { ip: string; port: number } {
  // Address format: "ip:port" or "[ipv6]:port"
  const lastColonIndex = address.lastIndexOf(':');

  if (lastColonIndex === -1) {
    throw new Error(`Invalid address format: ${address}`);
  }

  const ip = address.substring(0, lastColonIndex);
  const port = parseInt(address.substring(lastColonIndex + 1), 10);

  // Handle IPv6 format
  const cleanIp = ip.replace(/^\[|\]$/g, '');

  return { ip: cleanIp, port };
}

/**
 * Complete flow: Get current Leader's complete info
 */
async function getCurrentLeaderInfo(connection: Connection): Promise<LeaderInfo> {
  console.log("=== Starting Leader Info Retrieval ===");

  // 1. Get current Slot info
  console.log("Step 1: Getting current Slot info...");
  const slotInfo = await getCurrentSlotInfo(connection);
  console.log(`  Current Slot: ${slotInfo.slot}`);
  console.log(`  Current Epoch: ${slotInfo.epoch}`);
  console.log(`  Slot Index: ${slotInfo.slotIndex}`);

  // 2. Get Leader Schedule
  console.log("Step 2: Getting Leader Schedule...");
  const schedule = await getLeaderSchedule(connection, slotInfo.epoch);
  console.log(`  Retrieved ${Object.keys(schedule).length} validators' schedule info`);

  // 3. Find current Slot's Leader (Vote Pubkey)
  console.log("Step 3: Finding current Slot's Leader...");
  const leaderVotePubkey = findLeaderForSlot(schedule, slotInfo.slotIndex);

  if (!leaderVotePubkey) {
    throw new Error("Leader not found for current slot");
  }
  console.log(`  Leader Vote Pubkey: ${leaderVotePubkey}`);

  // 4. Get Identity Pubkey
  console.log("Step 4: Getting Identity Pubkey...");
  const identityPubkey = await getLeaderIdentity(connection, leaderVotePubkey);
  console.log(`  Identity Pubkey: ${identityPubkey}`);

  // 5. Get cluster node info
  console.log("Step 5: Getting cluster node info...");
  const clusterNodes = await getClusterNodes(connection);
  console.log(`  Retrieved ${clusterNodes.length} node info`);

  // 6. Match node info
  console.log("Step 6: Matching Leader node info...");
  const leaderNode = clusterNodes.find(node => node.pubkey === identityPubkey);

  if (!leaderNode) {
    throw new Error(`Node info not found for identity: ${identityPubkey}`);
  }

  // 7. Parse addresses
  console.log("Step 7: Parsing network addresses...");
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

  console.log("=== Leader Info Retrieval Complete ===");
  console.log(`  IP: ${leaderInfo.ip}`);
  console.log(`  TPU Port: ${leaderInfo.tpu}`);
  console.log(`  TPU QUIC Port: ${leaderInfo.tpuQuic}`);
  console.log(`  Gossip Port: ${leaderInfo.gossip}`);

  return leaderInfo;
}
```

---

## Leader TPU Port Calculation

### 5.1 Port Offset Rules

```typescript
/**
 * Solana Port Offset Rules
 *
 * All ports are calculated based on a base port
 * Different services use different offsets
 */

const PORT_OFFSETS = {
  GOSSIP: 0,
  TPU: 1,          // Core! Transaction receiving port
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
 * Calculate all ports from known port
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
  // Calculate base port
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
 * Calculate TPU port from Gossip port
 */
function calculateTpuFromGossip(gossipPort: number): number {
  return gossipPort + 1;  // TPU = Gossip + 1
}

/**
 * Calculate all ports from TPU port
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

## Complete Code Implementation

### 6.1 Project Structure

```
sniperBot/
├── src/
│   ├── core/
│   │   ├── leader-tracker.ts      # Leader tracker
│   │   ├── tpu-sender.ts          # TPU direct sender
│   │   └── slot-monitor.ts        # Slot monitor
│   ├── utils/
│   │   ├── connection.ts          # RPC connection management
│   │   ├── logger.ts              # Logger utility
│   │   └── cache.ts               # Cache management
│   ├── config/
│   │   └── index.ts               # Configuration management
│   └── index.ts                   # Entry file
├── package.json
├── tsconfig.json
└── .env
```

### 6.2 Leader Tracker Implementation

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
  expiresAt: number;  // Expiration timestamp
}

export class LeaderTracker {
  private connection: Connection;
  private currentLeader: LeaderInfo | null = null;
  private updateInterval: NodeJS.Timeout | null = null;

  // Cache configuration
  private readonly CACHE_TTL = 1000 * 60 * 5;  // 5 minute cache
  private readonly UPDATE_INTERVAL = 1000 * 10;  // 10 second update interval

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Start Leader tracking
   */
  async start(): Promise<void> {
    logger.info("Starting Leader Tracker...");

    // Initial fetch
    await this.updateLeader();

    // Periodic updates
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
   * Stop Leader tracking
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    logger.info("Leader Tracker stopped");
  }

  /**
   * Get current Leader info
   */
  getCurrentLeader(): LeaderInfo | null {
    // Check if cache is expired
    if (this.currentLeader && Date.now() < this.currentLeader.expiresAt) {
      return this.currentLeader;
    }
    return null;
  }

  /**
   * Get current Leader (force refresh)
   */
  async getCurrentLeaderFresh(): Promise<LeaderInfo> {
    await this.updateLeader();
    if (!this.currentLeader) {
      throw new Error("Failed to get current leader");
    }
    return this.currentLeader;
  }

  /**
   * Get next N Slots' Leaders
   */
  async getNextLeaders(count: number): Promise<LeaderInfo[]> {
    const epochInfo = await this.connection.getEpochInfo();
    const schedule = await this.connection.getLeaderSchedule(epochInfo.epoch);

    if (!schedule) {
      throw new Error("Failed to get leader schedule");
    }

    // Build complete Slot-Leader mapping
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
   * Calculate all ports
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

## Performance Optimization Strategies

### 7.1 Caching Strategy

```typescript
/**
 * Leader info caching strategy
 *
 * 1. Cache duration: 5 minutes (Leader Schedule doesn't change within Epoch)
 * 2. Prefetch strategy: Fetch next Epoch's Leader Schedule in advance
 * 3. Invalidation strategy: Check if update needed when Slot changes
 */

interface CacheConfig {
  // Leader info cache TTL
  leaderCacheTTL: number;  // Default 5 minutes

  // Cluster nodes cache TTL
  clusterNodesCacheTTL: number;  // Default 10 minutes

  // Vote accounts cache TTL
  voteAccountsCacheTTL: number;  // Default 5 minutes

  // Enable prefetch
  enablePrefetch: boolean;

  // Prefetch advance (Slot count)
  prefetchSlots: number;  // Default 10
}
```

### 7.2 Parallel Request Optimization

```typescript
/**
 * Parallel fetch all required data
 *
 * Key optimization: Use Promise.all for parallel requests
 */
async function getLeaderInfoOptimized(connection: Connection): Promise<LeaderInfo> {
  // Parallel request all data
  const [epochInfo, clusterNodes, voteAccounts, schedule] = await Promise.all([
    connection.getEpochInfo({ commitment: 'processed' }),
    connection.getClusterNodes(),
    connection.getVoteAccounts(),
    connection.getLeaderSchedule(undefined, { commitment: 'processed' })
  ]);

  // Subsequent processing...
  // This optimizes 4 serial requests (~200-400ms) to 1 parallel request (~50-100ms)
}
```

### 7.3 Predictive Sending

```typescript
/**
 * Predictive sending strategy
 *
 * Send to next Leader before Leader switch
 * Avoid delay during Leader transition
 */
async function predictiveSend(
  transaction: VersionedTransaction,
  leaderTracker: LeaderTracker,
  tpuSender: TpuSender
): Promise<void> {
  // Get current and next Leader
  const currentLeader = leaderTracker.getCurrentLeader();
  const nextLeaders = await leaderTracker.getNextLeaders(2);

  // Calculate remaining time in current Slot
  const slotRemainingMs = calculateSlotRemainingTime();

  // If remaining time < 100ms, send to both current and next Leader
  if (slotRemainingMs < 100) {
    const leaders = [currentLeader, ...nextLeaders].filter(Boolean) as LeaderInfo[];
    await tpuSender.sendToMultipleLeaders(transaction, leaders);
  } else {
    // Only send to current Leader
    if (currentLeader) {
      await tpuSender.sendTransaction(transaction, currentLeader);
    }
  }
}
```

---

## Deployment and Testing

### 8.1 Environment Requirements

```yaml
# System Requirements
OS: Ubuntu 22.04 LTS or CentOS 8+
CPU: 8+ cores
RAM: 16GB+
Network: Low latency network (recommended < 50ms to Solana nodes)

# Software Requirements
Node.js: 18.x LTS
TypeScript: 5.x
npm: 9.x or pnpm: 8.x

# Network Requirements
- Access to Solana RPC nodes
- Access to Solana Gossip network (optional)
- UDP outbound ports open
```

### 8.2 Configuration File

```typescript
// config/index.ts

import dotenv from "dotenv";
dotenv.config();

export const config = {
  // RPC Configuration
  RPC_URL: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
  RPC_WS_URL: process.env.RPC_WS_URL || "wss://api.mainnet-beta.solana.com",

  // Wallet Configuration
  PRIVATE_KEY: process.env.PRIVATE_KEY || "",

  // Sniper Configuration
  SNIPER: {
    // Enable TPU direct connection
    USE_TPU_DIRECT: process.env.USE_TPU_DIRECT === "true",

    // Send to multiple Leaders
    SEND_TO_MULTIPLE_LEADERS: process.env.SEND_TO_MULTIPLE_LEADERS === "true",

    // Pre-send Leader count
    PRE_SEND_LEADER_COUNT: parseInt(process.env.PRE_SEND_LEADER_COUNT || "2"),

    // Timeout (ms)
    TIMEOUT: parseInt(process.env.TIMEOUT || "5000"),

    // Max retries
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES || "3")
  },

  // Cache Configuration
  CACHE: {
    LEADER_CACHE_TTL: parseInt(process.env.LEADER_CACHE_TTL || "300000"),  // 5 minutes
    CLUSTER_NODES_CACHE_TTL: parseInt(process.env.CLUSTER_NODES_CACHE_TTL || "600000"),  // 10 minutes
    VOTE_ACCOUNTS_CACHE_TTL: parseInt(process.env.VOTE_ACCOUNTS_CACHE_TTL || "300000")  // 5 minutes
  },

  // Log Configuration
  LOG_LEVEL: process.env.LOG_LEVEL || "info"
};
```

---

## Summary

### Key Points

1. **Leader IP Calculation Flow**:
   ```
   Get current Slot → Get Leader Schedule → Find Vote Pubkey
   → Get Identity Pubkey via Vote Accounts
   → Get network info via getClusterNodes
   → Parse IP and port
   ```

2. **TPU Port Calculation Rules**:
   ```
   TPU = Gossip Port + 1
   TPU QUIC = Gossip Port + 2
   TPU Forward = Gossip Port + 3
   ```

3. **Performance Optimization Keys**:
   - Parallel request all required data
   - Cache Leader info (5 minute TTL)
   - Predictive send to next Leader
   - UDP connection pool reuse

4. **Best Practices**:
   - Use `processed` commitment level for latest data
   - Send to both current and next Leader simultaneously
   - Monitor Leader switch timing
   - Implement fallback mechanism (TPU → RPC)

### Reference Resources

- [Solana Official Docs - Leader Schedule](https://docs.solana.com/cluster/leader-rotation)
- [Solana Official Docs - TPU](https://docs.solana.com/cluster/overview#transaction-processing-unit-tpu)
- [Jito Labs - MEV and Bundle](https://jito-labs.gitbook.io/mev/)
- [Solana Web3.js Documentation](https://solana-labs.github.io/solana-web3.js/)
