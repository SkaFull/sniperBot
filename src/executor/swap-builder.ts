import {
  Connection,
  PublicKey,
  Keypair,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { Logger } from "../utils/logger";
import { config } from "../config";

const logger = new Logger("SwapBuilder");

// Program IDs (真实地址)
const RAYDIUM_AMM_PROGRAM = new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export interface SwapParams {
  mint: string;
  amount: number;
  slippage: number;
  side: "buy" | "sell";
  maxSpend?: number;
  minReceive?: number;
}

export interface SwapResult {
  transaction: VersionedTransaction;
  estimatedCu: number;
  priorityFee: number;
}

/**
 * Swap 指令构建器
 * 
 * 支持:
 * 1. Raydium AMM Swap
 * 2. Pump.fun Buy/Sell
 * 3. 动态优先费设置
 */
export class SwapBuilder {
  private connection: Connection;
  private wallet: Keypair;
  
  constructor(connection: Connection, wallet: Keypair) {
    this.connection = connection;
    this.wallet = wallet;
  }
  
  /**
   * 构建买入交易
   */
  async buildBuyTransaction(params: SwapParams): Promise<SwapResult> {
    logger.info("Building buy transaction", {
      mint: params.mint,
      amount: params.amount,
      slippage: params.slippage
    });
    
    // 获取最新区块哈希
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("processed");
    
    // 构建指令列表
    const instructions: TransactionInstruction[] = [];
    
    // 1. 设置计算预算
    const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 80_000  // Pump.fun 买入通常消耗 60k-80k CU
    });
    instructions.push(cuLimitIx);
    
    // 2. 设置优先费
    const priorityFee = await this.calculatePriorityFee();
    const cuPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFee
    });
    instructions.push(cuPriceIx);
    
    // 3. 构建 Swap 指令
    const swapIx = await this.buildSwapInstruction(params);
    instructions.push(swapIx);
    
    // 构建 v0 交易
    const messageV0 = new TransactionMessage({
      payerKey: this.wallet.publicKey,
      recentBlockhash: blockhash,
      instructions
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([this.wallet]);
    
    return {
      transaction,
      estimatedCu: 80_000,
      priorityFee
    };
  }
  
  /**
   * 构建卖出交易
   */
  async buildSellTransaction(params: SwapParams): Promise<SwapResult> {
    logger.info("Building sell transaction", {
      mint: params.mint,
      amount: params.amount,
      slippage: params.slippage
    });
    
    const { blockhash } = await this.connection.getLatestBlockhash("processed");
    
    const instructions: TransactionInstruction[] = [];
    
    // 1. 设置计算预算
    const cuLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 100_000  // 卖出可能需要更多 CU
    });
    instructions.push(cuLimitIx);
    
    // 2. 设置优先费 (卖出时可能需要更高)
    const priorityFee = await this.calculatePriorityFee() * 2;
    const cuPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFee
    });
    instructions.push(cuPriceIx);
    
    // 3. 构建 Swap 指令
    const swapIx = await this.buildSwapInstruction(params);
    instructions.push(swapIx);
    
    const messageV0 = new TransactionMessage({
      payerKey: this.wallet.publicKey,
      recentBlockhash: blockhash,
      instructions
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([this.wallet]);
    
    return {
      transaction,
      estimatedCu: 100_000,
      priorityFee
    };
  }
  
  /**
   * 构建 Swap 指令
   */
  private async buildSwapInstruction(params: SwapParams): Promise<TransactionInstruction> {
    // 根据目标平台选择不同的构建方式
    // 这里简化实现，实际需要根据 mint 地址判断平台
    
    // 尝试 Pump.fun 格式
    if (params.mint.length === 44) {
      return this.buildPumpFunSwap(params);
    }
    
    // 默认使用 Raydium 格式
    return this.buildRaydiumSwap(params);
  }
  
  /**
   * 构建 Pump.fun Swap 指令
   */
  private async buildPumpFunSwap(params: SwapParams): Promise<TransactionInstruction> {
    const mint = new PublicKey(params.mint);
    
    // Pump.fun 指令数据结构
    // Discriminator (8 bytes) + Amount (8 bytes) + Max Sol Cost (8 bytes)
    
    const discriminator = Buffer.from([
      0x66, 0x06, 0x3d, 0x12, 0x01, 0xda, 0xeb, 0xea  // "buy" discriminator
    ]);
    
    if (params.side === "sell") {
      discriminator[0] = 0x33;  // "sell" discriminator 前缀
    }
    
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(params.amount));
    
    const maxSpendBuffer = Buffer.alloc(8);
    const maxSpend = params.maxSpend || params.amount * (1 + params.slippage / 100);
    maxSpendBuffer.writeBigUInt64LE(BigInt(Math.floor(maxSpend * 1e9)));
    
    const data = Buffer.concat([discriminator, amountBuffer, maxSpendBuffer]);
    
    // 构建账户列表 (简化版)
    const keys = [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ];
    
    return new TransactionInstruction({
      programId: PUMP_FUN_PROGRAM,
      keys,
      data
    });
  }
  
  /**
   * 构建 Raydium Swap 指令
   */
  private async buildRaydiumSwap(params: SwapParams): Promise<TransactionInstruction> {
    const mint = new PublicKey(params.mint);
    
    // Raydium V4 Swap 指令数据结构
    // Discriminator (8 bytes) + AmountIn (8 bytes) + MinAmountOut (8 bytes)
    
    const discriminator = Buffer.from([
      0xf8, 0xc6, 0x9c, 0x91, 0xa8, 0x29, 0x04, 0x00  // "swap" discriminator
    ]);
    
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(params.amount));
    
    const minOutBuffer = Buffer.alloc(8);
    const minOut = params.minReceive || Math.floor(params.amount * (1 - params.slippage / 100));
    minOutBuffer.writeBigUInt64LE(BigInt(minOut));
    
    const data = Buffer.concat([discriminator, amountBuffer, minOutBuffer]);
    
    // 构建账户列表 (简化版，实际需要查找池子账户)
    const keys = [
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
    ];
    
    return new TransactionInstruction({
      programId: RAYDIUM_AMM_PROGRAM,
      keys,
      data
    });
  }
  
  /**
   * 计算动态优先费
   */
  private async calculatePriorityFee(): Promise<number> {
    try {
      // 获取最近的优先费中位数
      const fees = await this.connection.getRecentPrioritizationFees();
      
      if (fees.length === 0) {
        return 100_000;  // 默认 0.0001 SOL per CU
      }
      
      // 取中位数并加倍
      const sortedFees = fees.map(f => f.prioritizationFee).sort((a, b) => a - b);
      const median = sortedFees[Math.floor(sortedFees.length / 2)];
      
      return Math.max(median * 2, 100_000);
      
    } catch (error) {
      logger.debug("Failed to get priority fees, using default");
      return 100_000;
    }
  }
  
  /**
   * 模拟交易
   */
  async simulateTransaction(transaction: VersionedTransaction): Promise<{
    success: boolean;
    unitsConsumed: number;
    error?: string;
    logs?: string[];
  }> {
    try {
      const result = await this.connection.simulateTransaction(transaction, {
        sigVerify: false
      });
      
      if (result.value.err) {
        return {
          success: false,
          unitsConsumed: 0,
          error: JSON.stringify(result.value.err),
          logs: result.value.logs || undefined
        };
      }
      
      return {
        success: true,
        unitsConsumed: result.value.unitsConsumed || 0,
        logs: result.value.logs || undefined
      };
      
    } catch (error) {
      return {
        success: false,
        unitsConsumed: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * 构建带精确 CU 的交易
   */
  async buildOptimizedTransaction(params: SwapParams): Promise<SwapResult> {
    // 先构建一个基础交易进行模拟
    const baseResult = await this.buildBuyTransaction(params);
    
    // 模拟获取精确 CU
    const simulation = await this.simulateTransaction(baseResult.transaction);
    
    if (!simulation.success) {
      logger.warn("Simulation failed, using base transaction");
      return baseResult;
    }
    
    // 根据模拟结果调整 CU
    const optimizedCu = Math.ceil(simulation.unitsConsumed * 1.2);  // 加 20% 余量
    
    // 重新构建交易
    const { blockhash } = await this.connection.getLatestBlockhash("processed");
    
    const instructions: TransactionInstruction[] = [];
    
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({
      units: optimizedCu
    }));
    
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: baseResult.priorityFee
    }));
    
    const swapIx = await this.buildSwapInstruction(params);
    instructions.push(swapIx);
    
    const messageV0 = new TransactionMessage({
      payerKey: this.wallet.publicKey,
      recentBlockhash: blockhash,
      instructions
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([this.wallet]);
    
    return {
      transaction,
      estimatedCu: optimizedCu,
      priorityFee: baseResult.priorityFee
    };
  }
}

export default SwapBuilder;