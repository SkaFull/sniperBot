[简体中文](./README.md) | [English](./README_EN.md) | [繁體中文](./README_HK.md)

# Solana Sniper Bot

高性能 Solana 狙击机器人，完整实现狙击功能链路。

## 功能模块

| 模块 | 功能 | 状态 |
|------|------|------|
| **Leader Tracker** | Leader IP 和 TPU 端口计算 | ✅ |
| **Slot Monitor** | Slot 实时监控 | ✅ |
| **TPU Sender** | UDP 直连发送交易 | ✅ |
| **Liquidity Monitor** | Raydium/Pump.fun 流动性监听 | ✅ |
| **Token Auditor** | 代币安全审计 (Rug Check) | ✅ |
| **Swap Builder** | Swap 指令构建 + 动态优先费 | ✅ |
| **Jito Bundle** | Jito Bundle 发送 (防夹子) | ✅ |
| **Sell Strategy** | 止盈/止损/移动止损策略 | ✅ |

## 项目结构

```
sniperBot/
├── src/
│   ├── core/
│   │   ├── leader-tracker.ts    # Leader 追踪器
│   │   ├── tpu-sender.ts        # TPU 直接发送器
│   │   ├── slot-monitor.ts      # Slot 监控器
│   │   ├── sniper-sender.ts     # 狙击交易发送器
│   │   └── index.ts             # 核心模块导出
│   ├── security/
│   │   ├── token-audit.ts       # 代币安全审计
│   │   └── index.ts             # 安全模块导出
│   ├── monitor/
│   │   ├── liquidity-monitor.ts # 流动性监听 (WebSocket)
│   │   └── index.ts             # 监控模块导出
│   ├── executor/
│   │   ├── swap-builder.ts      # Swap 指令构建
│   │   ├── jito-bundle.ts       # Jito Bundle 发送
│   │   └── index.ts             # 执行模块导出
│   ├── strategy/
│   │   ├── sell-strategy.ts     # 止盈止损策略
│   │   └── index.ts             # 策略模块导出
│   ├── utils/
│   │   ├── logger.ts            # 日志工具
│   │   ├── cache.ts             # 缓存管理
│   │   └── connection.ts        # RPC 连接管理
│   ├── config/
│   │   └── index.ts             # 配置管理
│   ├── monitoring/
│   │   └── metrics.ts           # Prometheus 指标
│   └── index.ts                 # 入口文件
├── tests/
│   └── leader-tracker.test.ts   # 测试文件
├── benchmarks/
│   └── leader-info.benchmark.ts # 性能基准测试
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## 安装

```bash
npm install
```

## 配置

复制 `.env.example` 到 `.env` 并填写配置:

```bash
cp .env.example .env
```

### 必需配置

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `RPC_URL` | Solana RPC 节点地址 | `https://api.mainnet-beta.solana.com` |
| `PRIVATE_KEY` | 钱包私钥 (Base58) | `你的私钥` |

### 狙击配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `USE_TPU_DIRECT` | 是否启用 TPU 直连 | `true` |
| `SEND_TO_MULTIPLE_LEADERS` | 是否发送到多个 Leader | `true` |
| `PRE_SEND_LEADER_COUNT` | 预发送 Leader 数量 | `2` |

### 交易配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `BUY_AMOUNT` | 每次买入金额 (SOL) | `0.1` |
| `JITO_TIP` | Jito 小费 (SOL) | `0.001` |
| `TAKE_PROFIT` | 止盈比例 (如 2.0 = 翻倍) | `2.0` |
| `STOP_LOSS` | 止损比例 (如 0.5 = 亏50%) | `0.5` |
| `TRAILING_STOP` | 移动止损回撤比例 | `0.2` |

### 安全配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `MAX_TOP10_HOLDERS` | 前10持币占比上限 (%) | `30` |
| `MIN_LP_LOCKED` | LP 锁定最低比例 (%) | `95` |

## 运行

```bash
# 开发模式
npm run dev

# 编译后运行
npm run build
npm start
```

## 测试

```bash
npm test
```

## 性能基准测试

```bash
npm run benchmark
```

## 核心功能详解

### 1. Leader IP 地址计算

```
步骤 1: 获取当前 Slot (connection.getEpochInfo)
步骤 2: 获取 Leader Schedule (connection.getLeaderSchedule)
步骤 3: 找到当前 Slot 的 Leader Vote Pubkey
步骤 4: 通过 Vote Accounts 获取 Identity Pubkey
步骤 5: 通过 getClusterNodes 获取网络信息
步骤 6: 解析 IP 地址和端口
```

### 2. Leader TPU 端口计算

```
端口偏移规则 (基于 Gossip 端口):
- Gossip    = base_port + 0
- TPU       = base_port + 1  ← 核心!
- TPU QUIC  = base_port + 2
- TPU Forward = base_port + 3
- TVU       = base_port + 4

示例: Gossip=8001 → TPU=8002
```

### 3. 代币安全审计 (Rug Check)

