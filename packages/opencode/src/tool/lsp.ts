import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp.txt"
import { Instance } from "../project/instance"
import { pathToFileURL } from "url"
import { assertReadAllowed } from "./external-directory"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const

export const LspTool = Tool.define(
  "lsp",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: z.object({
        operation: z.enum(operations).describe("The LSP operation to perform"),
        file_path: z.string().describe("The absolute or relative path to the file"),
        repositoryId: z
          .string()
          .optional()
          .describe("When a multi-repo workspace is configured: repository id that owns this file. Omit for primary."),
        line: z.number().int().min(1).describe("The line number (1-based, as shown in editors)"),
        character: z.number().int().min(1).describe("The character offset (1-based, as shown in editors)"),
      }),
      execute: (
        args: {
          operation: (typeof operations)[number]
          file_path: string
          repositoryId?: string
          line: number
          character: number
        },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          let file = path.isAbsolute(args.file_path) ? args.file_path : path.join(Instance.directory, args.file_path)
          if (args.repositoryId) {
            const { Runtime, resolveAbsolute } = yield* Effect.promise(() => import("@/repo-workspace"))
            const workspace = yield* Effect.tryPromise(() => Runtime.current()).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
            if (!workspace) {
              throw new Error("No multi-repo workspace loaded; omit repositoryId or configure workspace")
            }
            file = path.isAbsolute(args.file_path)
              ? args.file_path
              : resolveAbsolute(workspace, args.repositoryId, args.file_path)
          }
          yield* assertReadAllowed(ctx, file, { repositoryId: args.repositoryId })
          yield* ctx.ask({ permission: "lsp", patterns: ["*"], always: ["*"], metadata: { repositoryId: args.repositoryId } })

          const uri = pathToFileURL(file).href
          const position = { file, line: args.line - 1, character: args.character - 1 }
          const { Runtime, Policy } = yield* Effect.promise(() => import("@/repo-workspace"))
          const workspace = yield* Effect.tryPromise(() => Runtime.current()).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          )
          const relPath = Policy.displayPath(workspace, file, Instance.worktree)
          const title = `${args.operation} ${relPath}:${args.line}:${args.character}`

          const exists = yield* fs.existsSafe(file)
          if (!exists) throw new Error(`File not found: ${file}`)

          const available = yield* lsp.hasClients(file)
          if (!available) throw new Error("No LSP server available for this file type.")

          yield* lsp.touchFile(file, true)

          const result: unknown[] = yield* (() => {
            switch (args.operation) {
              case "goToDefinition":
                return lsp.definition(position)
              case "findReferences":
                return lsp.references(position)
              case "hover":
                return lsp.hover(position)
              case "documentSymbol":
                return lsp.documentSymbol(uri)
              case "workspaceSymbol":
                return lsp.workspaceSymbol("")
              case "goToImplementation":
                return lsp.implementation(position)
              case "prepareCallHierarchy":
                return lsp.prepareCallHierarchy(position)
              case "incomingCalls":
                return lsp.incomingCalls(position)
              case "outgoingCalls":
                return lsp.outgoingCalls(position)
            }
          })()

          const annotated = Policy.annotatePaths(workspace, result, Instance.worktree)
          return {
            title,
            metadata: { result: annotated, repositoryId: args.repositoryId },
            output:
              Array.isArray(annotated) && annotated.length === 0
                ? `No results found for ${args.operation}`
                : JSON.stringify(annotated, null, 2),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
