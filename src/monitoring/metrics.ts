import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const register = new Registry();

// Leader 更新计数
export const leaderUpdateCounter = new Counter({
  name: "sniper_leader_updates_total",
  help: "Total number of leader updates",
  registers: [register]
});

// Leader 更新延迟
export const leaderUpdateLatency = new Histogram({
  name: "sniper_leader_update_latency_ms",
  help: "Leader update latency in milliseconds",
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
  registers: [register]
});

// TPU 发送计数
export const tpuSendCounter = new Counter({
  name: "sniper_tpu_send_total",
  help: "Total number of TPU sends",
  labelNames: ["success", "leader"],
  registers: [register]
});

// TPU 发送延迟
export const tpuSendLatency = new Histogram({
  name: "sniper_tpu_send_latency_ms",
  help: "TPU send latency in milliseconds",
  buckets: [1, 5, 10, 20, 50, 100, 200, 500],
  registers: [register]
});

// RPC 发送计数
export const rpcSendCounter = new Counter({
  name: "sniper_rpc_send_total",
  help: "Total number of RPC sends",
  labelNames: ["success"],
  registers: [register]
});

// RPC 发送延迟
export const rpcSendLatency = new Histogram({
  name: "sniper_rpc_send_latency_ms",
  help: "RPC send latency in milliseconds",
  buckets: [50, 100, 200, 500, 1000, 2000, 5000],
  registers: [register]
});

// 当前 Leader 信息
export const currentLeaderGauge = new Gauge({
  name: "sniper_current_leader_info",
  help: "Current leader information",
  labelNames: ["identity", "ip", "tpu_port", "epoch", "slot"],
  registers: [register]
});

// Slot 变化计数
export const slotChangeCounter = new Counter({
  name: "sniper_slot_changes_total",
  help: "Total number of slot changes",
  registers: [register]
});

// 缓存命中率
export const cacheHitCounter = new Counter({
  name: "sniper_cache_hits_total",
  help: "Total number of cache hits",
  labelNames: ["type"],
  registers: [register]
});

export const cacheMissCounter = new Counter({
  name: "sniper_cache_misses_total",
  help: "Total number of cache misses",
  labelNames: ["type"],
  registers: [register]
});

// 交易确认计数
export const transactionConfirmCounter = new Counter({
  name: "sniper_transaction_confirms_total",
  help: "Total number of transaction confirmations",
  labelNames: ["success", "method"],
  registers: [register]
});

// 交易确认延迟
export const transactionConfirmLatency = new Histogram({
  name: "sniper_transaction_confirm_latency_ms",
  help: "Transaction confirmation latency in milliseconds",
  buckets: [100, 500, 1000, 2000, 5000, 10000, 30000],
  registers: [register]
});

/**
 * 更新 Leader 指标
 */
export function updateLeaderMetrics(
  identity: string,
  ip: string,
  tpuPort: number,
  epoch: number,
  slot: number,
  latency: number
): void {
  currentLeaderGauge.set(
    { identity, ip, tpu_port: String(tpuPort), epoch: String(epoch), slot: String(slot) },
    1
  );
  leaderUpdateCounter.inc();
  leaderUpdateLatency.observe(latency);
}

/**
 * 更新 TPU 发送指标
 */
export function updateTpuMetrics(
  success: boolean,
  leader: string,
  latency: number
): void {
  tpuSendCounter.inc({ success: String(success), leader });
  tpuSendLatency.observe(latency);
}

/**
 * 更新 RPC 发送指标
 */
export function updateRpcMetrics(success: boolean, latency: number): void {
  rpcSendCounter.inc({ success: String(success) });
  rpcSendLatency.observe(latency);
}

/**
 * 更新 Slot 变化指标
 */
export function updateSlotMetrics(): void {
  slotChangeCounter.inc();
}

/**
 * 更新缓存指标
 */
export function updateCacheMetrics(type: string, hit: boolean): void {
  if (hit) {
    cacheHitCounter.inc({ type });
  } else {
    cacheMissCounter.inc({ type });
  }
}

/**
 * 更新交易确认指标
 */
export function updateTransactionConfirmMetrics(
  success: boolean,
  method: string,
  latency: number
): void {
  transactionConfirmCounter.inc({ success: String(success), method });
  transactionConfirmLatency.observe(latency);
}

export default {
  register,
  updateLeaderMetrics,
  updateTpuMetrics,
  updateRpcMetrics,
  updateSlotMetrics,
  updateCacheMetrics,
  updateTransactionConfirmMetrics
};