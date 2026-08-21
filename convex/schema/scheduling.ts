import { defineTable } from "convex/server";
import { v } from "convex/values";

export const cronScheduleValidator = v.union(
  v.object({
    kind: v.literal("at"),
    atMs: v.number(),
  }),
  v.object({
    kind: v.literal("every"),
    everyMs: v.number(),
    anchorMs: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal("cron"),
    expr: v.string(),
    tz: v.optional(v.string()),
  }),
);

export const cronPayloadValidator = v.union(
  v.object({
    kind: v.literal("notify"),
    text: v.string(),
  }),
  v.object({
    kind: v.literal("script"),
    scriptPath: v.string(),
  }),
  v.object({
    kind: v.literal("agent"),
    prompt: v.string(),
    agentType: v.optional(v.string()),
  }),
);

export const schedulingSchema = {
  // Owner-scoped scheduled cloud chat turns. The orchestrator's Schedule tool
  // writes these rows through its service-authenticated route; a Convex cron
  // sweeps due rows and the mobile app's Schedules tab reads/pauses/removes
  // them over the authenticated HTTP surface.
  cloud_scheduled_turns: defineTable({
    scheduleId: v.string(),
    ownerId: v.string(),
    // Absent until the first fire creates the conversation the schedule
    // reports into; from then on every fire lands in the same thread.
    conversationId: v.optional(v.string()),
    prompt: v.string(),
    // Serialized LocalCronSchedule (see cronScheduleValidator above):
    // {kind:"at",atMs} | {kind:"every",everyMs,anchorMs?} | {kind:"cron",expr,tz?}
    schedule: v.string(),
    nextRunAt: v.number(),
    lastRunAt: v.optional(v.number()),
    // "active" | "paused" | "done"
    status: v.string(),
    description: v.string(),
    // Why the most recent fire did not run, and how many fires in a row have
    // failed. A schedule that is quietly dropping its runs looks identical to
    // a healthy one without these, since nextRunAt advances either way.
    lastError: v.optional(v.string()),
    lastErrorAt: v.optional(v.number()),
    failureCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_scheduleId", ["scheduleId"])
    .index("by_ownerId_and_updatedAt", ["ownerId", "updatedAt"]),
};
