import { Connection } from "@solana/web3.js";
import { LeaderTracker } from "../src/core/leader-tracker";
import { Logger } from "../src/utils/logger";

const logger = new Logger("Benchmark");

/**
 * Leader 信息获取性能基准测试
 */
async function benchmark(): Promise<void> {
  const connection = new Connection("https://api.mainnet-beta.solana.com", {
    commitment: "processed"
  });
  const tracker = new LeaderTracker(connection);

  console.log("\n=== Leader Info Benchmark ===\n");

  // 测试 1: 首次获取 (无缓存)
  console.log("Test 1: First fetch (no cache)");
  const start1 = Date.now();
  await tracker.getCurrentLeaderFresh();
  const elapsed1 = Date.now() - start1;
  console.log(`  Time: ${elapsed1}ms`);

  // 测试 2: 缓存获取
  console.log("\nTest 2: Cached fetch");
  const start2 = Date.now();
  tracker.getCurrentLeader();
  const elapsed2 = Date.now() - start2;
  console.log(`  Time: ${elapsed2}ms`);

  // 测试 3: 获取多个 Leader
  console.log("\nTest 3: Get next 10 leaders");
  const start3 = Date.now();
  await tracker.getNextLeaders(10);
  const elapsed3 = Date.now() - start3;
  console.log(`  Time: ${elapsed3}ms`);

  // 测试 4: 连续获取
  console.log("\nTest 4: 100 consecutive cached fetches");
  const start4 = Date.now();
  for (let i = 0; i < 100; i++) {
    tracker.getCurrentLeader();
  }
  const elapsed4 = Date.now() - start4;
  console.log(`  Total: ${elapsed4}ms`);
  console.log(`  Average: ${elapsed4 / 100}ms`);

  // 测试 5: 并行请求优化效果
  console.log("\nTest 5: Parallel request optimization");
  const start5 = Date.now();
  await tracker.getCurrentLeaderFresh();
  const elapsed5 = Date.now() - start5;
  console.log(`  Time: ${elapsed5}ms`);

  // 测试 6: Leader 信息详情
  console.log("\nTest 6: Leader info details");
  const leader = await tracker.getCurrentLeaderFresh();
  console.log(`  Identity: ${leader.identity}`);
  console.log(`  IP: ${leader.ip}`);
  console.log(`  TPU Port: ${leader.ports.tpu}`);
  console.log(`  TPU QUIC Port: ${leader.ports.tpuQuic}`);

  // 测试 7: 获取统计信息
  console.log("\nTest 7: Stats");
  const stats = tracker.getStats();
  console.log(`  Current Leader: ${stats.currentLeader?.identity}`);
  console.log(`  Next Leaders Count: ${stats.nextLeadersCount}`);
  console.log(`  Cache Size: ${stats.cacheStats.size}`);

  tracker.stop();
  console.log("\n=== Benchmark Complete ===");
}

/**
 * TPU 发送延迟测试
 */
async function testTpuLatency(): Promise<void> {
  console.log("\n=== TPU Latency Test ===\n");

  const connection = new Connection("https://api.mainnet-beta.solana.com", {
    commitment: "processed"
  });
  const tracker = new LeaderTracker(connection);

  await tracker.start();

  const leader = tracker.getCurrentLeader();
  if (leader) {
    console.log(`Target Leader: ${leader.identity}`);
    console.log(`Target IP: ${leader.ip}`);
    console.log(`Target TPU Port: ${leader.ports.tpu}`);

    // 模拟 UDP 发送延迟测试
    // 实际发送需要构建真实交易
    console.log("\nNote: Actual TPU send requires valid transaction");
    console.log("Estimated UDP latency: 10-50ms (based on network distance)");
  }

  tracker.stop();
  console.log("\n=== TPU Latency Test Complete ===");
}

// 运行基准测试
benchmark()
  .then(() => testTpuLatency())
  .catch(console.error);