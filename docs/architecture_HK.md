[简体中文](./architecture.md) | [English](./architecture_EN.md) | [繁體中文](./architecture_HK.md)

# Solana 狙擊機器人完整架構方案

## 目錄

1. [項目概述](#項目概述)
2. [系統架構設計](#系統架構設計)
3. [核心模組設計](#核心模組設計)
4. [技術棧選擇](#技術棧選擇)
5. [部署方案](#部署方案)
6. [安全策略](#安全策略)
7. [性能優化](#性能優化)
8. [風險控制](#風險控制)
9. [監控與運維](#監控與運維)
10. [開發計劃](#開發計劃)

***

## 項目概述

### 1.1 項目背景

Solana 狙擊機器人是一個高性能的自動化交易系統，專門用於在 Solana 鏈上捕捉新代幣發行機會。在 Solana 這種高性能區塊鏈上，手動交易幾乎無法盈利，因為:

- **速度鴻溝**: 人類操作需要 5-15 秒，而機器人只需 10-200 毫秒
- **競爭激烈**: 全球頂尖量化團隊、黑客和詐騙分子都在競爭
- **高風險**: 99% 的新幣最終歸零，需要嚴格的風控系統

### 1.2 項目目標

- **極速響應**: 在流動性添加的同一區塊內完成買入(毫秒級)
- **安全防護**: 自動識別並規避貔貅盤、Rug Pull 等騙局
- **智能賣出**: 自動化止盈止損策略，最大化收益
- **穩定運行**: 24/7 全天候監控，高可用性架構

### 1.3 核心功能

1. **實時監聽**: 監聽 Pump.fun、Raydium、Meteora 等平台的流動性添加事件
2. **安全審計**: 自動檢測代幣的 Mint Authority、Freeze Authority、LP 鎖定狀態等
3. **交易構建**: 構建包含優先費和 Jito Bundle 的原子交易
4. **智能賣出**: 支持硬止盈止損、移動止損、時間止損等多種策略
5. **倉位管理**: 自動化倉位分配和資金歸集

***

## 系統架構設計

### 2.1 整體架構圖

```
┌─────────────────────────────────────────────────────────────┐
│                      狙擊機器人系統架構                        │
└─────────────────────────────────────────────────────────────┘

┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   配置模組    │      │   監控模組    │      │   安全模組    │
│  (Config)    │──────│  (Monitor)   │──────│  (Security)  │
└──────────────┘      └──────────────┘      └──────────────┘
       │                     │                     │
       │                     │                     │
       └─────────────────────┼─────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   執行模組       │
                    │  (Executor)     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   賣出模組       │
                    │   (Seller)      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   數據模組       │
                    │   (Data)        │
                    └─────────────────┘
```

### 2.2 模組職責劃分

#### 2.2.1 Config 模組 (配置模組)

**職責**: 管理系統配置和環境加載

**核心功能**:

- RPC 連接初始化
- 錢包密鑰加載
- Jito 認證配置
- 策略參數配置
- 環境變量管理

**關鍵配置項**:

```javascript
{
  // RPC 配置
  RPC_URL: "https://api.mainnet-beta.solana.com",
  RPC_ENDPOINT: "wss://api.mainnet-beta.solana.com",

  // 錢包配置
  PRIVATE_KEY: "xxx",
  JITO_AUTH_KEY: "xxx",

  // 策略配置
  BUY_AMOUNT: 0.1,          // 每次買入金額(SOL)
  JITO_TIP: 0.001,          // Jito 小費(SOL)
  TAKE_PROFIT: 2.0,         // 止盈倍數
  STOP_LOSS: 0.5,           // 止損比例
  TRAILING_STOP: 0.2,       // 移動止損回撤比例

  // 安全配置
  MAX_TOP10_HOLDERS: 30,    // 前10持倉佔比上限
  MIN_LP_LOCKED: 95,        // LP鎖定最低比例

  // 性能配置
  COMPUTE_UNIT_LIMIT: 80000,
  COMPUTE_UNIT_PRICE: 150000
}
```

#### 2.2.2 Monitor 模組 (監控模組)

**職責**: 實時監聽鏈上事件，發現交易機會

**核心功能**:

- WebSocket 連接管理
- 鏈上日誌監聽
- 事件過濾與解析
- 信號觸發與分發

**監聽目標**:

1. **Pump.fun**: 監聽 `Create` 指令(Program ID: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`)
2. **Raydium**: 監聽 `initialize2` 指令(Program ID: `675kPX9M1NAe2gk7kh2nar73UyTP8yA202tenuLF5784`)
3. **Meteora DAMM v2**: 監聽流動性池創建事件
4. **Meteora DBC**: 監聽動態綁定曲線創建事件

**技術實現**:

```javascript
// WebSocket 監聽
connection.onLogs(
  PROGRAM_ID,
  ({ logs, err, signature }) => {
    if (err) return;

    // 過濾目標指令
    const isTarget = logs.some(log => log.includes("initialize2"));

    if (isTarget) {
      // 解析交易獲取 Token Mint 地址
      this.emit("signal", signature);
    }
  },
  "processed" // 使用最快承諾級別
);
```

#### 2.2.3 Security 模組 (安全模組)

**職責**: 代幣安全審計，過濾風險代幣

**核心功能**:

- Mint Authority 檢查
- Freeze Authority 檢查
- LP 鎖定狀態檢查
- 籌碼分佈分析
- 交易模擬驗證

**安全評分卡**:

| 檢查項              | 安全標準    | 風險等級        |
| ---------------- | ------- | ----------- |
| Mint Authority   | null    | 🔴 高風險(未放棄) |
| Freeze Authority | null    | 🔴 高風險(貔貅盤) |
| LP 鎖定            | >95% 銷毀 | 🟠 中風險(可撤池) |
| 前10持倉            | <30%    | 🟠 中風險(老鼠倉) |
| 交易模擬             | 成功      | 🔴 高風險(貔貅)  |

**代碼實現**:

```javascript
async function checkTokenSecurity(connection, mintAddress) {
  const mintInfo = await getMint(connection, mintAddress);

  // 檢查 Mint Authority
  if (mintInfo.mintAuthority !== null) {
    return { safe: false, reason: "Mint 權限未放棄" };
  }

  // 檢查 Freeze Authority
  if (mintInfo.freezeAuthority !== null) {
    return { safe: false, reason: "存在凍結權限(貔貅盤)" };
  }

  // 檢查 LP 鎖定狀態
  const lpLocked = await checkLPLocked(mintAddress);
  if (lpLocked < 95) {
    return { safe: false, reason: "LP 未鎖定" };
  }

  // 檢查籌碼分佈
  const top10Holders = await getTop10Holders(mintAddress);
  if (top10Holders > 30) {
    return { safe: false, reason: "籌碼集中度高" };
  }

  // 交易模擬
  const simulation = await simulateTransaction(mintAddress);
  if (simulation.err) {
    return { safe: false, reason: "交易模擬失敗" };
  }

  return { safe: true };
}
```

#### 2.2.4 Executor 模組 (執行模組)

**職責**: 構建並發送交易，完成買入操作

**核心功能**:

- 計算預算設置
- Swap 指令構建
- Jito Bundle 打包
- 交易簽名與發送
- 失敗重試機制

**交易構建流程**:

```
1. 獲取最新 Blockhash
2. 設置 Compute Unit Limit
3. 設置 Compute Unit Price
4. 構建 Swap 指令
5. 構建 Jito Tip 指令
6. 打包成 Versioned Transaction (v0)
7. 簽名交易
8. 發送到 Jito Block Engine
```

**Jito Bundle 優勢**:

- **原子性**: 買入和小費要麼全部成功，要麼全部失敗
- **防夾子**: 通過私密通道發送，MEV 機器人無法看到
- **失敗不付費**: 買入失敗時，小費也不會被扣除

**代碼實現**:

```javascript
async function buildAndSendBundle(tokenMint) {
  // 1. 獲取 Blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  // 2. 構建指令
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 80000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 }),
    await createSwapInstruction(tokenMint),
    createJitoTipInstruction()
  ];

  // 3. 打包交易
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([wallet]);

  // 4. 發送 Bundle
  const bundleId = await jitoClient.sendBundle([transaction]);

  return bundleId;
}
```

#### 2.2.5 Seller 模組 (賣出模組)

**職責**: 自動化賣出策略執行

**核心功能**:

- 價格監控
- 止盈止損判斷
- 賣出交易構建
- 倉位管理

**賣出策略**:

1. **硬止盈止損**:
   - 止盈: 漲幅達到 +100% → 賣出 50%
   - 止損: 跌幅達到 -30% → 全部賣出
2. **移動止損**:
   - 從歷史最高點回撤 20% → 賣出
   - 能吃完大部分漲幅
3. **時間止損**:
   - 買入後 10 分鐘漲幅未超過 20% → 賣出
   - 提高資金利用率

**價格監控實現**:

```javascript
// 方式1: 監聽池子儲備
connection.onAccountChange(POOL_ADDRESS, (accountInfo) => {
  const data = LAYOUT.decode(accountInfo.data);
  const price = data.baseReserve / data.quoteReserve;
  checkStrategy(price);
});

// 方式2: 模擬賣出
async function getCurrentPrice(tokenMint) {
  const simulation = await connection.simulateTransaction(sellTx);
  return simulation.value.returnData;
}
```

#### 2.2.6 Data 模組 (數據模組)

**職責**: 數據存儲與查詢

**核心功能**:

- 交易歷史記錄
- 持倉數據管理
- 性能統計分析
- 緩存管理

***

## 核心模組設計

### 3.1 交易生命週期管理

#### 3.1.1 Solana 節點角色

```
┌──────────────┐
│  RPC 節點    │ ← 接收請求，轉發交易
│  (前台接待)  │
└──────┬───────┘
       │
       │ Gossip 協議
       │
┌──────▼───────┐
│ Validator    │ ← 驗證交易，投票確認
│  (記賬員)    │
└──────┬───────┘
       │
       │ Leader Schedule
       │
┌──────▼───────┐
│   Leader     │ ← 打包區塊(400ms時間槽)
│  (當值班長)  │
└──────────────┘
```

#### 3.1.2 交易傳播路徑

**傳統路徑(慢)**:

```
機器人 → RPC(HTTP) → Gossip廣播 → Leader
延遲: 200-500ms
```

**狙擊路徑(快)**:

```
機器人 → Leader TPU(UDP) → 直接打包
延遲: 10-50ms
```

**Jito 路徑(最快+安全)**:

```
機器人 → Jito Block Engine → Jito Validator
延遲: 10-30ms + 防夾子
```

### 3.2 優先費策略

#### 3.2.1 費用計算公式

```
Total Fee = Base Fee(5000) + Priority Fee
Priority Fee = Compute Unit Limit × Compute Unit Price
```

#### 3.2.2 動態費用策略

```javascript
async function calculatePriorityFee() {
  // 1. 模擬交易獲取精確 CU 消耗
  const simulation = await connection.simulateTransaction(tx);
  const cuConsumed = simulation.value.unitsConsumed;

  // 2. 設置 CU Limit(留餘量)
  const cuLimit = cuConsumed * 1.2;

  // 3. 查詢網絡中位數
  const fees = await connection.getRecentPrioritizationFees();
  const medianFee = calculateMedian(fees);

  // 4. 加價策略
  const price = medianFee * 2;

  return { cuLimit, price };
}
```

### 3.3 WebSocket 監聽優化

#### 3.3.1 承諾級別選擇

| 承諾級別      | 延遲        | 可靠性     | 適用場景     |
| --------- | --------- | ------- | -------- |
| processed | \~0ms     | 低(可能分叉) | **狙擊必須** |
| confirmed | 400-800ms | 中       | 普通轉賬     |
| finalized | 1-2s      | 高       | 重要交易     |

#### 3.3.2 雙跳問題解決方案

**問題**: WebSocket 日誌不包含 Token Mint 地址

**慢速方案**:

```
WebSocket 推送 → HTTP getTransaction → 解析 Mint
延遲: 200ms+
```

**極速方案(Geyser gRPC)**:

```
gRPC Stream → 直接包含 AccountKeys → 本地解析
延遲: 0ms
```

**Geyser 代碼示例**:

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
    // 直接獲取所有賬戶地址
    const accountKeys = data.transaction.transaction.message.accountKeys;
    const mintAddress = accountKeys[1]; // 無需第二次請求
    triggerBuy(mintAddress);
  }
});
```

### 3.4 Jito Bundle 實現

#### 3.4.1 Bundle 原子性

```
Bundle = [買入交易, 小費交易]

規則:
- 全部成功 → 上鏈
- 全部失敗 → 不上鏈
- 絕不會部分成功
```

#### 3.4.2 Jito Tip 賬戶

```javascript
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4bVmkdzGTT4RCgLvtBPvuGZ",
  "Cw8CFyM9FkoPhlbnF5k2E9g2oKjv7q2f8e9x2k5R2i4"
];

// 隨機選擇避免熱點
const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * 3)];
```

***

## 技術棧選擇

### 4.1 核心技術棧

| 類別             | 技術                | 版本     | 說明             |
| -------------- | ----------------- | ------ | -------------- |
| **運行環境**       | Node.js           | 18+    | 高性能異步處理        |
| **區塊鏈 SDK**    | @solana/web3.js   | 2.0+   | Solana 官方 SDK  |
| **代幣操作**       | @solana/spl-token | 0.4+   | SPL Token 操作   |
| **Jito SDK**   | jito-ts           | latest | Jito Bundle 支持 |
| **Geyser 客戶端** | yellowstone-grpc  | latest | 極速數據流          |
| **序列化**        | borsh             | latest | Borsh 序列化      |
| **加密**         | bs58              | latest | Base58 編解碼     |
| **環境管理**       | dotenv            | latest | 環境變量           |

### 4.2 數據存儲

| 類別      | 技術         | 說明        |
| ------- | ---------- | --------- |
| **數據庫** | PostgreSQL | 交易歷史、持倉數據 |
| **緩存**  | Redis      | 實時價格、配置緩存 |
| **日誌**  | Winston    | 結構化日誌記錄   |

### 4.3 監控與運維

| 類別       | 技術                   | 說明     |
| -------- | -------------------- | ------ |
| **監控**   | Prometheus + Grafana | 性能指標監控 |
| **告警**   | AlertManager         | 異常告警通知 |
| **日誌收集** | ELK Stack            | 日誌聚合分析 |

***

## 部署方案

### 5.1 基礎設施分級

#### 5.1.1 Tier 3: 業餘玩家

**配置**:

- 家用電腦 + WiFi
- 免費公共 RPC (Helius Free / QuickNode Free)

**表現**:

- 交易成功率 < 5%
- 延遲: 150-300ms
- 適用: 學習、測試

#### 5.1.2 Tier 2: 專業散戶

**配置**:

- 雲服務器 (AWS / Google Cloud / DigitalOcean)
- **位置**: 東京、阿姆斯特丹、紐約(靠近 Solana 驗證者)
- 付費獨享 RPC

**表現**:

- 延遲: 10-50ms
- 成功率: 30-50%
- 適用: 實戰交易

#### 5.1.3 Tier 1: 頂級掠食者

**配置**:

- 裸金屬服務器 (Bare Metal)
- CPU: AMD EPYC 高主頻
- RAM: 512GB+
- Disk: NVMe RAID 0
- 自建 Solana 驗證者節點 + Geyser 插件

**表現**:

- 延遲: <1ms
- 成功率: 80%+
- 適用: 專業團隊

### 5.2 網絡延遲對比

| 位置       | 距離 Solana 節點 | RTT 延遲 | 成功率    |
| -------- | ------------ | ------ | ------ |
| 家用電腦(上海) | 12,000km     | 240ms  | <5%    |
| 東京服務器    | 1,800km      | 35ms   | 30-50% |
| 本地驗證者    | 0km          | <1ms   | 80%+   |

### 5.3 部署架構

```
┌─────────────────────────────────────────────┐
│              生產環境部署架構                 │
└─────────────────────────────────────────────┘

┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  東京服務器   │    │  紐約服務器   │    │  阿姆斯特丹   │
│  (主節點)    │    │  (備用節點)   │    │  (備用節點)   │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                  ┌────────▼────────┐
                  │   負載均衡器     │
                  │  (HAProxy)      │
                  └────────┬────────┘
                           │
                  ┌────────▼────────┐
                  │   應用集群       │
                  │  (Node.js)      │
                  └────────┬────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
│ PostgreSQL   │  │    Redis     │  │  Prometheus  │
│  (主數據庫)   │  │   (緩存)     │  │   (監控)     │
└──────────────┘  └──────────────┘  └──────────────┘
```

### 5.4 軟件層面優化

#### 5.4.1 UDP 緩衝區優化

```bash
# Linux 內核參數調優
sudo sysctl -w net.core.rmem_max=26214400
sudo sysctl -w net.core.wmem_max=26214400
sudo sysctl -w net.core.rmem_default=26214400
sudo sysctl -w net.core.wmem_default=26214400
```

#### 5.4.2 Jito Block Engine 選擇

```javascript
// 根據服務器位置選擇最近的 Jito 引擎
const JITO_ENDPOINTS = {
  tokyo: "tokyo.mainnet.block-engine.jito.wtf",
  amsterdam: "amsterdam.mainnet.block-engine.jito.wtf",
  ny: "ny.mainnet.block-engine.jito.wtf"
};

// 東京服務器連接東京引擎
const jitoEndpoint = JITO_ENDPOINTS.tokyo;
```

***

## 安全策略

### 6.1 代幣安全審計

#### 6.1.1 硬編碼風險檢查

```javascript
async function checkHardcodedRisks(mintAddress) {
  const mintInfo = await getMint(connection, mintAddress);

  const risks = [];

  // 1. Mint Authority
  if (mintInfo.mintAuthority !== null) {
    risks.push({
      level: "HIGH",
      type: "MINT_AUTHORITY",
      message: "項方可無限增發代幣"
    });
  }

  // 2. Freeze Authority
  if (mintInfo.freezeAuthority !== null) {
    risks.push({
      level: "HIGH",
      type: "FREEZE_AUTHORITY",
      message: "項方可凍結賬戶(貔貅盤)"
    });
  }

  return risks;
}
```

#### 6.1.2 流動性陷阱檢查

```javascript
async function checkLiquidityTrap(mintAddress) {
  // 檢查 LP Token 是否鎖定
  const lpTokenAccount = await getLPTokenAccount(mintAddress);

  // LP Token 鎖定方式:
  // 1. 銷毀(Burn): 發送到 dead 地址
  // 2. 鎖定(Lock): 發送到鎖定合約

  const burntAmount = await checkBurntLP(lpTokenAccount);
  const lockedAmount = await checkLockedLP(lpTokenAccount);

  const totalLocked = burntAmount + lockedAmount;
  const lockedPercentage = totalLocked / totalSupply * 100;

  if (lockedPercentage < 95) {
    return {
      safe: false,
      reason: "LP 鎖定比例過低，可能撤池跑路"
    };
  }

  return { safe: true };
}
```

#### 6.1.3 籌碼分佈分析

```javascript
async function analyzeTokenDistribution(mintAddress) {
  const holders = await getTokenHolders(mintAddress);

  // 1. 計算前10持倉佔比
  const top10Balance = holders.slice(0, 10)
    .reduce((sum, h) => sum + h.balance, 0);
  const top10Percentage = top10Balance / totalSupply * 100;

  // 2. 檢查老鼠倉(捆綁買入)
  const bundledWallets = await detectBundledWallets(holders.slice(0, 10));

  if (top10Percentage > 30) {
    return {
      safe: false,
      reason: "籌碼高度集中，可能老鼠倉"
    };
  }

  if (bundledWallets.length > 5) {
    return {
      safe: false,
      reason: "檢測到捆綁買入，項目方持幣"
    };
  }

  return { safe: true };
}
```

#### 6.1.4 交易模擬驗證

```javascript
async function simulateTransactionSafety(mintAddress) {
  // 1. 模擬買入
  const buySimulation = await connection.simulateTransaction(buyTx);

  if (buySimulation.value.err) {
    return { safe: false, reason: "買入模擬失敗" };
  }

  // 2. 模擬賣出(關鍵!)
  const sellSimulation = await connection.simulateTransaction(sellTx);

  if (sellSimulation.value.err) {
    return { safe: false, reason: "賣出失敗，貔貅盤!" };
  }

  // 3. 檢查轉賬稅
  const buyAmount = buySimulation.value.returnData;
  const sellAmount = sellSimulation.value.returnData;

  if (sellAmount < buyAmount * 0.9) {
    return {
      safe: false,
      reason: "轉賬稅過高，買入後賣出損失大"
    };
  }

  return { safe: true };
}
```

### 6.2 資金安全策略

#### 6.2.1 資金隔離

```javascript
// 主錢包(冷錢包): 存儲大部分資金
const coldWallet = LedgerWallet;

// 狙擊錢包(熱錢包): 每天轉入少量資金
const hotWallet = Keypair.generate();

// 每天轉入 5-10 SOL 作為彈藥
async function dailyFundTransfer() {
  const amount = 5; // SOL
  await transfer(coldWallet, hotWallet, amount);
}
```

#### 6.2.2 自動歸集

```javascript
// 當熱錢包餘額超過閾值，自動歸集到冷錢包
async function autoSweep() {
  const balance = await getBalance(hotWallet);
  const threshold = 20; // SOL

  if (balance > threshold) {
    const sweepAmount = balance - threshold;
    await transfer(hotWallet, coldWallet, sweepAmount);
    log.info(`自動歸集 ${sweepAmount} SOL 到冷錢包`);
  }
}
```

#### 6.2.3 私鑰管理

```javascript
// 使用環境變量，絕不硬編碼
import dotenv from "dotenv";
dotenv.config();

const privateKey = process.env.PRIVATE_KEY;

//更高級: 使用 AWS KMS
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

### 6.3 網絡安全

```bash
# 雲服務器防火牆配置
# 只開放 SSH(22) 端口，限制 IP

# 1. 安裝 UFW
sudo apt install ufw

# 2. 允許 SSH(僅限你的 IP)
sudo ufw allow from YOUR_IP to any port 22

# 3. 啟用防火牆
sudo ufw enable

# 4. 檢查狀態
sudo ufw status
```

***

## 性能優化

### 7.1 交易構建優化

#### 7.1.1 Compute Unit 精確設置

```javascript
// 1. 先模擬獲取精確消耗
const simulation = await connection.simulateTransaction(tx);
const cuConsumed = simulation.value.unitsConsumed;

// 2. 設置 Limit(留 20% 餘量)
const cuLimit = Math.ceil(cuConsumed * 1.2);

// 3. 添加指令
tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));
```

#### 7.1.2 優先費動態調整

```javascript
async function getOptimalPriorityFee() {
  // 查詢過去 5 個區塊的費用
  const fees = await connection.getRecentPrioritizationFees(
    [PROGRAM_ID],
    5
  );

  // 計算中位數
  const sorted = fees.map(f => f.priorityFee).sort();
  const median = sorted[Math.floor(sorted.length / 2)];

  // 加倍策略(確保插隊)
  return median * 2;
}
```

### 7.2 網絡優化

#### 7.2.1 WebSocket 連接池

```javascript
// 保持多個 WebSocket 連接，避免單點故障
const connections = [
  new Connection(RPC_URL_1, { wsEndpoint: WSS_URL_1 }),
  new Connection(RPC_URL_2, { wsEndpoint: WSS_URL_2 }),
  new Connection(RPC_URL_3, { wsEndpoint: WSS_URL_3 })
];

// 負載均衡
function getRandomConnection() {
  return connections[Math.floor(Math.random() * connections.length)];
}
```

#### 7.2.2 交易發送策略

```javascript
// 狙擊模式: 跳過預檢，直接發送
async function sendSniperTransaction(tx) {
  const rawTx = tx.serialize();

  // 1. 發送到多個 RPC(並行)
  const promises = connections.map(conn =>
    conn.sendRawTransaction(rawTx, {
      skipPreflight: true,  // 跳過預檢
      maxRetries: 0        // 不自動重試
    })
  );

  // 2. 同時發送到 Jito
  promises.push(jitoClient.sendBundle([tx]));

  // 3. 等待任一成功
  const result = await Promise.any(promises);

  return result;
}
```

### 7.3 數據處理優化

#### 7.3.1 緩存策略

```javascript
// Redis 緩存常用數據
import Redis from "ioredis";
const redis = new Redis();

// 緩存 Blockhash(有效期 30 秒)
async function getCachedBlockhash() {
  const cached = await redis.get("blockhash");
  if (cached) return cached;

  const { blockhash } = await connection.getLatestBlockhash();
  await redis.set("blockhash", blockhash, "EX", 30);

  return blockhash;
}

// 緩存優先費(有效期 5 秒)
async function getCachedPriorityFee() {
  const cached = await redis.get("priorityFee");
  if (cached) return parseInt(cached);

  const fee = await getOptimalPriorityFee();
  await redis.set("priorityFee", fee, "EX", 5);

  return fee;
}
```

#### 7.3.2 批量查詢優化

```javascript
// 批量獲取多個代幣信息
async function batchGetTokenInfo(mintAddresses) {
  // 使用 getMultipleAccountsInfo 批量查詢
  const accounts = await connection.getMultipleAccountsInfo(
    mintAddresses.map(addr => new PublicKey(addr))
  );

  return accounts.map(acc => decodeTokenInfo(acc.data));
}
```

***

## 風險控制

### 8.1 交易風險控制

#### 8.1.1 滑點管理

```javascript
// 動態滑點設置
function calculateSlippage(priceVolatility) {
  // 高波動: 設置 50-100% 滑點
  if (volatility > 0.5) {
    return 1.0; // 100% 滑點(Degen 模式)
  }

  // 中等波動: 20-30% 滑點
  if (volatility > 0.2) {
    return 0.3;
  }

  // 低波動: 10% 滑點
  return 0.1;
}
```

#### 8.1.2 失敗重試策略

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
      log.warn(`第 ${i+1} 次嘗試失敗: ${error.message}`);

      // 更新 Blockhash 和優先費
      tx.recentBlockhash = await getCachedBlockhash();
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: await getCachedPriorityFee()
      }));

      // 等待 100ms 後重試
      await sleep(100);
    }
  }

  throw new Error("所有重試失敗");
}
```

### 8.2 系統風險控制

#### 8.2.1 異常處理

```javascript
// 全局異常捕獲
process.on("uncaughtException", (error) => {
  log.error("未捕獲異常:", error);
  // 發送告警
  sendAlert("CRITICAL", error.message);
  // 優雅退出
  gracefulShutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  log.error("未處理的 Promise 拒絕:", reason);
  sendAlert("HIGH", reason);
});
```

#### 8.2.2 限流保護

```javascript
import { RateLimiter } from "limiter";

// RPC 請求限流(避免被拒絕)
const rpcLimiter = new RateLimiter({
  tokensPerInterval: 100,
  interval: "second"
});

async function safeRpcCall(fn) {
  await rpcLimiter.removeTokens(1);
  return fn();
}
```

#### 8.2.3 健康檢查

```javascript
// 定期健康檢查
async function healthCheck() {
  const checks = {
    rpc: await checkRpcConnection(),
    wallet: await checkWalletBalance(),
    redis: await checkRedisConnection(),
    db: await checkDatabaseConnection()
  };

  const allHealthy = Object.values(checks).every(c => c);

  if (!allHealthy) {
    sendAlert("HIGH", "系統健康檢查失敗");
  }

  return checks;
}

// 每 30 秒檢查一次
setInterval(healthCheck, 30000);
```

***

## 監控與運維

### 9.1 性能指標監控

#### 9.1.1 關鍵指標

| 指標           | 說明         | 告警閾值   |
| ------------ | ---------- | ------ |
| **交易成功率**    | 成功交易佔比     | <30%   |
| **平均延遲**     | 從發現到買入的時間  | >100ms |
| **RPC 響應時間** | RPC 請求延遲   | >50ms  |
| **錢包餘額**     | 熱錢包 SOL 餘額 | <2 SOL |
| **持倉數量**     | 當前持倉代幣數    | >20    |
| **浮盈浮虧**     | 當前持倉總盈虧    | <-50%  |

#### 9.1.2 Prometheus 指標

```javascript
import { Counter, Histogram, Gauge } from "prom-client";

// 交易計數器
const txCounter = new Counter({
  name: "sniper_transactions_total",
  help: "Total transactions executed",
  labelNames: ["status", "type"]
});

// 延遲直方圖
const latencyHistogram = new Histogram({
  name: "sniper_latency_ms",
  help: "Transaction latency in milliseconds",
  buckets: [10, 50, 100, 200, 500, 1000]
});

// 餘額儀表
const balanceGauge = new Gauge({
  name: "sniper_wallet_balance",
  help: "Current wallet balance in SOL"
});

// 記錄指標
txCounter.inc({ status: "success", type: "buy" });
latencyHistogram.observe(50);
balanceGauge.set(5.2);
```

### 9.2 日誌管理

#### 9.2.1 結構化日誌

```javascript
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // 文件日誌
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),

    // 控制台日誌
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// 關鍵事件日誌
logger.info("發現新幣", {
  mint: mintAddress,
  signature: sig,
  latency: 50
});

logger.error("交易失敗", {
  mint: mintAddress,
  error: err.message,
  retries: 3
});
```

### 9.3 告警系統

#### 9.3.1 告警規則

```yaml
# Prometheus AlertManager 規則
groups:
  - name: sniper_alerts
    rules:
      # 交易成功率過低
      - alert: LowSuccessRate
        expr: rate(sniper_transactions_total{status="success"}[5m]) / rate(sniper_transactions_total[5m]) < 0.3
        for: 5m
        annotations:
          summary: "交易成功率低於 30%"

      # 延遲過高
      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(sniper_latency_ms_bucket[5m])) > 100
        for: 2m
        annotations:
          summary: "95% 交易延遲超過 100ms"

      # 錢包餘額過低
      - alert: LowBalance
        expr: sniper_wallet_balance < 2
        for: 1m
        annotations:
          summary: "錢包餘額低於 2 SOL"
```

#### 9.3.2 告警通知

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

### 9.4 自動化運維

#### 9.4.1 自動重啟

```javascript
// PM2 配置 ecosystem.config.js
module.exports = {
  apps: [{
    name: "sniper-bot",
    script: "index.js",

    // 自動重啟
    watch: false,
    max_memory_restart: "500M",

    // 重啟策略
    restart_delay: 1000,
    max_restarts: 10,

    // 環境變量
    env: {
      NODE_ENV: "production",
      RPC_URL: "https://...",
      PRIVATE_KEY: "..."
    },

    // 日誌
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    error_file: "logs/error.log",
    out_file: "logs/out.log"
  }]
};
```

#### 9.4.2 定時任務

```javascript
import cron from "node-cron";

// 每天凌晨 2 點歸集資金
cron.schedule("0 2 * * *", async () => {
  await autoSweep();
  logger.info("資金歸集完成");
});

// 每小時檢查持倉
cron.schedule("0 * * * *", async () => {
  await checkHoldings();
  logger.info("持倉檢查完成");
});

// 每 5 分鐘更新配置
cron.schedule("*/5 * * * *", async () => {
  await updateConfig();
  logger.info("配置更新完成");
});
```

***

## 開發計劃

### 10.1 開發階段劃分

#### Phase 1: 基礎架構搭建(2週)

**任務清單**:

- [x] 項目初始化
- [x] 配置模組開發
- [x] RPC 連接管理
- [x] 錢包管理
- [x] 日誌系統搭建

**交付物**:

- 可運行的基礎框架
- 配置管理系統
- 基礎日誌記錄

#### Phase 2: 監控與安全模組(3週)

**任務清單**:

- [x] WebSocket 監聽實現
- [x] Pump.fun 監聽
- [x] Raydium 監聽
- [x] 安全審計模組
- [x] 交易模擬驗證

**交付物**:

- 實時鏈上監聽系統
- 完整的安全審計流程
- 貔貅盤識別功能

#### Phase 3: 交易執行模組(3週)

**任務清單**:

- [x] 交易構建邏輯
- [x] Compute Budget 管理
- [x] Swap 指令構建
- [x] Jito Bundle 實現
- [x] 優先費動態調整

**交付物**:

- 完整的交易構建系統
- Jito Bundle 集成
- 動態費用策略

#### Phase 4: 賣出策略模組(2週)

**任務清單**:

- [x] 價格監控實現
- [x] 止盈止損邏輯
- [x] 移動止損
- [x] 時間止損
- [x] 倉位管理

**交付物**:

- 自動化賣出系統
- 多策略支持
- 倉位管理功能

#### Phase 5: 性能優化與部署(2週)

**任務清單**:

- [x] 性能優化
- [x] 緩存系統
- [x] 監控系統集成
- [x] 生產環境部署
- [x] 壓力測試

**交付物**:

- 高性能生產系統
- 完整監控體系
- 部署文檔

#### Phase 6: 運維與迭代(持續)

**任務清單**:

- [x] 監控告警完善
- [x] 異常處理優化
- [x] 新平台支持(Meteora)
- [x] 策略優化
- [x] 文檔完善

**交付物**:

- 穩定運行的系統
- 完善的運維體系
- 持續迭代更新

***

## 總結

本架構方案提供了一個完整的 Solana 狙擊機器人系統設計，涵蓋了從基礎架構、核心模組、技術選型、部署方案、安全策略、性能優化、風險控制到監控運維的全方位內容。

**核心優勢**:

1. **模組化設計**: 清晰的模組劃分，易於維護和擴展
2. **安全優先**: 多層安全審計，有效規避貔貅盤和 Rug Pull
3. **性能極致**: 通過 Geyser、Jito、優化配置實現毫秒級響應
4. **自動化運維**: 完善的監控告警和自動化腳本

**風險提示**:

- 鏈上狙擊是零和博弈，競爭極其激烈
- 99% 的新幣最終歸零，需要嚴格風控
- 代碼錯誤可能導致私鑰洩露或資金損失
- **請在 Devnet 測試網充分測試後再考慮主網部署**

**下一步行動**:

1. 按照開發計劃逐步實現各模組
2. 在 Devnet 進行完整測試
3. 部署到東京等靠近 Solana 節點的服務器
4. 持續監控和優化系統性能

***

**文檔版本**: v1.0
**最後更新**: 2026-06-16
**作者**: Sniper Bot Team
**參考教程**: SolDevCamp - Solana 狙擊機器人開發課程
