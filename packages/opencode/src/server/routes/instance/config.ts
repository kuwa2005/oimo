import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "@/config"
import { Provider } from "@/provider"
import { Question } from "@/question"
import { Permission } from "@/permission"
import { Goal } from "@/session/goal"
import { Instance } from "@/project/instance"
import { applySessionMode } from "@/autonomy/session-mode"
import { SessionID } from "@/session/schema"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"

const AutonomyModeBody = z.object({
  mode: z.enum(["none", "se", "normal", "fde", "special"]),
  /** session = current session Run only (default). default = persist global oimo.json. */
  scope: z.enum(["session", "default"]).optional().default("session"),
  sessionID: SessionID.zod.optional(),
})

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current OpenCode configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ConfigRoutes.get", c, function* () {
          const cfg = yield* Config.Service
          return yield* cfg.get()
        }),
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update OpenCode configuration settings and preferences.",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) =>
        jsonRequest("ConfigRoutes.update", c, function* () {
          const config = c.req.valid("json")
          const cfg = yield* Config.Service
          yield* cfg.update(config)
          return config
        }),
    )
    .post(
      "/autonomy-mode",
      describeRoute({
        summary: "Set autonomy mode",
        description:
          "Default scope=session: bind mode to the session AutonomyRun without process.env or global config writes. scope=default: persist global default. Special enables never-ask and full_auto skip-permissions.",
        operationId: "config.autonomyMode",
        responses: {
          200: {
            description: "Updated config",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    config: Config.Info,
                    mode: z.enum(["none", "se", "normal", "fde", "special"]),
                    goalsPromoted: z.number(),
                    reLockRequired: z.boolean(),
                    scope: z.enum(["session", "default"]),
                    runID: z.string().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", AutonomyModeBody),
      async (c) =>
        jsonRequest("ConfigRoutes.autonomyMode", c, function* () {
          const body = c.req.valid("json")
          const mode = body.mode
          const scope = body.scope ?? "session"
          const sessionID = body.sessionID

          if (scope === "session" && !sessionID) {
            throw new Error("sessionID required when scope=session")
          }

          const applied = applySessionMode({
            mode,
            scope,
            sessionID,
            projectID: String(Instance.project.id),
          })

          const cfg = yield* Config.Service
          // In-memory overlay so prompts see the mode; global write only for scope=default.
          const config = yield* cfg.setAutonomyMode(mode, { persistGlobal: applied.persistGlobal })

          const question = yield* Question.Service
          const permission = yield* Permission.Service
          if (mode === "none") {
            yield* question.setNeverAsk(false)
            yield* permission.setSkipAll(false)
          }
          if (mode === "se" || mode === "normal" || mode === "fde") {
            // safe_auto: do not skipAll — permission rules from safe_auto preset apply.
            yield* question.setNeverAsk(false)
            yield* permission.setSkipAll(false)
          }
          let goalsPromoted = 0
          if (mode === "special") {
            yield* question.setNeverAsk(true)
            yield* permission.setSkipAll(true)
            const goal = yield* Goal.Service
            goalsPromoted = yield* goal.enterSpecialAll()
          }

          return {
            config,
            mode,
            goalsPromoted,
            reLockRequired: applied.reLockRequired,
            scope,
            runID: applied.run?.id,
          }
        }),
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(Provider.ConfigProvidersResult.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ConfigRoutes.providers", c, function* () {
          const svc = yield* Provider.Service
          const providers = yield* svc.list()
          return {
            providers: Object.values(providers),
            default: Provider.defaultModelIDs(providers),
          }
        }),
    ),
)
