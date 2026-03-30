import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { UPIWebhookVerifier } from "../webhook.js";

function computeHmac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("UPIWebhookVerifier", () => {
  const SECRET = "whsec_test_secret_1234567890";

  describe("verify", () => {
    it("returns true for a valid Razorpay signature", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "razorpay",
        webhookSecret: SECRET,
      });

      const body = JSON.stringify({ event: "payment.captured", payload: {} });
      const signature = computeHmac(SECRET, body);

      expect(verifier.verify(body, signature)).toBe(true);
    });

    it("returns false for an invalid signature", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "razorpay",
        webhookSecret: SECRET,
      });

      const body = JSON.stringify({ event: "payment.captured" });
      const wrongSignature = computeHmac("wrong_secret", body);

      expect(verifier.verify(body, wrongSignature)).toBe(false);
    });

    it("returns false for a tampered body", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "razorpay",
        webhookSecret: SECRET,
      });

      const originalBody = JSON.stringify({ event: "payment.captured" });
      const signature = computeHmac(SECRET, originalBody);

      const tamperedBody = JSON.stringify({
        event: "payment.captured",
        extra: "injected",
      });
      expect(verifier.verify(tamperedBody, signature)).toBe(false);
    });

    it("returns false for empty body", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "razorpay",
        webhookSecret: SECRET,
      });

      expect(verifier.verify("", "deadbeef")).toBe(false);
    });

    it("returns false for empty signature", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "razorpay",
        webhookSecret: SECRET,
      });

      expect(verifier.verify("some body", "")).toBe(false);
    });

    it("handles signatures of different lengths (timing-safe comparison)", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "razorpay",
        webhookSecret: SECRET,
      });

      const body = JSON.stringify({ test: true });
      // A signature that is shorter than expected (truncated hex)
      expect(verifier.verify(body, "ab")).toBe(false);
    });

    it("correctly verifies matching signatures of same length", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "razorpay",
        webhookSecret: SECRET,
      });

      const body = "exact match test body";
      const signature = computeHmac(SECRET, body);

      // Same-length signatures that differ
      const wrongSameLength = signature.replace(
        signature[0],
        signature[0] === "a" ? "b" : "a"
      );

      expect(verifier.verify(body, signature)).toBe(true);
      expect(verifier.verify(body, wrongSameLength)).toBe(false);
    });
  });

  describe("parseEvent — Razorpay", () => {
    it("parses a Razorpay payment.captured event", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "razorpay",
        webhookSecret: SECRET,
      });

      const body = JSON.stringify({
        entity: "event",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_abc123",
              amount: 50000,
              currency: "INR",
            },
          },
        },
      });
      const signature = computeHmac(SECRET, body);

      const event = verifier.parseEvent(body, signature);

      expect(event.verified).toBe(true);
      expect(event.event).toBe("payment.captured");
      expect(event.id).toBe("pay_abc123");
      expect(event.payload).toBeDefined();
    });

    it("returns verified=false for invalid signature on parsed event", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "razorpay",
        webhookSecret: SECRET,
      });

      const body = JSON.stringify({
        entity: "event",
        event: "payment.captured",
        payload: {},
      });

      const event = verifier.parseEvent(body, "invalidsignature");

      expect(event.verified).toBe(false);
      expect(event.event).toBe("payment.captured");
    });

    it("handles unparseable JSON body", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "razorpay",
        webhookSecret: SECRET,
      });

      const body = "not valid json {{{";
      const signature = computeHmac(SECRET, body);

      const event = verifier.parseEvent(body, signature);

      expect(event.id).toBe("unknown");
      expect(event.event).toBe("unknown");
    });
  });

  describe("parseEvent — Cashfree", () => {
    it("parses a Cashfree PAYMENT_SUCCESS_WEBHOOK event", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "cashfree",
        webhookSecret: SECRET,
      });

      const body = JSON.stringify({
        type: "PAYMENT_SUCCESS_WEBHOOK",
        data: {
          order: { order_id: "order_123" },
          payment: {
            cf_payment_id: "cf_pay_456",
            payment_amount: 500,
            payment_status: "SUCCESS",
          },
        },
      });
      const signature = computeHmac(SECRET, body);

      const event = verifier.parseEvent(body, signature);

      expect(event.verified).toBe(true);
      expect(event.event).toBe("PAYMENT_SUCCESS_WEBHOOK");
      expect(event.id).toBe("cf_pay_456");
    });

    it("handles numeric cf_payment_id", () => {
      const verifier = new UPIWebhookVerifier({
        gateway: "cashfree",
        webhookSecret: SECRET,
      });

      const body = JSON.stringify({
        type: "PAYMENT_SUCCESS_WEBHOOK",
        data: {
          payment: { cf_payment_id: 789 },
        },
      });
      const signature = computeHmac(SECRET, body);

      const event = verifier.parseEvent(body, signature);
      expect(event.id).toBe("789");
    });
  });

  describe("constructor validation", () => {
    it("requires gateway", () => {
      expect(
        () =>
          new UPIWebhookVerifier({
            gateway: "" as "razorpay",
            webhookSecret: SECRET,
          })
      ).toThrow("requires a gateway");
    });

    it("requires webhookSecret", () => {
      expect(
        () =>
          new UPIWebhookVerifier({
            gateway: "razorpay",
            webhookSecret: "",
          })
      ).toThrow("requires a webhookSecret");
    });
  });
});
