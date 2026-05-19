"use strict";
/**
 * SHA-256 Hash Chain Verification
 *
 * Each telemetry event includes a hash:
 *   currentHash = SHA256(previousHash + JSON(eventWithoutHash))
 *
 * This forms an immutable chain — any tampering breaks the chain.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEventHash = generateEventHash;
exports.verifyHashChain = verifyHashChain;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Generate SHA-256 hash for an event given the previous hash
 */
function generateEventHash(event, prevHash) {
    const payload = prevHash + JSON.stringify({
        seq: event.seq,
        timestamp: event.timestamp,
        iki: event.iki,
        type: event.type,
        meta: event.meta,
    });
    return crypto_1.default.createHash('sha256').update(payload, 'utf8').digest('hex');
}
/**
 * Verify integrity of an event chain
 * Returns: { valid: boolean, brokenAt?: number }
 */
function verifyHashChain(events, initialHash = '0'.repeat(64)) {
    let prevHash = initialHash;
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const expected = generateEventHash({ seq: event.seq, timestamp: event.timestamp, iki: event.iki, type: event.type, meta: event.meta }, prevHash);
        if (expected !== event.currentHash) {
            return { valid: false, brokenAt: i };
        }
        prevHash = event.currentHash;
    }
    return { valid: true };
}
//# sourceMappingURL=hashChain.js.map