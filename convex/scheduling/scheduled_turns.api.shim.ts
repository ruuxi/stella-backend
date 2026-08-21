/**
 * Standalone typecheck shim for the mobile-schedules Convex functions.
 *
 * The repo's committed `convex/_generated/api.d.ts` predates the new
 * `scheduling/scheduled_turns` module, and regenerating it requires a live
 * Convex deployment (`npx convex dev`), which isn't available here. The
 * route module imports these typed references from the shim instead of the
 * stale generated api; at deploy time `convex codegen` folds the functions
 * into the real generated api and this file (plus the import indirection)
 * is removed.
 */
import { makeFunctionReference } from "convex/server";

export const listOwnerScheduledTurns = makeFunctionReference<
  "query",
  { ownerId: string; limit?: number },
  Array<{
    scheduleId: string;
    ownerId: string;
    conversationId?: string;
    prompt: string;
    schedule: string;
    nextRunAt: number;
    lastRunAt?: number;
    status: string;
    description: string;
    lastError?: string;
    lastErrorAt?: number;
    createdAt: number;
    updatedAt: number;
  }>
>("scheduling/scheduled_turns:listOwnerScheduledTurnsInternal");

export const updateScheduledTurnStatus = makeFunctionReference<
  "mutation",
  {
    ownerId: string;
    scheduleId: string;
    status: "active" | "paused";
    now: number;
  },
  null
>("scheduling/scheduled_turns:updateScheduledTurnStatusInternal");

export const removeScheduledTurn = makeFunctionReference<
  "mutation",
  { ownerId: string; scheduleId: string },
  null
>("scheduling/scheduled_turns:removeScheduledTurnInternal");
