[简体中文](./README.md) | [English](./README_EN.md) | [繁體中文](./README_HK.md)

# Solana 狙擊機器人

高性能 Solana 狙擊機器人，完整實現狙擊功能鏈路。

## 功能模組

| 模組 | 功能 | 狀態 |
|------|------|------|
| **Leader Tracker** | Leader IP 和 TPU 端口計算 | ✅ |
| **Slot Monitor** | Slot 實時監控 | ✅ |
| **TPU Sender** | UDP 直連發送交易 | ✅ |
| **Liquidity Monitor** | Raydium/Pump.fun 流動性監聽 | ✅ |
| **Token Auditor** | 代幣安全審計 (Rug Check) | ✅ |
| **Swap Builder** | Swap 指令構建 + 動態優先費 | ✅ |
| **Jito Bundle** | Jito Bundle 發送 (防夾子) | ✅ |
| **Sell Strategy** | 止盈/止損/移動止損策略 | ✅ |

## 項目結構

```
sniperBot/
├── src/
│   ├── core/
│   │   ├── leader-tracker.ts    # Leader 追蹤器
│   │   ├── tpu-sender.ts        # TPU 直接發送器
│   │   ├── slot-monitor.ts      # Slot 監控器
│   │   ├── sniper-sender.ts     # 狙擊交易發送器
│   │   └── index.ts             # 核心模組導出
│   ├── security/
│   │   ├── token-audit.ts       # 代幣安全審計
│   │   └── index.ts             # 安全模組導出
│   ├── monitor/
│   │   ├── liquidity-monitor.ts # 流動性監聽 (WebSocket)
│   │   └── index.ts             # 監控模組導出
│   ├── executor/
│   │   ├── swap-builder.ts      # Swap 指令構建
│   │   ├── jito-bundle.ts       # Jito Bundle 發送
│   │   └── index.ts             # 執行模組導出
│   ├── strategy/
│   │   ├── sell-strategy.ts     # 止盈止損策略
│   │   └── index.ts             # 策略模組導出
│   ├── utils/
│   │   ├── logger.ts            # 日誌工具
│   │   ├── cache.ts             # 緩存管理
│   │   └── connection.ts        # RPC 連接管理
│   ├── config/
│   │   └── index.ts             # 配置管理
│   ├── monitoring/
│   │   └── metrics.ts           # Prometheus 指標
│   └── index.ts                 # 入口文件
├── tests/
│   └── leader-tracker.test.ts   # 測試文件
├── benchmarks/
│   └── leader-info.benchmark.ts # 性能基準測試
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## 安裝

```bash
npm install
```

## 配置

複製 `.env.example` 到 `.env` 並填寫配置:

```bash
cp .env.example .env
```

### 必需配置

| 配置項 | 說明 | 示例 |
|--------|------|------|
| `RPC_URL` | Solana RPC 節點地址 | `https://api.mainnet-beta.solana.com` |
| `PRIVATE_KEY` | 錢包私鑰 (Base58) | `你的私鑰` |

### 狙擊配置

| 配置項 | 說明 | 預設值 |
|--------|------|--------|
| `USE_TPU_DIRECT` | 是否啟用 TPU 直連 | `true` |
| `SEND_TO_MULTIPLE_LEADERS` | 是否發送到多個 Leader | `true` |
| `PRE_SEND_LEADER_COUNT` | 預發送 Leader 數量 | `2` |

### 交易配置

| 配置項 | 說明 | 預設值 |
|--------|------|--------|
| `BUY_AMOUNT` | 每次買入金額 (SOL) | `0.1` |
| `JITO_TIP` | Jito 小費 (SOL) | `0.001` |
| `TAKE_PROFIT` | 止盈比例 (如 2.0 = 翻倍) | `2.0` |
| `STOP_LOSS` | 止損比例 (如 0.5 = 虧50%) | `0.5` |
| `TRAILING_STOP` | 移動止損回撤比例 | `0.2` |

### 安全配置

| 配置項 | 說明 | 預設值 |
|--------|------|--------|
| `MAX_TOP10_HOLDERS` | 前10持幣佔比上限 (%) | `30` |
| `MIN_LP_LOCKED` | LP 鎖定最低比例 (%) | `95` |

## 運行

```bash
# 開發模式
npm run dev

# 編譯後運行
npm run build
npm start
```

## 測試

```bash
npm test
```

## 性能基準測試

```bash
npm run benchmark
```

## 核心功能詳解

### 1. Leader IP 地址計算

```
步驟 1: 獲取當前 Slot (connection.getEpochInfo)
步驟 2: 獲取 Leader Schedule (connection.getLeaderSchedule)
步驟 3: 找到當前 Slot 的 Leader Vote Pubkey
步驟 4: 通過 Vote Accounts 獲取 Identity Pubkey
步驟 5: 通過 getClusterNodes 獲取網絡信息
步驟 6: 解析 IP 地址和端口
```

### 2. Leader TPU 端口計算

```
端口偏移規則 (基於 Gossip 端口):
- Gossip    = base_port + 0
- TPU       = base_port + 1  ← 核心!
- TPU QUIC  = base_port + 2
- TPU Forward = base_port + 3
- TVU       = base_port + 4

示例: Gossip=8001 → TPU=8002
```

### 3. 代幣安全審計 (Rug Check)

