// The mobile app's read/write surface for the owner's scheduled chat turns
// (cloud_scheduled_turns). The Schedule tool writes these rows through its
// own service-authenticated route; this is the phone's window onto the same
// data, reached over the authenticated HTTP surface (Better Auth JWT, like
// every other /api/mobile route) so ownership never crosses the wire.
//
// GET  /api/mobile/schedules            → list live rows for the signed-in owner
// POST /api/mobile/schedules            → { action: "pause" | "resume" | "remove",
//                                          scheduleId }
//
// A narrow subset of the Schedule tool's surface, sized to what a phone
// sheet needs: pause/resume and delete. Creating or editing prompts stays
// with the agent itself.

import type { HttpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction } from "../_generated/server";
import {
  listOwnerScheduledTurns,
  removeScheduledTurn,
  updateScheduledTurnStatus,
} from "../scheduling/scheduled_turns.api.shim";
import {
  errorResponse,
  jsonResponse,
  handleCorsRequest,
  registerCorsOptions,
} from "../http_shared/cors";
import { requireMobileAccountOwner } from "./mobile";

/** Per-owner cap on the mobile schedules endpoints (cheap reads/writes). */
const MOBILE_SCHEDULES_RATE_LIMIT = 60;
const MOBILE_SCHEDULES_RATE_WINDOW_MS = 60_000;
/** Rows are capped per owner server-side; a generous page covers them all. */
const MOBILE_SCHEDULES_PAGE_LIMIT = 100;

export function registerMobileSchedulesRoutes(http: HttpRouter) {
  const SCHEDULES_PATH = "/api/mobile/schedules";
  registerCorsOptions(http, [SCHEDULES_PATH]);

  // List every non-purged schedule row for the signed-in owner, newest
  // activity first — title (description), cadence, next run, status.
  http.route({
    path: SCHEDULES_PATH,
    method: "GET",
    handler: httpAction(async (ctx, request) =>
      handleCorsRequest(request, async (origin) => {
        const owner = await requireMobileAccountOwner(ctx, origin);
        if ("response" in owner) {
          return owner.response;
        }
        const rows = await ctx.runQuery(listOwnerScheduledTurns, {
          ownerId: owner.ownerId,
          limit: MOBILE_SCHEDULES_PAGE_LIMIT,
        });
        return jsonResponse({ ok: true, schedules: rows }, 200, origin);
      }),
    ),
  });

  // Pause / resume / remove one schedule by id. Ownership and terminal-row
  // guards are enforced inside the mutations; the readable ConvexError text
  // surfaces verbatim so the sheet can show why an action didn't land.
  http.route({
    path: SCHEDULES_PATH,
    method: "POST",
    handler: httpAction(async (ctx, request) =>
      handleCorsRequest(request, async (origin) => {
        const owner = await requireMobileAccountOwner(ctx, origin);
        if ("response" in owner) {
          return owner.response;
        }

        let body: { action?: unknown; scheduleId?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return errorResponse(400, "Invalid JSON body", origin);
        }
        const action = typeof body.action === "string" ? body.action : "";
        const scheduleId =
          typeof body.scheduleId === "string" ? body.scheduleId.trim() : "";
        if (!scheduleId) {
          return errorResponse(400, "scheduleId required", origin);
        }

        if (action === "pause" || action === "resume") {
          const status = action === "pause" ? "paused" : "active";
          try {
            await ctx.runMutation(updateScheduledTurnStatus, {
              ownerId: owner.ownerId,
              scheduleId,
              status,
              now: Date.now(),
            });
          } catch (error) {
            return readableErrorResponse(error, origin);
          }
          return jsonResponse({ ok: true }, 200, origin);
        }
        if (action === "remove") {
          try {
            await ctx.runMutation(removeScheduledTurn, {
              ownerId: owner.ownerId,
              scheduleId,
            });
          } catch (error) {
            return readableErrorResponse(error, origin);
          }
          return jsonResponse({ ok: true }, 200, origin);
        }
        return errorResponse(
          400,
          'action must be "pause", "resume", or "remove"',
          origin,
        );
      }),
    ),
  });
}

const readableErrorResponse = (error: unknown, origin: string | null) => {
  // ConvexError carries its readable text in `data`, not `message`.
  const readable =
    error instanceof ConvexError && typeof error.data === "string"
      ? error.data
      : undefined;
  return errorResponse(400, readable ?? "Could not update that schedule.", origin);
};
