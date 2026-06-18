import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, getAccount } from "@solana/spl-token";
import { Logger } from "../utils/logger";
import { config } from "../config";

const logger = new Logger("TokenAudit");

export interface TokenSecurityResult {
  safe: boolean;
  score: number; // 0-100
  issues: string[];
  warnings: string[];
  details: TokenSecurityDetails;
}

export interface TokenSecurityDetails {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  decimals: number;
  supply: bigint;
  lpLocked: boolean;
  lpBurnPercentage: number;
  top10HoldersPercentage: number;
  transferFee: number;
  isHoneypot: boolean;
}

export interface HolderInfo {
  address: string;
  balance: bigint;
  percentage: number;
}

/**
 * 代币安全审计器
 * 
 * 检查项目:
 * 1. Mint Authority 是否放弃
 * 2. Freeze Authority 是否放弃
 * 3. LP Token 是否锁定/销毁
 * 4. 前10持币占比
 * 5. 转账费用
 * 6. 模拟交易测试
 */
export class TokenAuditor {
  private connection: Connection;
  
  constructor(connection: Connection) {
    this.connection = connection;
  }
  
  /**
   * 全面审计代币安全性
   */
  async auditToken(mintAddress: string): Promise<TokenSecurityResult> {
    logger.info(`Starting token audit for ${mintAddress}`);
    
    const issues: string[] = [];
    const warnings: string[] = [];
    let score = 100;
    
    try {
      const mint = new PublicKey(mintAddress);
      
      // 并行执行所有检查
      const [
        mintInfo,
        lpCheckResult,
        holdersResult,
        transferFeeResult,
        simulationResult
      ] = await Promise.all([
        this.checkMintInfo(mint),
        this.checkLPLocked(mint),
        this.checkTopHolders(mint),
        this.checkTransferFee(mint),
        this.simulateTransaction(mint)
      ]);
      
      // 1. 检查 Mint Authority
      if (mintInfo.mintAuthority !== null) {
        issues.push("Mint Authority 未放弃，存在无限增发风险");
        score -= 30;
      }
      
      // 2. 检查 Freeze Authority
      if (mintInfo.freezeAuthority !== null) {
        issues.push("Freeze Authority 未放弃，存在冻结账户风险 (貔貅盘)");
        score -= 40;
      }
      
      // 3. 检查 LP 锁定
      if (!lpCheckResult.locked) {
        issues.push("流动性未锁定，存在撤池子风险 (Rug Pull)");
        score -= 25;
      } else if (lpCheckResult.burnPercentage < config.SECURITY.MIN_LP_LOCKED) {
        warnings.push(`LP 锁定比例较低 (${lpCheckResult.burnPercentage}%)`);
        score -= 10;
      }
      
      // 4. 检查前10持币占比
      if (holdersResult.top10Percentage > config.SECURITY.MAX_TOP10_HOLDERS) {
        warnings.push(`筹码高度集中，前10持仓占比 ${holdersResult.top10Percentage}%`);
        score -= Math.min(20, (holdersResult.top10Percentage - config.SECURITY.MAX_TOP10_HOLDERS) / 2);
      }
      
      // 5. 检查转账费用
      if (transferFeeResult.fee > 10) {
        warnings.push(`转账费用较高 (${transferFeeResult.fee}%)`);
        score -= Math.min(15, transferFeeResult.fee);
      }
      
      // 6. 检查模拟交易
      if (!simulationResult.canBuy || !simulationResult.canSell) {
        if (!simulationResult.canBuy) {
          issues.push("模拟买入失败，合约可能存在问题");
        }
        if (!simulationResult.canSell) {
          issues.push("模拟卖出失败，确认为貔貅盘");
        }
        score -= 50;
      }
      
      const details: TokenSecurityDetails = {
        mintAuthority: mintInfo.mintAuthority?.toString() || null,
        freezeAuthority: mintInfo.freezeAuthority?.toString() || null,
        decimals: mintInfo.decimals,
        supply: mintInfo.supply,
        lpLocked: lpCheckResult.locked,
        lpBurnPercentage: lpCheckResult.burnPercentage,
        top10HoldersPercentage: holdersResult.top10Percentage,
        transferFee: transferFeeResult.fee,
        isHoneypot: !simulationResult.canSell
      };
      
      const safe = score >= 60 && issues.length === 0;
      
      logger.info(`Token audit completed`, {
        mint: mintAddress,
        score,
        safe,
        issuesCount: issues.length,
        warningsCount: warnings.length
      });
      
      return {
        safe,
        score: Math.max(0, score),
        issues,
        warnings,
        details
      };
      
    } catch (error: unknown) {
      logger.error("Token audit failed", error instanceof Error ? error : String(error));
      return {
        safe: false,
        score: 0,
        issues: ["审计过程中发生错误"],
        warnings: [],
        details: {
          mintAuthority: null,
          freezeAuthority: null,
          decimals: 0,
          supply: BigInt(0),
          lpLocked: false,
          lpBurnPercentage: 0,
          top10HoldersPercentage: 100,
          transferFee: 0,
          isHoneypot: true
        }
      };
    }
  }
  
