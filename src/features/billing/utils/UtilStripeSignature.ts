import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300;

export class UtilStripeSignature {
  /**
   * Verifies a `Stripe-Signature` header (`t=<ts>,v1=<sig>[,v1=<sig>...]`)
   * against the exact raw request body. The expected signature is
   * HMAC-SHA256(secret, `${t}.${rawBody}`) in hex; every `v1` entry is
   * compared in constant time and the timestamp must be within the
   * tolerance (replay protection).
   */
  static verify(
    rawBody: string,
    header: string | null | undefined,
    secret: string,
    nowSec: number,
    toleranceSec = STRIPE_SIGNATURE_TOLERANCE_SEC,
  ): boolean {
    if (!header || !secret) {
      return false;
    }

    let timestamp: string | undefined;
    const signatures: string[] = [];
    for (const part of header.split(",")) {
      const separator = part.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (key === "t" && timestamp === undefined) {
        timestamp = value;
      } else if (key === "v1") {
        signatures.push(value);
      }
    }

    if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) {
      return false;
    }
    if (Math.abs(nowSec - Number(timestamp)) > toleranceSec) {
      return false;
    }

    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest();

    return signatures.some((signature) => {
      if (!/^[0-9a-f]{64}$/i.test(signature)) {
        return false;
      }
      const candidate = Buffer.from(signature, "hex");
      return (
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
      );
    });
  }
}
