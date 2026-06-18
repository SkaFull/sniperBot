[简体中文](./architecture.md) | [English](./architecture_EN.md) | [繁體中文](./architecture_HK.md)

# Solana Sniper Bot Complete Architecture

## Table of Contents

1. [Project Overview](#project-overview)
2. [System Architecture Design](#system-architecture-design)
3. [Core Module Design](#core-module-design)
4. [Technology Stack Selection](#technology-stack-selection)
5. [Deployment Plan](#deployment-plan)
6. [Security Strategy](#security-strategy)
7. [Performance Optimization](#performance-optimization)
8. [Risk Control](#risk-control)
9. [Monitoring and Operations](#monitoring-and-operations)
10. [Development Plan](#development-plan)

***

## Project Overview

### 1.1 Project Background

The Solana Sniper Bot is a high-performance automated trading system specifically designed to capture new token issuance opportunities on the Solana blockchain. On high-performance blockchains like Solana, manual trading is almost impossible to profit from because:

- **Speed Gap**: Human operations take 5-15 seconds, while bots only need 10-200 milliseconds
- **Intense Competition**: Top quantitative teams, hackers, and scammers worldwide are all competing
- **High Risk**: 99% of new tokens eventually go to zero, requiring strict risk control systems

### 1.2 Project Goals

- **Ultra-fast Response**: Complete purchases within the same block when liquidity is added (millisecond level)
- **Security Protection**: Automatically identify and avoid honeypots, Rug Pull, and other scams
- **Smart Selling**: Automated take-profit and stop-loss strategies to maximize returns
- **Stable Operation**: 24/7 monitoring with high availability architecture

### 1.3 Core Features

1. **Real-time Monitoring**: Listen for liquidity addition events on Pump.fun, Raydium, Meteora, and other platforms
2. **Security Audit**: Automatically detect token Mint Authority, Freeze Authority, LP lock status, etc.
3. **Transaction Building**: Build atomic transactions with priority fees and Jito Bundles
4. **Smart Selling**: Support multiple strategies including hard take-profit/stop-loss, trailing stop, time stop
5. **Position Management**: Automated position allocation and fund consolidation

***

## System Architecture Design

### 2.1 Overall Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Sniper Bot System Architecture           │
└─────────────────────────────────────────────────────────────┘

┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Config Module│      │Monitor Module│      │Security Module│
│  (Config)    │──────│  (Monitor)   │──────│  (Security)  │
└──────────────┘      └──────────────┘      └──────────────┘
       │                     │                     │
       │                     │                     │
       └─────────────────────┼─────────────────────┘
                             │
                    ┌────────▼────────┐
                    │ Executor Module │
                    │  (Executor)     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Seller Module  │
                    │   (Seller)      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Data Module   │
                    │   (Data)        │
                    └─────────────────┘
```

### 2.2 Module Responsibility Division

#### 2.2.1 Config Module

**Responsibility**: Manage system configuration and environment loading

**Core Functions**:

- RPC connection initialization
- Wallet key loading
- Jito authentication configuration
- Strategy parameter configuration
- Environment variable management

**Key Configuration Items**:

```javascript
{
  // RPC Configuration
  RPC_URL: "https://api.mainnet-beta.solana.com",
  RPC_ENDPOINT: "wss://api.mainnet-beta.solana.com",

  // Wallet Configuration
  PRIVATE_KEY: "xxx",
  JITO_AUTH_KEY: "xxx",

  // Strategy Configuration
  BUY_AMOUNT: 0.1,          // Buy amount per transaction (SOL)
  JITO_TIP: 0.001,          // Jito tip (SOL)
  TAKE_PROFIT: 2.0,         // Take profit multiplier
  STOP_LOSS: 0.5,           // Stop loss ratio
  TRAILING_STOP: 0.2,       // Trailing stop drawdown ratio

  // Security Configuration
  MAX_TOP10_HOLDERS: 30,    // Top 10 holders percentage limit
  MIN_LP_LOCKED: 95,        // Minimum LP lock ratio

  // Performance Configuration
  COMPUTE_UNIT_LIMIT: 80000,
  COMPUTE_UNIT_PRICE: 150000
}
```

#### 2.2.2 Monitor Module

**Responsibility**: Real-time monitoring of on-chain events, discovering trading opportunities

**Core Functions**:

- WebSocket connection management
- On-chain log monitoring
- Event filtering and parsing
- Signal triggering and distribution

**Monitoring Targets**:

1. **Pump.fun**: Monitor `Create` instruction (Program ID: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`)
2. **Raydium**: Monitor `initialize2` instruction (Program ID: `675kPX9M1NAe2gk7kh2nar73UyTP8yA202tenuLF5784`)
3. **Meteora DAMM v2**: Monitor liquidity pool creation events
4. **Meteora DBC**: Monitor dynamic bonding curve creation events

**Technical Implementation**:

```javascript
// WebSocket Monitoring
connection.onLogs(
  PROGRAM_ID,
  ({ logs, err, signature }) => {
    if (err) return;

    // Filter target instructions
    const isTarget = logs.some(log => log.includes("initialize2"));

    if (isTarget) {
      // Parse transaction to get Token Mint address
      this.emit("signal", signature);
    }
  },
  "processed" // Use fastest commitment level
);
```

#### 2.2.3 Security Module

**Responsibility**: Token security audit, filter risky tokens

**Core Functions**:

- Mint Authority check
- Freeze Authority check
- LP lock status check
- Token distribution analysis
- Transaction simulation verification

**Security Scorecard**:

| Check Item        | Security Standard | Risk Level                  |
| ----------------- | ----------------- | --------------------------- |
| Mint Authority    | null              | 🔴 High Risk (not revoked)  |
| Freeze Authority  | null              | 🔴 High Risk (honeypot)     |
| LP Lock           | >95% burned       | 🟠 Medium Risk (can rug)    |
| Top 10 Holders    | <30%              | 🟠 Medium Risk (insider)    |
| Transaction Sim   | Success           | 🔴 High Risk (honeypot)     |

**Code Implementation**:

```javascript
async function checkTokenSecurity(connection, mintAddress) {
  const mintInfo = await getMint(connection, mintAddress);

  // Check Mint Authority
  if (mintInfo.mintAuthority !== null) {
    return { safe: false, reason: "Mint authority not revoked" };
  }

  // Check Freeze Authority
  if (mintInfo.freezeAuthority !== null) {
    return { safe: false, reason: "Freeze authority exists (honeypot)" };
  }

  // Check LP lock status
  const lpLocked = await checkLPLocked(mintAddress);
  if (lpLocked < 95) {
    return { safe: false, reason: "LP not locked" };
  }

  // Check token distribution
  const top10Holders = await getTop10Holders(mintAddress);
  if (top10Holders > 30) {
    return { safe: false, reason: "High token concentration" };
  }

  // Transaction simulation
  const simulation = await simulateTransaction(mintAddress);
  if (simulation.err) {
    return { safe: false, reason: "Transaction simulation failed" };
  }

  return { safe: true };
}
```

#### 2.2.4 Executor Module

**Responsibility**: Build and send transactions, complete buy operations

**Core Functions**:

- Compute budget settings
- Swap instruction building
- Jito Bundle packaging
- Transaction signing and sending
- Failure retry mechanism

**Transaction Building Flow**:

```
1. Get latest Blockhash
2. Set Compute Unit Limit
3. Set Compute Unit Price
4. Build Swap instruction
5. Build Jito Tip instruction
6. Package into Versioned Transaction (v0)
7. Sign transaction
8. Send to Jito Block Engine
```

**Jito Bundle Advantages**:

- **Atomicity**: Buy and tip either all succeed or all fail
- **Anti-sandwich**: Sent through private channel, MEV bots cannot see
- **No pay on failure**: When buy fails, tip is not deducted

**Code Implementation**:

```javascript
async function buildAndSendBundle(tokenMint) {
  // 1. Get Blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  // 2. Build instructions
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 80000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 }),
    await createSwapInstruction(tokenMint),
    createJitoTipInstruction()
  ];

  // 3. Package transaction
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([wallet]);

  // 4. Send Bundle
  const bundleId = await jitoClient.sendBundle([transaction]);

  return bundleId;
}
```

#### 2.2.5 Seller Module

**Responsibility**: Automated sell strategy execution

**Core Functions**:

- Price monitoring
- Take-profit/stop-loss judgment
- Sell transaction building
- Position management

**Sell Strategies**:

1. **Hard Take-profit/Stop-loss**:
   - Take-profit: Gain reaches +100% → Sell 50%
   - Stop-loss: Loss reaches -30% → Sell all
2. **Trailing Stop**:
   - Retrace 20% from all-time high → Sell
   - Can capture most of the gains
3. **Time Stop**:
   - No more than 20% gain within 10 minutes after purchase → Sell
   - Improve capital utilization

**Price Monitoring Implementation**:

```javascript
// Method 1: Monitor pool reserves
connection.onAccountChange(POOL_ADDRESS, (accountInfo) => {
  const data = LAYOUT.decode(accountInfo.data);
  const price = data.baseReserve / data.quoteReserve;
  checkStrategy(price);
});

// Method 2: Simulate sell
async function getCurrentPrice(tokenMint) {
  const simulation = await connection.simulateTransaction(sellTx);
  return simulation.value.returnData;
}
```

#### 2.2.6 Data Module

**Responsibility**: Data storage and querying

**Core Functions**:

- Transaction history recording
- Position data management
- Performance statistics analysis
- Cache management

***

## Core Module Design

### 3.1 Transaction Lifecycle Management

#### 3.1.1 Solana Node Roles

```
┌──────────────┐
│  RPC Node    │ ← Receive requests, forward transactions
│  (Reception) │
└──────┬───────┘
       │
       │ Gossip Protocol
       │
┌──────▼───────┐
│ Validator    │ ← Verify transactions, vote for confirmation
│  (Accountant)│
└──────┬───────┘
       │
       │ Leader Schedule
       │
┌──────▼───────┐
│   Leader     │ ← Package blocks (400ms time slot)
│  (On-duty)   │
└──────────────┘
```

#### 3.1.2 Transaction Propagation Paths

**Traditional Path (Slow)**:

```
Bot → RPC(HTTP) → Gossip broadcast → Leader
Latency: 200-500ms
```

**Sniper Path (Fast)**:

```
Bot → Leader TPU(UDP) → Direct packaging
Latency: 10-50ms
```

**Jito Path (Fastest + Secure)**:

```
Bot → Jito Block Engine → Jito Validator
Latency: 10-30ms + Anti-sandwich
```

### 3.2 Priority Fee Strategy

#### 3.2.1 Fee Calculation Formula

```
Total Fee = Base Fee(5000) + Priority Fee
Priority Fee = Compute Unit Limit × Compute Unit Price
```

#### 3.2.2 Dynamic Fee Strategy

```javascript
async function calculatePriorityFee() {
  // 1. Simulate transaction to get exact CU consumption
  const simulation = await connection.simulateTransaction(tx);
  const cuConsumed = simulation.value.unitsConsumed;

  // 2. Set CU Limit (with margin)
  const cuLimit = cuConsumed * 1.2;

  // 3. Query network median
  const fees = await connection.getRecentPrioritizationFees();
  const medianFee = calculateMedian(fees);

  // 4. Price markup strategy
  const price = medianFee * 2;

  return { cuLimit, price };
}
```

### 3.3 WebSocket Monitoring Optimization

#### 3.3.1 Commitment Level Selection

| Commitment Level | Latency   | Reliability         | Use Case          |
| ---------------- | --------- | ------------------- | ----------------- |
| processed        | ~0ms      | Low (may fork)      | **Sniper must**   |
| confirmed        | 400-800ms | Medium              | Regular transfers |
| finalized        | 1-2s      | High                | Important txs     |

#### 3.3.2 Double-hop Problem Solution

**Problem**: WebSocket logs don't include Token Mint address

**Slow Solution**:

```
WebSocket push → HTTP getTransaction → Parse Mint
Latency: 200ms+
```

**Ultra-fast Solution (Geyser gRPC)**:

```
gRPC Stream → Directly includes AccountKeys → Local parsing
Latency: 0ms
```

**Geyser Code Example**:

```javascript
import Client from "@triton-one/yellowstone-grpc";

const client = new Client("grpc-endpoint", "auth-token");
const stream = await client.subscribe();

stream.write({
  transactions: {
    pumpFunFilter: {
      accountInclude: ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"]
    }
  }
});

stream.on("data", (data) => {
  if (data.transaction) {
    // Directly get all account addresses
    const accountKeys = data.transaction.transaction.message.accountKeys;
    const mintAddress = accountKeys[1]; // No second request needed
    triggerBuy(mintAddress);
  }
});
```

### 3.4 Jito Bundle Implementation

#### 3.4.1 Bundle Atomicity

```
Bundle = [Buy transaction, Tip transaction]

Rules:
- All succeed → On-chain
- All fail → Not on-chain
- Never partial success
```

#### 3.4.2 Jito Tip Accounts

```javascript
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4bVmkdzGTT4RCgLvtBPvuGZ",
  "Cw8CFyM9FkoPhlbnF5k2E9g2oKjv7q2f8e9x2k5R2i4"
];

// Random selection to avoid hotspots
const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * 3)];
```

***

## Technology Stack Selection

### 4.1 Core Technology Stack

| Category            | Technology           | Version | Description                |
| ------------------- | -------------------- | ------- | -------------------------- |
| **Runtime**         | Node.js              | 18+     | High-performance async     |
| **Blockchain SDK**  | @solana/web3.js      | 2.0+    | Official Solana SDK        |
| **Token Operations**| @solana/spl-token    | 0.4+    | SPL Token operations       |
| **Jito SDK**        | jito-ts              | latest  | Jito Bundle support        |
| **Geyser Client**   | yellowstone-grpc     | latest  | Ultra-fast data stream     |
| **Serialization**   | borsh                | latest  | Borsh serialization        |
| **Encryption**      | bs58                 | latest  | Base58 encoding/decoding   |
| **Environment**     | dotenv               | latest  | Environment variables      |

### 4.2 Data Storage

| Category    | Technology  | Description                  |
| ----------- | ----------- | ---------------------------- |
| **Database**| PostgreSQL  | Transaction history, positions|
| **Cache**   | Redis       | Real-time prices, config cache|
| **Logging** | Winston     | Structured logging           |

### 4.3 Monitoring and Operations

| Category          | Technology              | Description            |
| ----------------- | ----------------------- | ---------------------- |
| **Monitoring**    | Prometheus + Grafana    | Performance metrics    |
| **Alerting**      | AlertManager            | Exception notifications|
| **Log Collection**| ELK Stack               | Log aggregation        |

***

## Deployment Plan

### 5.1 Infrastructure Tiers

#### 5.1.1 Tier 3: Amateur Player

**Configuration**:

- Home computer + WiFi
- Free public RPC (Helius Free / QuickNode Free)

**Performance**:

- Transaction success rate < 5%
- Latency: 150-300ms
- Use case: Learning, testing

#### 5.1.2 Tier 2: Professional Retail

**Configuration**:

- Cloud server (AWS / Google Cloud / DigitalOcean)
- **Location**: Tokyo, Amsterdam, New York (near Solana validators)
- Paid dedicated RPC

**Performance**:

- Latency: 10-50ms
- Success rate: 30-50%
- Use case: Live trading

#### 5.1.3 Tier 1: Top Predator

**Configuration**:

- Bare metal server
- CPU: AMD EPYC high frequency
- RAM: 512GB+
- Disk: NVMe RAID 0
- Self-hosted Solana validator node + Geyser plugin

**Performance**:

- Latency: <1ms
- Success rate: 80%+
- Use case: Professional teams

### 5.2 Network Latency Comparison

| Location              | Distance to Solana Nodes | RTT Latency | Success Rate |
| --------------------- | ------------------------ | ----------- | ------------ |
| Home PC (Shanghai)    | 12,000km                 | 240ms       | <5%          |
| Tokyo Server          | 1,800km                  | 35ms        | 30-50%       |
| Local Validator       | 0km                      | <1ms        | 80%+         |

### 5.3 Deployment Architecture

```
┌─────────────────────────────────────────────┐
│          Production Deployment Architecture │
└─────────────────────────────────────────────┘

┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Tokyo Server │    │  NY Server   │    │ Amsterdam    │
│ (Primary)    │    │  (Backup)    │    │  (Backup)    │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                  ┌────────▼────────┐
                  │  Load Balancer  │
                  │   (HAProxy)     │
                  └────────┬────────┘
                           │
                  ┌────────▼────────┐
                  │  App Cluster    │
                  │   (Node.js)     │
                  └────────┬────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
│ PostgreSQL   │  │    Redis     │  │  Prometheus  │
│ (Primary DB) │  │   (Cache)    │  │ (Monitoring) │
└──────────────┘  └──────────────┘  └──────────────┘
```

### 5.4 Software-level Optimization

#### 5.4.1 UDP Buffer Optimization

```bash
# Linux kernel parameter tuning
sudo sysctl -w net.core.rmem_max=26214400
sudo sysctl -w net.core.wmem_max=26214400
sudo sysctl -w net.core.rmem_default=26214400
sudo sysctl -w net.core.wmem_default=26214400
```

#### 5.4.2 Jito Block Engine Selection

```javascript
// Select nearest Jito engine based on server location
const JITO_ENDPOINTS = {
  tokyo: "tokyo.mainnet.block-engine.jito.wtf",
  amsterdam: "amsterdam.mainnet.block-engine.jito.wtf",
  ny: "ny.mainnet.block-engine.jito.wtf"
};

// Tokyo server connects to Tokyo engine
const jitoEndpoint = JITO_ENDPOINTS.tokyo;
```

***

## Security Strategy

### 6.1 Token Security Audit

#### 6.1.1 Hardcoded Risk Check

```javascript
async function checkHardcodedRisks(mintAddress) {
  const mintInfo = await getMint(connection, mintAddress);

  const risks = [];

  // 1. Mint Authority
  if (mintInfo.mintAuthority !== null) {
    risks.push({
      level: "HIGH",
      type: "MINT_AUTHORITY",
      message: "Project can mint unlimited tokens"
    });
  }

  // 2. Freeze Authority
  if (mintInfo.freezeAuthority !== null) {
    risks.push({
      level: "HIGH",
      type: "FREEZE_AUTHORITY",
      message: "Project can freeze accounts (honeypot)"
    });
  }

  return risks;
}
```

#### 6.1.2 Liquidity Trap Check

```javascript
async function checkLiquidityTrap(mintAddress) {
  // Check if LP Token is locked
  const lpTokenAccount = await getLPTokenAccount(mintAddress);

  // LP Token lock methods:
  // 1. Burn: Send to dead address
  // 2. Lock: Send to lock contract

  const burntAmount = await checkBurntLP(lpTokenAccount);
  const lockedAmount = await checkLockedLP(lpTokenAccount);

  const totalLocked = burntAmount + lockedAmount;
  const lockedPercentage = totalLocked / totalSupply * 100;

  if (lockedPercentage < 95) {
    return {
      safe: false,
      reason: "LP lock ratio too low, possible rug pull"
    };
  }

  return { safe: true };
}
```

#### 6.1.3 Token Distribution Analysis

```javascript
async function analyzeTokenDistribution(mintAddress) {
  const holders = await getTokenHolders(mintAddress);

  // 1. Calculate top 10 holders percentage
  const top10Balance = holders.slice(0, 10)
    .reduce((sum, h) => sum + h.balance, 0);
  const top10Percentage = top10Balance / totalSupply * 100;

  // 2. Check for bundled wallets (insider buying)
  const bundledWallets = await detectBundledWallets(holders.slice(0, 10));

  if (top10Percentage > 30) {
    return {
      safe: false,
      reason: "High token concentration, possible insider holdings"
    };
  }

  if (bundledWallets.length > 5) {
    return {
      safe: false,
      reason: "Detected bundled buying, project team holding"
    };
  }

  return { safe: true };
}
```

#### 6.1.4 Transaction Simulation Verification

```javascript
async function simulateTransactionSafety(mintAddress) {
  // 1. Simulate buy
  const buySimulation = await connection.simulateTransaction(buyTx);

  if (buySimulation.value.err) {
    return { safe: false, reason: "Buy simulation failed" };
  }

  // 2. Simulate sell (Critical!)
  const sellSimulation = await connection.simulateTransaction(sellTx);

  if (sellSimulation.value.err) {
    return { safe: false, reason: "Sell failed, honeypot!" };
  }

  // 3. Check transfer tax
  const buyAmount = buySimulation.value.returnData;
  const sellAmount = sellSimulation.value.returnData;

  if (sellAmount < buyAmount * 0.9) {
    return {
      safe: false,
      reason: "Transfer tax too high, significant loss on sell"
    };
  }

  return { safe: true };
}
```

### 6.2 Fund Security Strategy

#### 6.2.1 Fund Isolation

```javascript
// Main wallet (cold wallet): Store most funds
const coldWallet = LedgerWallet;

// Sniper wallet (hot wallet): Transfer small amounts daily
const hotWallet = Keypair.generate();

// Transfer 5-10 SOL daily as ammunition
async function dailyFundTransfer() {
  const amount = 5; // SOL
  await transfer(coldWallet, hotWallet, amount);
}
```

#### 6.2.2 Auto Sweep

```javascript
// When hot wallet balance exceeds threshold, auto sweep to cold wallet
async function autoSweep() {
  const balance = await getBalance(hotWallet);
  const threshold = 20; // SOL

  if (balance > threshold) {
    const sweepAmount = balance - threshold;
    await transfer(hotWallet, coldWallet, sweepAmount);
    log.info(`Auto swept ${sweepAmount} SOL to cold wallet`);
  }
}
```

#### 6.2.3 Private Key Management

```javascript
// Use environment variables, never hardcode
import dotenv from "dotenv";
dotenv.config();

const privateKey = process.env.PRIVATE_KEY;

// Advanced: Use AWS KMS
import { KMSClient, DecryptCommand } from "@aws-sdk/client-kms";

const kmsClient = new KMSClient({ region: "us-east-1" });
const encryptedKey = process.env.ENCRYPTED_PRIVATE_KEY;

async function decryptPrivateKey() {
  const command = new DecryptCommand({
    CiphertextBlob: Buffer.from(encryptedKey, "base64")
  });
  const response = await kmsClient.send(command);
  return Buffer.from(response.Plaintext);
}
```

### 6.3 Network Security

```bash
# Cloud server firewall configuration
# Only open SSH(22) port, restrict IP

# 1. Install UFW
sudo apt install ufw

# 2. Allow SSH (your IP only)
sudo ufw allow from YOUR_IP to any port 22

# 3. Enable firewall
sudo ufw enable

# 4. Check status
sudo ufw status
```

***

## Performance Optimization

### 7.1 Transaction Building Optimization

#### 7.1.1 Precise Compute Unit Settings

```javascript
// 1. Simulate first to get exact consumption
const simulation = await connection.simulateTransaction(tx);
const cuConsumed = simulation.value.unitsConsumed;

// 2. Set Limit (20% margin)
const cuLimit = Math.ceil(cuConsumed * 1.2);

// 3. Add instruction
tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));
```

#### 7.1.2 Dynamic Priority Fee Adjustment

```javascript
async function getOptimalPriorityFee() {
  // Query fees from past 5 blocks
  const fees = await connection.getRecentPrioritizationFees(
    [PROGRAM_ID],
    5
  );

  // Calculate median
  const sorted = fees.map(f => f.priorityFee).sort();
  const median = sorted[Math.floor(sorted.length / 2)];

  // Double strategy (ensure priority)
  return median * 2;
}
```

### 7.2 Network Optimization

#### 7.2.1 WebSocket Connection Pool

```javascript
// Maintain multiple WebSocket connections to avoid single point of failure
const connections = [
  new Connection(RPC_URL_1, { wsEndpoint: WSS_URL_1 }),
  new Connection(RPC_URL_2, { wsEndpoint: WSS_URL_2 }),
  new Connection(RPC_URL_3, { wsEndpoint: WSS_URL_3 })
];

// Load balancing
function getRandomConnection() {
  return connections[Math.floor(Math.random() * connections.length)];
}
```

#### 7.2.2 Transaction Sending Strategy

```javascript
// Sniper mode: Skip preflight, send directly
async function sendSniperTransaction(tx) {
  const rawTx = tx.serialize();

  // 1. Send to multiple RPCs (parallel)
  const promises = connections.map(conn =>
    conn.sendRawTransaction(rawTx, {
      skipPreflight: true,  // Skip preflight
      maxRetries: 0        // No auto retry
    })
  );

  // 2. Also send to Jito
  promises.push(jitoClient.sendBundle([tx]));

  // 3. Wait for any success
  const result = await Promise.any(promises);

  return result;
}
```

### 7.3 Data Processing Optimization

#### 7.3.1 Caching Strategy

```javascript
// Redis cache for common data
import Redis from "ioredis";
const redis = new Redis();

// Cache Blockhash (30 second TTL)
async function getCachedBlockhash() {
  const cached = await redis.get("blockhash");
  if (cached) return cached;

  const { blockhash } = await connection.getLatestBlockhash();
  await redis.set("blockhash", blockhash, "EX", 30);

  return blockhash;
}

// Cache priority fee (5 second TTL)
async function getCachedPriorityFee() {
  const cached = await redis.get("priorityFee");
  if (cached) return parseInt(cached);

  const fee = await getOptimalPriorityFee();
  await redis.set("priorityFee", fee, "EX", 5);

  return fee;
}
```

#### 7.3.2 Batch Query Optimization

```javascript
// Batch get multiple token info
async function batchGetTokenInfo(mintAddresses) {
  // Use getMultipleAccountsInfo for batch query
  const accounts = await connection.getMultipleAccountsInfo(
    mintAddresses.map(addr => new PublicKey(addr))
  );

  return accounts.map(acc => decodeTokenInfo(acc.data));
}
```

***

## Risk Control

### 8.1 Transaction Risk Control

#### 8.1.1 Slippage Management

```javascript
// Dynamic slippage settings
function calculateSlippage(priceVolatility) {
  // High volatility: Set 50-100% slippage
  if (volatility > 0.5) {
    return 1.0; // 100% slippage (Degen mode)
  }

  // Medium volatility: 20-30% slippage
  if (volatility > 0.2) {
    return 0.3;
  }

  // Low volatility: 10% slippage
  return 0.1;
}
```

#### 8.1.2 Failure Retry Strategy

```javascript
async function executeWithRetry(tx, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const sig = await connection.sendTransaction(tx);
      const confirmed = await connection.confirmTransaction(sig, "processed");

      if (confirmed.value.err) {
        throw new Error("Transaction failed");
      }

      return sig;
    } catch (error) {
      log.warn(`Attempt ${i+1} failed: ${error.message}`);

      // Update Blockhash and priority fee
      tx.recentBlockhash = await getCachedBlockhash();
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: await getCachedPriorityFee()
      }));

      // Wait 100ms before retry
      await sleep(100);
    }
  }

  throw new Error("All retries failed");
}
```

### 8.2 System Risk Control

#### 8.2.1 Exception Handling

```javascript
// Global exception capture
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error);
  // Send alert
  sendAlert("CRITICAL", error.message);
  // Graceful shutdown
  gracefulShutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  log.error("Unhandled promise rejection:", reason);
  sendAlert("HIGH", reason);
});
```

#### 8.2.2 Rate Limiting Protection

```javascript
import { RateLimiter } from "limiter";

// RPC request rate limiting (avoid rejection)
const rpcLimiter = new RateLimiter({
  tokensPerInterval: 100,
  interval: "second"
});

async function safeRpcCall(fn) {
  await rpcLimiter.removeTokens(1);
  return fn();
}
```

#### 8.2.3 Health Check

```javascript
// Periodic health check
async function healthCheck() {
  const checks = {
    rpc: await checkRpcConnection(),
    wallet: await checkWalletBalance(),
    redis: await checkRedisConnection(),
    db: await checkDatabaseConnection()
  };

  const allHealthy = Object.values(checks).every(c => c);

  if (!allHealthy) {
    sendAlert("HIGH", "System health check failed");
  }

  return checks;
}

// Check every 30 seconds
setInterval(healthCheck, 30000);
```

***

## Monitoring and Operations

### 9.1 Performance Metrics Monitoring

#### 9.1.1 Key Metrics

| Metric               | Description                    | Alert Threshold |
| -------------------- | ------------------------------ | --------------- |
| **Transaction Success Rate** | Percentage of successful txs   | <30%            |
| **Average Latency**  | Time from discovery to buy     | >100ms          |
| **RPC Response Time**| RPC request latency            | >50ms           |
| **Wallet Balance**   | Hot wallet SOL balance         | <2 SOL          |
| **Position Count**   | Current token positions        | >20             |
| **P&L**              | Current total profit/loss      | <-50%           |

#### 9.1.2 Prometheus Metrics

```javascript
import { Counter, Histogram, Gauge } from "prom-client";

// Transaction counter
const txCounter = new Counter({
  name: "sniper_transactions_total",
  help: "Total transactions executed",
  labelNames: ["status", "type"]
});

// Latency histogram
const latencyHistogram = new Histogram({
  name: "sniper_latency_ms",
  help: "Transaction latency in milliseconds",
  buckets: [10, 50, 100, 200, 500, 1000]
});

// Balance gauge
const balanceGauge = new Gauge({
  name: "sniper_wallet_balance",
  help: "Current wallet balance in SOL"
});

// Record metrics
txCounter.inc({ status: "success", type: "buy" });
latencyHistogram.observe(50);
balanceGauge.set(5.2);
```

### 9.2 Log Management

#### 9.2.1 Structured Logging

```javascript
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // File logs
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),

    // Console logs
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Key event logging
logger.info("New token discovered", {
  mint: mintAddress,
  signature: sig,
  latency: 50
});

logger.error("Transaction failed", {
  mint: mintAddress,
  error: err.message,
  retries: 3
});
```

### 9.3 Alert System

#### 9.3.1 Alert Rules

```yaml
# Prometheus AlertManager rules
groups:
  - name: sniper_alerts
    rules:
      # Low success rate
      - alert: LowSuccessRate
        expr: rate(sniper_transactions_total{status="success"}[5m]) / rate(sniper_transactions_total[5m]) < 0.3
        for: 5m
        annotations:
          summary: "Transaction success rate below 30%"

      # High latency
      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(sniper_latency_ms_bucket[5m])) > 100
        for: 2m
        annotations:
          summary: "95% of transactions exceed 100ms latency"

      # Low wallet balance
      - alert: LowBalance
        expr: sniper_wallet_balance < 2
        for: 1m
        annotations:
          summary: "Wallet balance below 2 SOL"
```

#### 9.3.2 Alert Notifications

```javascript
import { WebClient } from "@slack/web-api";

const slackClient = new WebClient(process.env.SLACK_TOKEN);

async function sendAlert(level, message) {
  const color = level === "CRITICAL" ? "#ff0000" :
                level === "HIGH" ? "#ff6600" : "#ffcc00";

  await slackClient.chat.postMessage({
    channel: "#sniper-alerts",
    attachments: [{
      color,
      title: `${level} Alert`,
      text: message,
      timestamp: Date.now()
    }]
  });
}
```

### 9.4 Automated Operations

#### 9.4.1 Auto Restart

```javascript
// PM2 configuration ecosystem.config.js
module.exports = {
  apps: [{
    name: "sniper-bot",
    script: "index.js",

    // Auto restart
    watch: false,
    max_memory_restart: "500M",

    // Restart strategy
    restart_delay: 1000,
    max_restarts: 10,

    // Environment variables
    env: {
      NODE_ENV: "production",
      RPC_URL: "https://...",
      PRIVATE_KEY: "..."
    },

    // Logging
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    error_file: "logs/error.log",
    out_file: "logs/out.log"
  }]
};
```

#### 9.4.2 Scheduled Tasks

```javascript
import cron from "node-cron";

// Daily fund sweep at 2 AM
cron.schedule("0 2 * * *", async () => {
  await autoSweep();
  logger.info("Fund sweep completed");
});

// Hourly position check
cron.schedule("0 * * * *", async () => {
  await checkHoldings();
  logger.info("Position check completed");
});

// Update config every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  await updateConfig();
  logger.info("Config update completed");
});
```

***

## Development Plan

### 10.1 Development Phases

#### Phase 1: Basic Architecture Setup (2 weeks)

**Task List**:

- [x] Project initialization
- [x] Config module development
- [x] RPC connection management
- [x] Wallet management
- [x] Logging system setup

**Deliverables**:

- Runnable basic framework
- Configuration management system
- Basic logging

#### Phase 2: Monitoring and Security Modules (3 weeks)

**Task List**:

- [x] WebSocket monitoring implementation
- [x] Pump.fun monitoring
- [x] Raydium monitoring
- [x] Security audit module
- [x] Transaction simulation verification

**Deliverables**:

- Real-time on-chain monitoring system
- Complete security audit flow
- Honeypot detection functionality

#### Phase 3: Transaction Execution Module (3 weeks)

**Task List**:

- [x] Transaction building logic
- [x] Compute Budget management
- [x] Swap instruction building
- [x] Jito Bundle implementation
- [x] Dynamic priority fee adjustment

**Deliverables**:

- Complete transaction building system
- Jito Bundle integration
- Dynamic fee strategy

#### Phase 4: Sell Strategy Module (2 weeks)

**Task List**:

- [x] Price monitoring implementation
- [x] Take-profit/stop-loss logic
- [x] Trailing stop
- [x] Time stop
- [x] Position management

**Deliverables**:

- Automated selling system
- Multi-strategy support
- Position management functionality

#### Phase 5: Performance Optimization and Deployment (2 weeks)

**Task List**:

- [x] Performance optimization
- [x] Caching system
- [x] Monitoring system integration
- [x] Production deployment
- [x] Stress testing

**Deliverables**:

- High-performance production system
- Complete monitoring system
- Deployment documentation

#### Phase 6: Operations and Iteration (Ongoing)

**Task List**:

- [x] Monitoring and alerting improvements
- [x] Exception handling optimization
- [x] New platform support (Meteora)
- [x] Strategy optimization
- [x] Documentation improvements

**Deliverables**:

- Stable running system
- Complete operations system
- Continuous iteration updates

***

## Summary

This architecture document provides a complete Solana sniper bot system design, covering everything from basic architecture, core modules, technology selection, deployment plans, security strategies, performance optimization, risk control to monitoring and operations.

**Core Advantages**:

1. **Modular Design**: Clear module division, easy to maintain and extend
2. **Security First**: Multi-layer security audit, effectively avoid honeypots and Rug Pulls
3. **Extreme Performance**: Achieve millisecond response through Geyser, Jito, optimized configuration
4. **Automated Operations**: Complete monitoring, alerting, and automation scripts

**Risk Warning**:

- On-chain sniping is a zero-sum game with extremely intense competition
- 99% of new tokens eventually go to zero, requiring strict risk control
- Code errors may lead to private key leaks or fund loss
- **Please test thoroughly on Devnet before considering mainnet deployment**

**Next Steps**:

1. Implement each module according to the development plan
2. Complete testing on Devnet
3. Deploy to servers near Solana nodes (Tokyo, etc.)
4. Continuously monitor and optimize system performance

***

**Document Version**: v1.0
**Last Updated**: 2026-06-16
**Author**: Sniper Bot Team
**Reference Tutorial**: SolDevCamp - Solana Sniper Bot Development Course