檢查項目:
- ✅ Mint Authority 是否放棄 (防止無限增發)
- ✅ Freeze Authority 是否放棄 (防止貔貅盤)
- ✅ LP Token 是否鎖定/銷毀 (防止 Rug Pull)
- ✅ 前10持幣佔比 (防止老鼠倉)
- ✅ 交易模擬測試 (檢測隱藏貔貅)

### 4. 流動性監聽

監聽目標:
- **Raydium AMM**: `initialize2` 指令 (創建池子)
- **Pump.fun**: `Create` 指令 (發幣)
- **Orca Whirlpool**: 池子創建事件

### 5. Swap 指令構建

- ComputeBudget 指令 (設置計算預算)
- 動態優先費 (基於網絡擁堵程度)
- Pump.fun / Raydium Swap 指令
- 交易模擬驗證

### 6. Jito Bundle

- 原子交易包 (全部成功或全部失敗)
- Tip 賬戶轉賬 (賄賂驗證者)
- 失敗不付費機制
- 防三明治攻擊 (MEV Protection)

### 7. 止盈止損策略

策略類型:
- **硬止盈**: 漲幅達到目標賣出部分
- **硬止損**: 虧損達到閾值全部賣出
- **移動止損**: 從 ATH 回撤一定比例賣出
- **時間止損**: 超過時間未盈利賣出

## 使用示例

### 基礎使用

```typescript
import { SniperBot } from "./src";

const bot = new SniperBot();
await bot.start();

// 獲取當前 Leader
const leader = await bot.getCurrentLeader();
console.log(`Leader IP: ${leader.ip}`);
console.log(`TPU Port: ${leader.ports.tpu}`);

// 獲取接下來的 Leaders
const nextLeaders = await bot.getNextLeaders(4);

await bot.stop();
```

### 完整狙擊流程

```typescript
import { SniperBot } from "./src";

const bot = new SniperBot();

// 啟動機器人 (自動監聽流動性事件)
await bot.start();

// 機器人會自動:
// 1. 監聽 Raydium/Pump.fun 新池子
// 2. 執行代幣安全審計
// 3. 通過 Jito 發送買入交易
// 4. 監控持倉執行止盈止損策略

// 手動操作
const auditResult = await bot.auditToken("TokenMintAddress");
console.log(`安全評分: ${auditResult.score}`);
console.log(`是否安全: ${auditResult.safe}`);

// 查看持倉
const positions = bot.getPositions();

// 手動賣出
bot.manualSell("TokenMintAddress", 0.5);  // 賣出 50%

await bot.stop();
```

### 單獨使用模組

```typescript
import { 
  TokenAuditor, 
  LiquidityMonitor, 
  SwapBuilder,
  JitoBundleSender,
  SellStrategyManager
} from "./src";

// 代幣審計
const auditor = new TokenAuditor(connection);
const result = await auditor.auditToken(mintAddress);

// 流動性監聽
const monitor = new LiquidityMonitor(connection);
monitor.onLiquidity((event) => {
  console.log(`新池子: ${event.mint}`);
});
await monitor.start();

// Swap 構建
const swapBuilder = new SwapBuilder(connection, wallet);
const tx = await swapBuilder.buildBuyTransaction({
  mint: "TokenAddress",
  amount: 0.1,
  slippage: 50,
  side: "buy"
});

// Jito 發送
const jitoSender = new JitoBundleSender(connection, wallet);
const result = await jitoSender.sendBundle(tx.transaction);

// 止盈止損
const sellStrategy = new SellStrategyManager(connection);
sellStrategy.addPosition(mint, buyPrice, buyAmount, signature);
sellStrategy.onSell((signal) => {
  console.log(`賣出信號: ${signal.type}`);
});
```

## 架構方案

詳見 [狙擊模式實現方案](./docs/sniper-mode_HK.md) | [架構方案文檔](./docs/architecture_HK.md)

## 課程參考

本項目基於 [Solana Sniper Bot 課程](https://academy.soldevcamp.com/course/sniper-bot/) 實現，包含:

1. 狙擊機器人概述與生態基礎
2. 交易生命週期與優先費
3. 監聽鏈上事件 (WebSocket)
4. 代幣安全審計 (Rug Check)
5. 構建交易指令 (Transaction Building)
6. Jito Bundles: 穿越黑暗森林的隱形斗篷
7. 賣出的藝術：止盈與止損
8. 終極組裝：編寫你的第一個狙擊機器人

## ⚠️ 風險警告

**極高風險提示**: 鏈上狙擊是一場零和博弈。

- 99% 的新幣最終歸零
- 代碼錯誤可能導致私鑰洩露或資金被耗盡
- 本項目僅教授技術原理，**絕非投資建議**
- 請在 Devnet 測試網充分測試後再考慮主網部署

## ☕ 捐贈

如果這個項目對你有幫助，歡迎請作者喝杯咖啡 ☕

| 鏈類型 | 地址 |
|--------|------|
| Ethereum (ETH) | `0x2CfBca7DBb0eef8ced407b69C54981fa3348a9Ff` |
| Solana (SOL) | `9tMTcoFRTSCGmhVnsuHCmrguKcCjHyfacm4NbBTcuJ1C` |
| BNB Chain (BNB) | `0x2CfBca7DBb0eef8ced407b69C54981fa3348a9Ff` |

## License

MIT
