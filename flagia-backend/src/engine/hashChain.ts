/**
 * SHA-256 Hash Chain Verification
 * 
 * Each telemetry event includes a hash:
 *   currentHash = SHA256(previousHash + JSON(eventWithoutHash))
 * 
 * This forms an immutable chain — any tampering breaks the chain.
 */

import crypto from 'crypto';

interface HashedEvent {
  seq: number;
  timestamp: number;
  iki: number;
  type: string;
  meta: Record<string, any>;
  currentHash: string;
}

/**
 * Generate SHA-256 hash for an event given the previous hash
 */
export function generateEventHash(event: Omit<HashedEvent, 'currentHash'>, prevHash: string): string {
  const payload = prevHash + JSON.stringify({
    seq: event.seq,
    timestamp: event.timestamp,
    iki: event.iki,
    type: event.type,
    meta: event.meta,
  });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Verify integrity of an event chain
 * Returns: { valid: boolean, brokenAt?: number }
 */
export function verifyHashChain(
  events: HashedEvent[],
  initialHash: string = '0'.repeat(64)
): { valid: boolean; brokenAt?: number } {
  let prevHash = initialHash;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const expected = generateEventHash(
      { seq: event.seq, timestamp: event.timestamp, iki: event.iki, type: event.type, meta: event.meta },
      prevHash
    );

    if (expected !== event.currentHash) {
      return { valid: false, brokenAt: i };
    }
    prevHash = event.currentHash;
  }

  return { valid: true };
}
