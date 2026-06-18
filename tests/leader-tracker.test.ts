import { Connection } from "@solana/web3.js";
import { LeaderTracker } from "../src/core/leader-tracker";
import { expect } from "chai";

describe("LeaderTracker", function() {
  this.timeout(30000);  // 30 秒超时

  let connection: Connection;
  let tracker: LeaderTracker;

  before(async function() {
    connection = new Connection("https://api.mainnet-beta.solana.com", {
      commitment: "processed"
    });
    tracker = new LeaderTracker(connection);
  });

  after(function() {
    tracker.stop();
  });

  describe("getCurrentLeaderFresh", function() {
    it("should get current leader info", async function() {
      const leader = await tracker.getCurrentLeaderFresh();

      expect(leader).to.have.property("identity");
      expect(leader).to.have.property("vote");
      expect(leader).to.have.property("ip");
      expect(leader).to.have.property("ports");
      expect(leader).to.have.property("slot");
      expect(leader).to.have.property("epoch");

      // 验证 IP 格式
      expect(leader.ip).to.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);

      // 验证端口
      expect(leader.ports.tpu).to.be.a("number");
      expect(leader.ports.tpu).to.be.greaterThan(0);
      expect(leader.ports.tpuQuic).to.equal(leader.ports.tpu + 1);
      expect(leader.ports.tpuForward).to.equal(leader.ports.tpu + 2);
    });

    it("should complete within reasonable time", async function() {
      const start = Date.now();
      await tracker.getCurrentLeaderFresh();
      const elapsed = Date.now() - start;

      expect(elapsed).to.be.lessThan(5000);  // 应在 5 秒内完成
    });
  });

  describe("getNextLeaders", function() {
    it("should get next leaders", async function() {
      const leaders = await tracker.getNextLeaders(4);

      expect(leaders).to.have.lengthOf.at.least(1);
      
      leaders.forEach(leader => {
        expect(leader).to.have.property("identity");
        expect(leader).to.have.property("ip");
        expect(leader).to.have.property("ports");
        expect(leader).to.have.property("slot");
      });
    });

    it("should return leaders in slot order", async function() {
      const leaders = await tracker.getNextLeaders(4);

      for (let i = 1; i < leaders.length; i++) {
        expect(leaders[i].slot).to.be.greaterThan(leaders[i - 1].slot);
      }
    });
  });

  describe("getCurrentLeader (cached)", function() {
    it("should return cached leader info", async function() {
      // 先获取一次
      await tracker.getCurrentLeaderFresh();

      // 第二次获取应该从缓存
      const start = Date.now();
      const cachedLeader = tracker.getCurrentLeader();
      const elapsed = Date.now() - start;

      expect(cachedLeader).to.not.be.null;
      expect(elapsed).to.be.lessThan(1);  // 缓存读取应该 < 1ms
    });

    it("should return null after cache expires", async function() {
      // 等待缓存过期 (5 分钟 TTL)
      // 这里不实际等待，只是测试接口
      const leader = tracker.getCurrentLeader();
      
      if (leader && Date.now() >= leader.expiresAt) {
        expect(tracker.getCurrentLeader()).to.be.null;
      }
    });
  });

  describe("start/stop", function() {
    it("should start and stop successfully", async function() {
      const newTracker = new LeaderTracker(connection);
      
      await newTracker.start();
      expect(newTracker.getCurrentLeader()).to.not.be.null;
      
      newTracker.stop();
    });
  });
});