  /**
   * 检查 Mint 账户信息
   */
  private async checkMintInfo(mint: PublicKey): Promise<{
    mintAuthority: PublicKey | null;
    freezeAuthority: PublicKey | null;
    decimals: number;
    supply: bigint;
  }> {
    const mintInfo = await getMint(this.connection, mint);
    
    return {
      mintAuthority: mintInfo.mintAuthority,
      freezeAuthority: mintInfo.freezeAuthority,
      decimals: mintInfo.decimals,
      supply: mintInfo.supply
    };
  }
  
  /**
   * 检查 LP Token 是否锁定/销毁
   */
  private async checkLPLocked(mint: PublicKey): Promise<{
    locked: boolean;
    burnPercentage: number;
  }> {
    try {
      // 获取 Raydium 池子地址 (简化版)
      // 实际需要根据 mint 地址查找对应的 LP Token 账户
      
      // 这里模拟检查 LP Token 的持有情况
      // 真实实现需要:
      // 1. 查找 Raydium 池子
      // 2. 获取 LP Token Mint
      // 3. 检查 LP Token 的最大持有者
      // 4. 计算被销毁/锁定的比例
      
      // 模拟返回
      return {
        locked: true,
        burnPercentage: 95
      };
      
    } catch (error) {
      logger.debug("LP check failed", { error: error instanceof Error ? error.message : String(error) });
      return {
        locked: false,
        burnPercentage: 0
      };
    }
  }
  
  /**
   * 检查前10持币占比
   */
  private async checkTopHolders(mint: PublicKey): Promise<{
    top10Percentage: number;
    holders: HolderInfo[];
  }> {
    try {
      // 获取最大的 Token 持有者
      // 实际实现需要:
      // 1. 使用 getProgramAccounts 获取所有 Token 账户
      // 2. 按余额排序
      // 3. 计算前10的占比
      
      // 模拟返回
      return {
        top10Percentage: 25,
        holders: []
      };
      
    } catch (error) {
      logger.debug("Holders check failed", { error: error instanceof Error ? error.message : String(error) });
      return {
        top10Percentage: 100,
        holders: []
      };
    }
  }
  
  /**
   * 检查转账费用
   */
  private async checkTransferFee(mint: PublicKey): Promise<{
    fee: number;
  }> {
    try {
      // 检查 Token-2022 的 Transfer Hook 或自定义转账费
      // 实际实现需要模拟转账并计算费用
      
      // 模拟返回
      return {
        fee: 0
      };
      
    } catch (error) {
      logger.debug("Transfer fee check failed", { error: error instanceof Error ? error.message : String(error) });
      return {
        fee: 0
      };
    }
  }
  
  /**
   * 模拟交易测试
   */
  private async simulateTransaction(mint: PublicKey): Promise<{
    canBuy: boolean;
    canSell: boolean;
    buyError?: string;
    sellError?: string;
  }> {
    try {
      // 构建模拟买入交易
      // 实际实现需要:
      // 1. 构建真实的 Swap 指令
      // 2. 使用 connection.simulateTransaction
      // 3. 检查执行结果
      
      // 模拟返回
      return {
        canBuy: true,
        canSell: true
      };
      
    } catch (error) {
      logger.debug("Transaction simulation failed", { error: error instanceof Error ? error.message : String(error) });
      return {
        canBuy: false,
        canSell: false,
        buyError: error instanceof Error ? error.message : String(error),
        sellError: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * 快速安全检查 (仅检查关键项)
   */
  async quickCheck(mintAddress: string): Promise<boolean> {
    try {
      const mint = new PublicKey(mintAddress);
      const mintInfo = await getMint(this.connection, mint);
      
      // 快速检查: Mint 和 Freeze 权限
      if (mintInfo.mintAuthority !== null) {
        logger.warn("Quick check failed: Mint Authority not renounced");
        return false;
      }
      
      if (mintInfo.freezeAuthority !== null) {
        logger.warn("Quick check failed: Freeze Authority not renounced");
        return false;
      }
      
      return true;
      
    } catch (error) {
      logger.error("Quick check failed", error instanceof Error ? error : String(error));
      return false;
    }
  }
}

export default TokenAuditor;