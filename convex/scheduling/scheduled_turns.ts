// Owner-scoped reads/writes over cloud_scheduled_turns for the mobile
// schedules endpoint (http_routes/mobile_schedules.ts). Ownership is
// re-checked here so the HTTP layer never becomes the trust boundary.

import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";

const SCHEDULE_STATUS_PURGED = "purged";
const SCHEDULE_TERMINAL_STATUSES = new Set(["done", SCHEDULE_STATUS_PURGED]);

const scheduleRowValidator = v.object({
  scheduleId: v.string(),
  ownerId: v.string(),
  conversationId: v.optional(v.string()),
  prompt: v.string(),
  schedule: v.string(),
  nextRunAt: v.number(),
  lastRunAt: v.optional(v.number()),
  status: v.string(),
  description: v.string(),
  lastError: v.optional(v.string()),
  lastErrorAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

type Db = QueryCtx["db"];

const loadOwnedSchedule = async (
  ctx: { db: Db },
  args: { ownerId: string; scheduleId: string },
) => {
  const row = await ctx.db
    .query("cloud_scheduled_turns")
    .withIndex("by_scheduleId", (q) => q.eq("scheduleId", args.scheduleId))
    .unique();
  if (!row || row.ownerId !== args.ownerId) {
    throw new ConvexError(`No schedule with id ${args.scheduleId}.`);
  }
  if (SCHEDULE_TERMINAL_STATUSES.has(row.status)) {
    throw new ConvexError("That schedule is finished and can't be changed.");
  }
  return row;
};

export const listOwnerScheduledTurnsInternal = internalQuery({
  args: { ownerId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(scheduleRowValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("cloud_scheduled_turns")
      .withIndex("by_ownerId_and_updatedAt", (q) =>
        q.eq("ownerId", args.ownerId),
      )
      .order("desc")
      .take(Math.max(1, Math.min(args.limit ?? 100, 200)));
    return rows
      .filter((row) => row.status !== SCHEDULE_STATUS_PURGED)
      .map((row) => ({
        scheduleId: row.scheduleId,
        ownerId: row.ownerId,
        conversationId: row.conversationId,
        prompt: row.prompt,
        schedule: row.schedule,
        nextRunAt: row.nextRunAt,
        lastRunAt: row.lastRunAt,
        status: row.status,
        description: row.description,
        lastError: row.lastError,
        lastErrorAt: row.lastErrorAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
  },
});

export const updateScheduledTurnStatusInternal = internalMutation({
  args: {
    ownerId: v.string(),
    scheduleId: v.string(),
    status: v.union(v.literal("active"), v.literal("paused")),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await loadOwnedSchedule(ctx, args);
    if (row.status === args.status) return null;
    let nextRunAt = row.nextRunAt;
    if (args.status === "active") {
      // Resuming re-anchors to now so a schedule that slept through fires
      // wakes once rather than catching up.
      nextRunAt = computeNextRunFromStored(row.schedule, args.now);
    }
    await ctx.db.patch(row._id, {
      status: args.status,
      nextRunAt,
      updatedAt: args.now,
    });
    return null;
  },
});

export const removeScheduledTurnInternal = internalMutation({
  args: {
    ownerId: v.string(),
    scheduleId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("cloud_scheduled_turns")
      .withIndex("by_scheduleId", (q) => q.eq("scheduleId", args.scheduleId))
      .unique();
    if (!row || row.ownerId !== args.ownerId) return null;
    await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * Re-anchor a resumed schedule. Accepts only the serialized LocalCronSchedule
 * shapes the scheduler itself writes; anything unreadable leaves nextRunAt
 * untouched rather than inventing a fire time.
 */
function computeNextRunFromStored(serialized: string, nowMs: number): number {
  try {
    const schedule = JSON.parse(serialized) as {
      kind?: string;
      atMs?: number;
      everyMs?: number;
      anchorMs?: number;
    };
    if (schedule.kind === "at" && typeof schedule.atMs === "number") {
      return schedule.atMs > nowMs ? schedule.atMs : nowMs;
    }
    if (
      schedule.kind === "every" &&
      typeof schedule.everyMs === "number" &&
      schedule.everyMs > 0
    ) {
      const anchor =
        typeof schedule.anchorMs === "number" && schedule.anchorMs > 0
          ? schedule.anchorMs
          : nowMs;
      const elapsed = Math.max(0, nowMs - anchor);
      const steps = Math.max(1, Math.ceil(elapsed / schedule.everyMs));
      return anchor + steps * schedule.everyMs;
    }
  } catch {
    // fall through to the untouched nextRunAt
  }
  return nowMs;
}