检查项目:
- ✅ Mint Authority 是否放弃 (防止无限增发)
- ✅ Freeze Authority 是否放弃 (防止貔貅盘)
- ✅ LP Token 是否锁定/销毁 (防止 Rug Pull)
- ✅ 前10持币占比 (防止老鼠仓)
- ✅ 交易模拟测试 (检测隐藏貔貅)

### 4. 流动性监听

监听目标:
- **Raydium AMM**: `initialize2` 指令 (创建池子)
- **Pump.fun**: `Create` 指令 (发币)
- **Orca Whirlpool**: 池子创建事件

### 5. Swap 指令构建

- ComputeBudget 指令 (设置计算预算)
- 动态优先费 (基于网络拥堵程度)
- Pump.fun / Raydium Swap 指令
- 交易模拟验证

### 6. Jito Bundle

- 原子交易包 (全部成功或全部失败)
- Tip 账户转账 (贿赂验证者)
- 失败不付费机制
- 防三明治攻击 (MEV Protection)

### 7. 止盈止损策略

策略类型:
- **硬止盈**: 涨幅达到目标卖出部分
- **硬止损**: 亏损达到阈值全部卖出
- **移动止损**: 从 ATH 回撤一定比例卖出
- **时间止损**: 超过时间未盈利卖出

## 使用示例

### 基础使用

```typescript
import { SniperBot } from "./src";

const bot = new SniperBot();
await bot.start();

// 获取当前 Leader
const leader = await bot.getCurrentLeader();
console.log(`Leader IP: ${leader.ip}`);
console.log(`TPU Port: ${leader.ports.tpu}`);

// 获取接下来的 Leaders
const nextLeaders = await bot.getNextLeaders(4);

await bot.stop();
```

### 完整狙击流程

```typescript
import { SniperBot } from "./src";

const bot = new SniperBot();

// 启动机器人 (自动监听流动性事件)
await bot.start();

// 机器人会自动:
// 1. 监听 Raydium/Pump.fun 新池子
// 2. 执行代币安全审计
// 3. 通过 Jito 发送买入交易
// 4. 监控持仓执行止盈止损策略

// 手动操作
const auditResult = await bot.auditToken("TokenMintAddress");
console.log(`安全评分: ${auditResult.score}`);
console.log(`是否安全: ${auditResult.safe}`);

// 查看持仓
const positions = bot.getPositions();

// 手动卖出
bot.manualSell("TokenMintAddress", 0.5);  // 卖出 50%

await bot.stop();
```

### 单独使用模块

```typescript
import { 
  TokenAuditor, 
  LiquidityMonitor, 
  SwapBuilder,
  JitoBundleSender,
  SellStrategyManager
} from "./src";

// 代币审计
const auditor = new TokenAuditor(connection);
const result = await auditor.auditToken(mintAddress);

// 流动性监听
const monitor = new LiquidityMonitor(connection);
monitor.onLiquidity((event) => {
  console.log(`新池子: ${event.mint}`);
});
await monitor.start();

// Swap 构建
const swapBuilder = new SwapBuilder(connection, wallet);
const tx = await swapBuilder.buildBuyTransaction({
  mint: "TokenAddress",
  amount: 0.1,
  slippage: 50,
  side: "buy"
});

// Jito 发送
const jitoSender = new JitoBundleSender(connection, wallet);
const result = await jitoSender.sendBundle(tx.transaction);

// 止盈止损
const sellStrategy = new SellStrategyManager(connection);
sellStrategy.addPosition(mint, buyPrice, buyAmount, signature);
sellStrategy.onSell((signal) => {
  console.log(`卖出信号: ${signal.type}`);
});
```

## 架构方案

详见 [狙击模式实现方案](./docs/sniper-mode.md) | [架构方案文档](./docs/architecture.md)

## 课程参考

本项目基于 [Solana Sniper Bot 课程](https://academy.soldevcamp.com/course/sniper-bot/) 实现，包含:

1. 狙击机器人概述与生态基础
2. 交易生命周期与优先费
3. 监听链上事件 (WebSocket)
4. 代币安全审计 (Rug Check)
5. 构建交易指令 (Transaction Building)
6. Jito Bundles: 穿越黑暗森林的隐形斗篷
7. 卖出的艺术：止盈与止损
8. 终极组装：编写你的第一个狙击机器人

## ⚠️ 风险警告

**极高风险提示**: 链上狙击是一场零和博弈。

- 99% 的新币最终归零
- 代码错误可能导致私钥泄露或资金被耗尽
- 本项目仅教授技术原理，**绝非投资建议**
- 请在 Devnet 测试网充分测试后再考虑主网部署

## ☕ 捐赠

如果这个项目对你有帮助，欢迎请作者喝杯咖啡 ☕

| 链类型 | 地址 |
|--------|------|
| Ethereum (ETH) | `0x2CfBca7DBb0eef8ced407b69C54981fa3348a9Ff` |
| Solana (SOL) | `9tMTcoFRTSCGmhVnsuHCmrguKcCjHyfacm4NbBTcuJ1C` |
| BNB Chain (BNB) | `0x2CfBca7DBb0eef8ced407b69C54981fa3348a9Ff` |

## License

MIT