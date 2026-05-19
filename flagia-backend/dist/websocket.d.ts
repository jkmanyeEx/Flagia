/**
 * WebSocket Server for Flagia
 *
 * Handles real-time communication:
 * - Student session management (join/resume)
 * - Keystroke telemetry batch ingestion
 * - Teacher kill-switch broadcast
 * - Auto-submit on timer expiry
 */
import { Server as HttpServer } from 'http';
export declare function notifySubmissionsUpdate(assignmentId: string, studentId?: string): void;
export declare function notifyAssignmentsUpdate(): void;
export declare function initWebSocket(server: HttpServer): void;
//# sourceMappingURL=websocket.d.ts.map