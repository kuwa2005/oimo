import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Instance } from "@/project/instance"
import * as AutonomyGate from "@/autonomy/gate"
import { AutonomyBridge } from "@/autonomy/bridge"
import { resolveAutonomyRequest } from "@/autonomy/resolve"
import DESCRIPTION from "./question.txt"

const parameters = z.object({
  questions: z.array(Question.Prompt.zod).describe("Questions to ask"),
})

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
  requirementsLocked?: boolean
}

export const QuestionTool = Tool.define<typeof parameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          if (yield* question.neverAsk()) {
            const autoAnswer = "[Never-Ask] The model will decide autonomously"
            return {
              title: `Auto-resolved ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
              output:
                "[Never-Ask] No user is available to answer (never-ask mode is on). " +
                "Re-evaluate the options you just proposed for unattended/headless execution — " +
                "prefer text-only, non-interactive, minimal-scope paths and avoid anything that needs a GUI or the user to be present. " +
                "Pick the best option yourself and continue. " +
                "IMPORTANT: You MUST explicitly state which option you chose and why in your response text (not just in thinking) — " +
                "the user will review the conversation history later and needs to see what you decided without expanding thinking blocks. " +
                "This applies only to this question; never-ask may be turned off later, so keep using the question tool at future decision points (the user may have returned).",
              metadata: {
                answers: params.questions.map(() => [autoAnswer]),
              },
            }
          }

          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: params.questions,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const formatted = params.questions
            .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
            .join(", ")

          let locked = false
          let solutionLock = false
          // Prefer durable AutonomyRun; Flag is bootstrap-only for pre-Run sessions.
          const { getLatestRunForSession } = yield* Effect.promise(() => import("@/autonomy/run"))
          const existingRun = getLatestRunForSession(ctx.sessionID)
          const autonomyOn =
            Boolean(existingRun && existingRun.profile !== "off" && existingRun.phase !== "cancelled") ||
            Boolean(process.env.MIMOCODE_AUTONOMY) ||
            Boolean(process.env.MIMOCODE_FDE) ||
            Boolean(process.env.MIMOCODE_SPAUTO) ||
            Boolean(process.env.MIMOCODE_AUTOSP)
          if (autonomyOn) {
            const resolved = resolveAutonomyRequest({
              source: "tui",
              env: {
                MIMOCODE_AUTONOMY: process.env.MIMOCODE_AUTONOMY,
                MIMOCODE_FDE: process.env.MIMOCODE_FDE,
                MIMOCODE_SPAUTO: process.env.MIMOCODE_SPAUTO ?? process.env.MIMOCODE_AUTOSP,
              },
            })
            const lock = AutonomyGate.handleQuestionLock({
              sessionID: ctx.sessionID,
              projectID: String(Instance.project.id),
              questionRequestID: ctx.callID ?? ctx.messageID,
              questions: params.questions,
              answers,
              profile:
                existingRun?.profile && existingRun.profile !== "off"
                  ? existingRun.profile
                  : resolved.request.profile === "off"
                    ? "se"
                    : resolved.request.profile,
              learningLenses:
                existingRun?.learningLenses?.length
                  ? existingRun.learningLenses
                  : resolved.request.learningLenses.length > 0
                    ? resolved.request.learningLenses
                    : ["se"],
            })
            locked = lock.locked
            solutionLock = lock.kind === "solution_lock"
            if (locked) AutonomyBridge.notifyLockApproved(ctx.sessionID)
          }

          return {
            title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
            output: locked
              ? solutionLock
                ? `User has answered your questions: ${formatted}. Solution Lock approved — FDE discovery phase is complete. Implement the chosen solution non-stop: build, verify, measure, and finish with FDE documentary evidence. Do not ask further product-scope questions unless blocked.`
                : `User has answered your questions: ${formatted}. Requirements Lock approved — hearing phase is complete. Enable non-stop execution: implement, verify, and finish. Do not ask further product-scope questions unless blocked.`
              : `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind. Record each Q&A (why / background / result) in the hearing log before proceeding.`,
            metadata: {
              answers,
              requirementsLocked: locked || undefined,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
