/**
 * SHA-256 Hash Chain Verification
 *
 * Each telemetry event includes a hash:
 *   currentHash = SHA256(previousHash + JSON(eventWithoutHash))
 *
 * This forms an immutable chain — any tampering breaks the chain.
 */
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
export declare function generateEventHash(event: Omit<HashedEvent, 'currentHash'>, prevHash: string): string;
/**
 * Verify integrity of an event chain
 * Returns: { valid: boolean, brokenAt?: number }
 */
export declare function verifyHashChain(events: HashedEvent[], initialHash?: string): {
    valid: boolean;
    brokenAt?: number;
};
export {};
//# sourceMappingURL=hashChain.d.ts.map