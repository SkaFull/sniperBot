[简体中文](./README.md) | [English](./README_EN.md) | [繁體中文](./README_HK.md)

# Solana Sniper Bot

High-performance Solana sniper bot with complete sniper functionality implementation.

## Feature Modules

| Module | Function | Status |
|--------|----------|--------|
| **Leader Tracker** | Leader IP and TPU port calculation | ✅ |
| **Slot Monitor** | Real-time slot monitoring | ✅ |
| **TPU Sender** | UDP direct transaction sending | ✅ |
| **Liquidity Monitor** | Raydium/Pump.fun liquidity monitoring | ✅ |
| **Token Auditor** | Token security audit (Rug Check) | ✅ |
| **Swap Builder** | Swap instruction building + dynamic priority fees | ✅ |
| **Jito Bundle** | Jito Bundle sending (anti-sandwich) | ✅ |
| **Sell Strategy** | Take profit/Stop loss/Trailing stop strategies | ✅ |

## Project Structure

```
sniperBot/
├── src/
│   ├── core/
│   │   ├── leader-tracker.ts    # Leader tracker
│   │   ├── tpu-sender.ts        # TPU direct sender
│   │   ├── slot-monitor.ts      # Slot monitor
│   │   ├── sniper-sender.ts     # Sniper transaction sender
│   │   └── index.ts             # Core module exports
│   ├── security/
│   │   ├── token-audit.ts       # Token security audit
│   │   └── index.ts             # Security module exports
│   ├── monitor/
│   │   ├── liquidity-monitor.ts # Liquidity monitoring (WebSocket)
│   │   └── index.ts             # Monitor module exports
│   ├── executor/
│   │   ├── swap-builder.ts      # Swap instruction building
│   │   ├── jito-bundle.ts       # Jito Bundle sending
│   │   └── index.ts             # Executor module exports
│   ├── strategy/
│   │   ├── sell-strategy.ts     # Take profit/Stop loss strategies
│   │   └── index.ts             # Strategy module exports
│   ├── utils/
│   │   ├── logger.ts            # Logger utility
│   │   ├── cache.ts             # Cache management
│   │   └── connection.ts        # RPC connection management
│   ├── config/
│   │   └── index.ts             # Configuration management
│   ├── monitoring/
│   │   └── metrics.ts           # Prometheus metrics
│   └── index.ts                 # Entry file
├── tests/
│   └── leader-tracker.test.ts   # Test files
├── benchmarks/
│   └── leader-info.benchmark.ts # Performance benchmarks
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and fill in the configuration:

```bash
cp .env.example .env
```

### Required Configuration

| Config Item | Description | Example |
|-------------|-------------|---------|
| `RPC_URL` | Solana RPC node address | `https://api.mainnet-beta.solana.com` |
| `PRIVATE_KEY` | Wallet private key (Base58) | `your-private-key` |

### Sniper Configuration

| Config Item | Description | Default |
|-------------|-------------|---------|
| `USE_TPU_DIRECT` | Enable TPU direct connection | `true` |
| `SEND_TO_MULTIPLE_LEADERS` | Send to multiple leaders | `true` |
| `PRE_SEND_LEADER_COUNT` | Pre-send leader count | `2` |

### Transaction Configuration

| Config Item | Description | Default |
|-------------|-------------|---------|
| `BUY_AMOUNT` | Buy amount per transaction (SOL) | `0.1` |
| `JITO_TIP` | Jito tip (SOL) | `0.001` |
| `TAKE_PROFIT` | Take profit ratio (e.g., 2.0 = double) | `2.0` |
| `STOP_LOSS` | Stop loss ratio (e.g., 0.5 = 50% loss) | `0.5` |
| `TRAILING_STOP` | Trailing stop drawdown ratio | `0.2` |

### Security Configuration

| Config Item | Description | Default |
|-------------|-------------|---------|
| `MAX_TOP10_HOLDERS` | Top 10 holders percentage limit (%) | `30` |
| `MIN_LP_LOCKED` | Minimum LP lock ratio (%) | `95` |

## Running

```bash
# Development mode
npm run dev

# Build and run
npm run build
npm start
```

## Testing

```bash
npm test
```

## Performance Benchmarks

```bash
npm run benchmark
```

## Core Features Explained

### 1. Leader IP Address Calculation

```
Step 1: Get current slot (connection.getEpochInfo)
Step 2: Get leader schedule (connection.getLeaderSchedule)
Step 3: Find current slot's leader vote pubkey
Step 4: Get identity pubkey through vote accounts
Step 5: Get network info through getClusterNodes
Step 6: Parse IP address and port
```

### 2. Leader TPU Port Calculation

```
Port offset rules (based on Gossip port):
- Gossip    = base_port + 0
- TPU       = base_port + 1  ← Core!
- TPU QUIC  = base_port + 2
- TPU Forward = base_port + 3
- TVU       = base_port + 4

Example: Gossip=8001 → TPU=8002
```

### 3. Token Security Audit (Rug Check)

