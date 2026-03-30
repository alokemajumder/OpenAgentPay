import { describe, it, expect, vi, beforeEach } from "vitest";
import { UPIReservePayManager } from "../upi-reserve-pay.js";

/**
 * Mock fetch to simulate gateway responses without network calls.
 */
function mockFetchSuccess(responseBody: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(responseBody),
    text: () => Promise.resolve(JSON.stringify(responseBody)),
  });
}

function createManager() {
  return new UPIReservePayManager({
    gateway: "razorpay",
    apiKey: "rzp_test_key",
    apiSecret: "rzp_test_secret",
  });
}

describe("UPIReservePayManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("createBlock validation", () => {
    it("rejects amount exceeding 1,000,000 paise (Rs 10,000)", async () => {
      const manager = createManager();

      await expect(
        manager.createBlock({
          payerIdentifier: "agent-1",
          amount: 1_000_001,
          description: "Too much",
          expiryDays: 30,
        })
      ).rejects.toThrow("exceeds UPI Reserve Pay maximum of 1000000 paise");
    });

    it("rejects expiryDays exceeding 90", async () => {
      const manager = createManager();

      await expect(
        manager.createBlock({
          payerIdentifier: "agent-1",
          amount: 500_000,
          description: "Too long",
          expiryDays: 91,
        })
      ).rejects.toThrow("exceeds UPI Reserve Pay maximum of 90 days");
    });

    it("rejects zero amount", async () => {
      const manager = createManager();

      await expect(
        manager.createBlock({
          payerIdentifier: "agent-1",
          amount: 0,
          description: "Zero",
          expiryDays: 30,
        })
      ).rejects.toThrow("Must be a positive integer");
    });

    it("rejects negative amount", async () => {
      const manager = createManager();

      await expect(
        manager.createBlock({
          payerIdentifier: "agent-1",
          amount: -100,
          description: "Negative",
          expiryDays: 30,
        })
      ).rejects.toThrow("Must be a positive integer");
    });

    it("rejects zero expiryDays", async () => {
      const manager = createManager();

      await expect(
        manager.createBlock({
          payerIdentifier: "agent-1",
          amount: 500_000,
          description: "No expiry",
          expiryDays: 0,
        })
      ).rejects.toThrow("Must be a positive integer");
    });

    it("rejects missing payerIdentifier", async () => {
      const manager = createManager();

      await expect(
        manager.createBlock({
          payerIdentifier: "",
          amount: 500_000,
          description: "Test",
          expiryDays: 30,
        })
      ).rejects.toThrow("payerIdentifier is required");
    });

    it("rejects missing description", async () => {
      const manager = createManager();

      await expect(
        manager.createBlock({
          payerIdentifier: "agent-1",
          amount: 500_000,
          description: "",
          expiryDays: 30,
        })
      ).rejects.toThrow("description is required");
    });

    it("accepts valid block at max amount (1,000,000 paise)", async () => {
      const manager = createManager();
      const mockResponse = {
        id: "plink_test123",
        short_url: "https://rzp.io/test123",
        status: "created",
      };
      vi.stubGlobal("fetch", mockFetchSuccess(mockResponse));

      const result = await manager.createBlock({
        payerIdentifier: "agent-1",
        amount: 1_000_000,
        description: "Max amount",
        expiryDays: 90,
      });

      expect(result.blockId).toBe("plink_test123");
      expect(result.authUrl).toBe("https://rzp.io/test123");
      expect(result.expiresAt).toBeDefined();
    });
  });

  describe("block activation", () => {
    it("activates a created block", async () => {
      const manager = createManager();
      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_abc",
          short_url: "https://rzp.io/abc",
          status: "created",
        })
      );

      const { blockId } = await manager.createBlock({
        payerIdentifier: "agent-1",
        amount: 500_000,
        description: "Test",
        expiryDays: 30,
      });

      manager.activateBlock(blockId);

      const status = await manager.getBlockStatus(blockId);
      expect(status.status).toBe("active");
    });

    it("rejects activation of non-existent block", () => {
      const manager = createManager();

      expect(() => manager.activateBlock("nonexistent")).toThrow(
        "Block not found"
      );
    });

    it("rejects activation of already cancelled block", async () => {
      const manager = createManager();
      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_cancel",
          short_url: "https://rzp.io/cancel",
          status: "created",
        })
      );

      const { blockId } = await manager.createBlock({
        payerIdentifier: "agent-1",
        amount: 500_000,
        description: "Test",
        expiryDays: 30,
      });

      manager.activateBlock(blockId);

      // Cancel the block
      vi.stubGlobal("fetch", mockFetchSuccess({}));
      await manager.cancelBlock(blockId);

      expect(() => manager.activateBlock(blockId)).toThrow(
        "Cannot activate block"
      );
    });
  });

  describe("executeDebit", () => {
    async function createAndActivateBlock(
      manager: UPIReservePayManager,
      amount = 500_000
    ) {
      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_debit",
          short_url: "https://rzp.io/debit",
          status: "created",
        })
      );

      const { blockId } = await manager.createBlock({
        payerIdentifier: "agent-1",
        amount,
        description: "Debit test",
        expiryDays: 30,
      });

      manager.activateBlock(blockId);
      return blockId;
    }

    it("executes a debit within the remaining limit", async () => {
      const manager = createManager();
      const blockId = await createAndActivateBlock(manager);

      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "pay_tx1",
          status: "captured",
          amount: 10_000,
        })
      );

      const result = await manager.executeDebit(blockId, 10_000, "API call");

      expect(result.transactionId).toBe("pay_tx1");
      expect(result.amount).toBe(10_000);
      expect(result.remainingAmount).toBe(490_000);
      expect(result.status).toBe("captured");
    });

    it("fails when debit exceeds remaining balance", async () => {
      const manager = createManager();
      const blockId = await createAndActivateBlock(manager, 100_000);

      await expect(
        manager.executeDebit(blockId, 200_000, "Too much")
      ).rejects.toThrow("exceeds remaining balance");
    });

    it("rejects debit on non-active block", async () => {
      const manager = createManager();
      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_notactive",
          short_url: "https://rzp.io/na",
          status: "created",
        })
      );

      const { blockId } = await manager.createBlock({
        payerIdentifier: "agent-1",
        amount: 500_000,
        description: "Test",
        expiryDays: 30,
      });

      // Block is still in 'created' status, not activated
      await expect(
        manager.executeDebit(blockId, 10_000, "Not active")
      ).rejects.toThrow("is not active");
    });

    it("marks block as exhausted when remaining hits zero", async () => {
      const manager = createManager();
      const blockId = await createAndActivateBlock(manager, 10_000);

      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "pay_full",
          status: "captured",
          amount: 10_000,
        })
      );

      const result = await manager.executeDebit(
        blockId,
        10_000,
        "Full debit"
      );

      expect(result.remainingAmount).toBe(0);

      const status = await manager.getBlockStatus(blockId);
      expect(status.status).toBe("exhausted");
    });

    it("rejects debit with missing blockId", async () => {
      const manager = createManager();

      await expect(
        manager.executeDebit("", 10_000, "No block")
      ).rejects.toThrow("blockId is required");
    });
  });

  describe("cancelBlock", () => {
    it("cancels an active block", async () => {
      const manager = createManager();
      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_tocancel",
          short_url: "https://rzp.io/cancel",
          status: "created",
        })
      );

      const { blockId } = await manager.createBlock({
        payerIdentifier: "agent-1",
        amount: 500_000,
        description: "To cancel",
        expiryDays: 30,
      });

      manager.activateBlock(blockId);

      vi.stubGlobal("fetch", mockFetchSuccess({}));
      await manager.cancelBlock(blockId);

      const status = await manager.getBlockStatus(blockId);
      expect(status.status).toBe("cancelled");
    });

    it("rejects cancelling an already cancelled block", async () => {
      const manager = createManager();
      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_double",
          short_url: "https://rzp.io/double",
          status: "created",
        })
      );

      const { blockId } = await manager.createBlock({
        payerIdentifier: "agent-1",
        amount: 500_000,
        description: "Double cancel",
        expiryDays: 30,
      });

      manager.activateBlock(blockId);
      vi.stubGlobal("fetch", mockFetchSuccess({}));
      await manager.cancelBlock(blockId);

      await expect(manager.cancelBlock(blockId)).rejects.toThrow(
        "already terminated"
      );
    });
  });

  describe("listBlocks", () => {
    it("lists all blocks", async () => {
      const manager = createManager();

      // Create two blocks
      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_1",
          short_url: "https://rzp.io/1",
          status: "created",
        })
      );
      await manager.createBlock({
        payerIdentifier: "agent-1",
        amount: 100_000,
        description: "Block 1",
        expiryDays: 30,
      });

      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_2",
          short_url: "https://rzp.io/2",
          status: "created",
        })
      );
      await manager.createBlock({
        payerIdentifier: "agent-2",
        amount: 200_000,
        description: "Block 2",
        expiryDays: 60,
      });

      const blocks = await manager.listBlocks();
      expect(blocks).toHaveLength(2);
    });

    it("filters blocks by payerIdentifier", async () => {
      const manager = createManager();

      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_a",
          short_url: "https://rzp.io/a",
          status: "created",
        })
      );
      await manager.createBlock({
        payerIdentifier: "agent-A",
        amount: 100_000,
        description: "A",
        expiryDays: 30,
      });

      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_b",
          short_url: "https://rzp.io/b",
          status: "created",
        })
      );
      await manager.createBlock({
        payerIdentifier: "agent-B",
        amount: 200_000,
        description: "B",
        expiryDays: 30,
      });

      const blocks = await manager.listBlocks("agent-A");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].payerIdentifier).toBe("agent-A");
    });
  });

  describe("expired block auto-detection", () => {
    it("marks block as expired when checking status after expiry", async () => {
      const manager = createManager();
      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_expire",
          short_url: "https://rzp.io/expire",
          status: "created",
        })
      );

      await manager.createBlock({
        payerIdentifier: "agent-1",
        amount: 100_000,
        description: "Will expire",
        expiryDays: 1,
      });

      manager.activateBlock("plink_expire");

      // Advance time past expiry using fake timers
      vi.useFakeTimers();
      vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000); // 2 days forward

      const status = await manager.getBlockStatus("plink_expire");
      expect(status.status).toBe("expired");

      vi.useRealTimers();
    });

    it("rejects debit on expired block", async () => {
      const manager = createManager();
      vi.stubGlobal(
        "fetch",
        mockFetchSuccess({
          id: "plink_exp_debit",
          short_url: "https://rzp.io/expdebit",
          status: "created",
        })
      );

      await manager.createBlock({
        payerIdentifier: "agent-1",
        amount: 100_000,
        description: "Expire before debit",
        expiryDays: 1,
      });

      manager.activateBlock("plink_exp_debit");

      // Advance time past expiry
      vi.useFakeTimers();
      vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000); // 2 days forward

      await expect(
        manager.executeDebit("plink_exp_debit", 1000, "Should fail")
      ).rejects.toThrow("has expired");

      vi.useRealTimers();
    });
  });

  describe("constructor validation", () => {
    it("requires apiKey", () => {
      expect(
        () =>
          new UPIReservePayManager({
            gateway: "razorpay",
            apiKey: "",
            apiSecret: "secret",
          })
      ).toThrow("requires an apiKey");
    });

    it("requires apiSecret", () => {
      expect(
        () =>
          new UPIReservePayManager({
            gateway: "razorpay",
            apiKey: "key",
            apiSecret: "",
          })
      ).toThrow("requires an apiSecret");
    });
  });
});