Check items:
- ✅ Mint Authority revoked (prevent unlimited minting)
- ✅ Freeze Authority revoked (prevent honeypot)
- ✅ LP Token locked/burned (prevent rug pull)
- ✅ Top 10 holders percentage (prevent insider holdings)
- ✅ Transaction simulation test (detect hidden honeypots)

### 4. Liquidity Monitoring

Monitoring targets:
- **Raydium AMM**: `initialize2` instruction (pool creation)
- **Pump.fun**: `Create` instruction (token launch)
- **Orca Whirlpool**: Pool creation events

### 5. Swap Instruction Building

- ComputeBudget instructions (set compute budget)
- Dynamic priority fees (based on network congestion)
- Pump.fun / Raydium Swap instructions
- Transaction simulation validation

### 6. Jito Bundle

- Atomic transaction bundle (all succeed or all fail)
- Tip account transfer (bribe validators)
- No pay on failure mechanism
- Anti-sandwich attack (MEV Protection)

### 7. Take Profit / Stop Loss Strategies

Strategy types:
- **Hard Take Profit**: Sell partial when reaching target profit
- **Hard Stop Loss**: Sell all when loss reaches threshold
- **Trailing Stop**: Sell when retracing from ATH by a certain percentage
- **Time Stop Loss**: Sell if not profitable after a certain time

## Usage Examples

### Basic Usage

```typescript
import { SniperBot } from "./src";

const bot = new SniperBot();
await bot.start();

// Get current leader
const leader = await bot.getCurrentLeader();
console.log(`Leader IP: ${leader.ip}`);
console.log(`TPU Port: ${leader.ports.tpu}`);

// Get next leaders
const nextLeaders = await bot.getNextLeaders(4);

await bot.stop();
```

### Complete Sniper Flow

```typescript
import { SniperBot } from "./src";

const bot = new SniperBot();

// Start the bot (automatically monitors liquidity events)
await bot.start();

// The bot will automatically:
// 1. Monitor Raydium/Pump.fun new pools
// 2. Execute token security audit
// 3. Send buy transactions via Jito
// 4. Monitor positions and execute take profit/stop loss strategies

// Manual operations
const auditResult = await bot.auditToken("TokenMintAddress");
console.log(`Security score: ${auditResult.score}`);
console.log(`Is safe: ${auditResult.safe}`);

// View positions
const positions = bot.getPositions();

// Manual sell
bot.manualSell("TokenMintAddress", 0.5);  // Sell 50%

await bot.stop();
```

### Using Modules Individually

```typescript
import { 
  TokenAuditor, 
  LiquidityMonitor, 
  SwapBuilder,
  JitoBundleSender,
  SellStrategyManager
} from "./src";

// Token audit
const auditor = new TokenAuditor(connection);
const result = await auditor.auditToken(mintAddress);

// Liquidity monitoring
const monitor = new LiquidityMonitor(connection);
monitor.onLiquidity((event) => {
  console.log(`New pool: ${event.mint}`);
});
await monitor.start();

// Swap building
const swapBuilder = new SwapBuilder(connection, wallet);
const tx = await swapBuilder.buildBuyTransaction({
  mint: "TokenAddress",
  amount: 0.1,
  slippage: 50,
  side: "buy"
});

// Jito sending
const jitoSender = new JitoBundleSender(connection, wallet);
const result = await jitoSender.sendBundle(tx.transaction);

// Take profit / Stop loss
const sellStrategy = new SellStrategyManager(connection);
sellStrategy.addPosition(mint, buyPrice, buyAmount, signature);
sellStrategy.onSell((signal) => {
  console.log(`Sell signal: ${signal.type}`);
});
```

## Architecture

See [Sniper Mode Implementation](./docs/sniper-mode_EN.md) | [Architecture Document](./docs/architecture_EN.md) for details.

## Course Reference

This project is based on the [Solana Sniper Bot Course](https://academy.soldevcamp.com/course/sniper-bot/), including:

1. Sniper Bot Overview and Ecosystem Basics
2. Transaction Lifecycle and Priority Fees
3. Monitoring On-chain Events (WebSocket)
4. Token Security Audit (Rug Check)
5. Building Transaction Instructions
6. Jito Bundles: The Invisibility Cloak Through the Dark Forest
7. The Art of Selling: Take Profit and Stop Loss
8. Ultimate Assembly: Writing Your First Sniper Bot

## ⚠️ Risk Warning

**Extreme High Risk Warning**: On-chain sniping is a zero-sum game.

- 99% of new tokens eventually go to zero
- Code errors may lead to private key leaks or fund depletion
- This project teaches technical principles only, **not investment advice**
- Please test thoroughly on Devnet before considering mainnet deployment

## ☕ Donation

If this project helps you, feel free to buy the author a coffee ☕

| Chain Type | Address |
|------------|---------|
| Ethereum (ETH) | `0x2CfBca7DBb0eef8ced407b69C54981fa3348a9Ff` |
| Solana (SOL) | `9tMTcoFRTSCGmhVnsuHCmrguKcCjHyfacm4NbBTcuJ1C` |
| BNB Chain (BNB) | `0x2CfBca7DBb0eef8ced407b69C54981fa3348a9Ff` |

## License

MIT
