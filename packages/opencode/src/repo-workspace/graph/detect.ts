import path from "path"
import type { Info } from "../schema"
import type { EdgeConfidence, EdgeEvidence, EdgeKind, EdgeSource, RepositoryEdge } from "./types"

const SECRET_NAME =
  /(^|\/)(\.env(\..+)?|[^/]*\.(pem|key|p12|pfx)|credentials|secrets?|id_rsa)(\/|$|\.)/i

export function isSecretCandidatePath(relativePath: string): boolean {
  return SECRET_NAME.test(relativePath.replace(/\\/g, "/"))
}

type RawEdge = {
  from: string
  to: string
  kind: EdgeKind
  confidence: EdgeConfidence
  source: EdgeSource
  evidence: EdgeEvidence
}

export async function detectEdges(info: Info): Promise<RepositoryEdge[]> {
  const raw: RawEdge[] = []
  const ids = [...info.repositories.keys()]

  for (const repo of info.repositories.values()) {
    if (repo.kind === "directory") continue
    const root = repo.canonicalPath
    raw.push(...(await detectPackageJson(info, repo.id, root, ids)))
    raw.push(...(await detectOpenApi(info, repo.id, root, ids)))
    raw.push(...(await detectCompose(info, repo.id, root, ids)))
    raw.push(...(await detectDocsMentions(info, repo.id, root, ids)))
    raw.push(...(await detectTsImports(info, repo.id, root, ids)))
    raw.push(...(await detectContractFiles(info, repo.id, root, ids)))
    raw.push(...(await detectInfraFiles(info, repo.id, root, ids)))
    raw.push(...(await detectEventNames(info, repo.id, root, ids)))
  }

  return mergeEdges(raw.filter((e) => e.from !== e.to && !isSecretCandidatePath(e.evidence.path)))
}

async function detectPackageJson(
  info: Info,
  repositoryId: string,
  root: string,
  ids: string[],
): Promise<RawEdge[]> {
  const file = path.join(root, "package.json")
  const exists = await Bun.file(file).exists()
  if (!exists) return []
  const pkg = (await Bun.file(file).json()) as {
    name?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const out: RawEdge[] = []
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const [name, version] of Object.entries(deps)) {
    const fileDep = version.match(/^file:(.+)$/)
    if (fileDep) {
      const targetAbs = path.resolve(root, fileDep[1])
      const target = findRepoByPath(info, targetAbs)
      if (!target) continue
      out.push({
        from: repositoryId,
        to: target,
        kind: "build",
        confidence: "confirmed",
        source: "declared",
        evidence: {
          repositoryId,
          path: "package.json",
          description: `dependency "${name}": "${version}"`,
        },
      })
      continue
    }
    const byName = ids.find((id) => id === name || name.endsWith(`/${id}`) || name === `@local/${id}`)
    if (byName && byName !== repositoryId) {
      out.push({
        from: repositoryId,
        to: byName,
        kind: "build",
        confidence: "medium",
        source: "detected",
        evidence: {
          repositoryId,
          path: "package.json",
          description: `package name "${name}" matches repository id`,
        },
      })
    }
  }
  return out
}

async function detectOpenApi(
  _info: Info,
  repositoryId: string,
  root: string,
  ids: string[],
): Promise<RawEdge[]> {
  const candidates = ["openapi.yaml", "openapi.yml", "openapi.json", "api/openapi.yaml", "schema/openapi.yaml"]
  const out: RawEdge[] = []
  for (const rel of candidates) {
    const file = path.join(root, rel)
    if (!(await Bun.file(file).exists())) continue
    const text = await Bun.file(file).text()
    // Consumers often live in frontend/backend; schema repo publishes OpenAPI.
    for (const id of ids) {
      if (id === repositoryId) continue
      if (id === "frontend" || id === "backend" || /client|sdk|api/i.test(id)) {
        out.push({
          from: id,
          to: repositoryId,
          kind: "api",
          confidence: "high",
          source: "detected",
          evidence: {
            repositoryId,
            path: rel,
            description: `OpenAPI contract present; ${id} is a typical consumer`,
          },
        })
      }
    }
    if (/components:\s*\n\s*schemas:/m.test(text) || /"components"\s*:\s*\{\s*"schemas"/m.test(text)) {
      out.push({
        from: repositoryId,
        to: repositoryId,
        kind: "schema",
        confidence: "confirmed",
        source: "declared",
        evidence: { repositoryId, path: rel, description: "OpenAPI schemas section" },
      })
    }
  }
  return out.filter((e) => e.from !== e.to)
}

async function detectCompose(
  info: Info,
  repositoryId: string,
  root: string,
  ids: string[],
): Promise<RawEdge[]> {
  const names = ["docker-compose.yml", "docker-compose.yaml", "compose.yaml"]
  const out: RawEdge[] = []
  for (const rel of names) {
    const file = path.join(root, rel)
    if (!(await Bun.file(file).exists())) continue
    const text = await Bun.file(file).text()
    for (const id of ids) {
      if (id === repositoryId) continue
      if (new RegExp(`\\b${escapeReg(id)}\\b`).test(text) || text.includes(`../${id}`)) {
        out.push({
          from: repositoryId,
          to: id,
          kind: "deploy",
          confidence: "medium",
          source: "detected",
          evidence: {
            repositoryId,
            path: rel,
            description: `compose references repository "${id}"`,
          },
        })
      }
    }
    // context: ../backend style
    const contexts = text.matchAll(/context:\s*["']?(\.\.\/[^\s"']+)/g)
    for (const m of contexts) {
      const target = findRepoByPath(info, path.resolve(root, m[1]))
      if (!target || target === repositoryId) continue
      out.push({
        from: repositoryId,
        to: target,
        kind: "deploy",
        confidence: "high",
        source: "detected",
        evidence: { repositoryId, path: rel, description: `build context ${m[1]}` },
      })
    }
  }
  return out
}

async function detectDocsMentions(
  _info: Info,
  repositoryId: string,
  root: string,
  ids: string[],
): Promise<RawEdge[]> {
  const docs = ["README.md", "ARCHITECTURE.md", "docs/architecture.md", "adr/README.md"]
  const out: RawEdge[] = []
  for (const rel of docs) {
    const file = path.join(root, rel)
    if (!(await Bun.file(file).exists())) continue
    const text = await Bun.file(file).text()
    for (const id of ids) {
      if (id === repositoryId) continue
      if (new RegExp(`\\b${escapeReg(id)}\\b`, "i").test(text)) {
        out.push({
          from: repositoryId,
          to: id,
          kind: "docs",
          confidence: "low",
          source: "detected",
          evidence: {
            repositoryId,
            path: rel,
            description: `documentation mentions "${id}"`,
          },
        })
      }
    }
  }
  return out
}

async function detectTsImports(
  info: Info,
  repositoryId: string,
  root: string,
  ids: string[],
): Promise<RawEdge[]> {
  const out: RawEdge[] = []
  // Lightweight scan of a few entry files only (budget).
  const entries = ["package.json", "app.ts", "src/index.ts", "src/main.ts", "index.ts"]
  for (const rel of entries) {
    if (rel === "package.json") continue
    const file = path.join(root, rel)
    if (!(await Bun.file(file).exists())) continue
    const text = await Bun.file(file).text()
    const imports = text.matchAll(/from\s+["']([^"']+)["']/g)
    for (const m of imports) {
      const spec = m[1]
      if (!spec.startsWith(".") && !spec.startsWith("/")) {
        const hit = ids.find((id) => spec === id || spec.startsWith(`${id}/`) || spec === `@local/${id}`)
        if (hit && hit !== repositoryId) {
          out.push({
            from: repositoryId,
            to: hit,
            kind: "runtime",
            confidence: "medium",
            source: "detected",
            evidence: {
              repositoryId,
              path: rel,
              description: `import "${spec}"`,
            },
          })
        }
        continue
      }
      const abs = path.resolve(path.dirname(file), spec)
      const target = findRepoByPath(info, abs)
      if (target && target !== repositoryId) {
        out.push({
          from: repositoryId,
          to: target,
          kind: "runtime",
          confidence: "high",
          source: "detected",
          evidence: {
            repositoryId,
            path: rel,
            description: `relative import "${spec}"`,
          },
        })
      }
    }
  }
  return out
}

async function detectContractFiles(_info: Info, repositoryId: string, root: string, ids: string[]) {
  const out: RawEdge[] = []
  const candidates = [
    "schema.graphql",
    "schema.gql",
    "api.graphql",
    "proto/api.proto",
    "api.proto",
    "schema.prisma",
    "prisma/schema.prisma",
  ]
  for (const rel of candidates) {
    const file = path.join(root, rel)
    if (!(await Bun.file(file).exists())) continue
    const text = await Bun.file(file).text().catch(() => "")
    for (const id of ids) {
      if (id === repositoryId) continue
      if (text.includes(id) || rel.includes(id)) {
        out.push({
          from: repositoryId,
          to: id,
          kind: "api",
          confidence: "medium",
          source: "detected",
          evidence: {
            repositoryId,
            path: rel,
            description: `contract/schema file references "${id}"`,
          },
        })
      }
    }
  }
  return out
}

async function detectInfraFiles(_info: Info, repositoryId: string, root: string, ids: string[]) {
  const out: RawEdge[] = []
  const candidates = [
    "main.tf",
    "terraform/main.tf",
    "k8s/deployment.yaml",
    "deploy/k8s.yaml",
    ".github/workflows/ci.yml",
    ".github/workflows/ci.yaml",
  ]
  for (const rel of candidates) {
    const file = path.join(root, rel)
    if (!(await Bun.file(file).exists())) continue
    const text = await Bun.file(file).text().catch(() => "")
    for (const id of ids) {
      if (id === repositoryId) continue
      if (text.includes(id)) {
        out.push({
          from: repositoryId,
          to: id,
          kind: "deploy",
          confidence: "low",
          source: "detected",
          evidence: {
            repositoryId,
            path: rel,
            description: `infra/CI mention of "${id}"`,
          },
        })
      }
    }
  }
  return out
}

async function detectEventNames(_info: Info, repositoryId: string, root: string, ids: string[]) {
  const out: RawEdge[] = []
  const candidates = ["src/events.ts", "src/events.js", "events.ts", "pkg/events.go", "app/events.py"]
  for (const rel of candidates) {
    const file = path.join(root, rel)
    if (!(await Bun.file(file).exists())) continue
    const text = await Bun.file(file).text().catch(() => "")
    const topics = text.matchAll(/(?:topic|queue|subject|event(?:Name)?)\s*[:=]\s*["']([^"']+)["']/gi)
    for (const m of topics) {
      const name = m[1]
      for (const id of ids) {
        if (id === repositoryId) continue
        if (name.includes(id)) {
          out.push({
            from: repositoryId,
            to: id,
            kind: "event",
            confidence: "low",
            source: "detected",
            evidence: {
              repositoryId,
              path: rel,
              description: `event/queue reference "${name}"`,
            },
          })
        }
      }
    }
  }
  return out
}

function findRepoByPath(info: Info, absolutePath: string): string | undefined {
  const normalized = path.resolve(absolutePath)
  let best: { id: string; len: number } | undefined
  for (const repo of info.repositories.values()) {
    const root = repo.canonicalPath
    if (normalized === root || normalized.startsWith(root + path.sep)) {
      if (!best || root.length > best.len) best = { id: repo.id, len: root.length }
    }
  }
  return best?.id
}

function mergeEdges(raw: RawEdge[]): RepositoryEdge[] {
  const map = new Map<string, RepositoryEdge>()
  for (const e of raw) {
    const key = `${e.from}->${e.to}:${e.kind}:${e.source}`
    const prev = map.get(key)
    if (!prev) {
      map.set(key, {
        from: e.from,
        to: e.to,
        kind: e.kind,
        confidence: e.confidence,
        source: e.source,
        evidence: [e.evidence],
      })
      continue
    }
    prev.evidence.push(e.evidence)
    prev.confidence = higherConfidence(prev.confidence, e.confidence)
  }
  return [...map.values()]
}

function higherConfidence(a: EdgeConfidence, b: EdgeConfidence): EdgeConfidence {
  const rank: Record<EdgeConfidence, number> = { low: 0, medium: 1, high: 2, confirmed: 3 }
  return rank[a] >= rank[b] ? a : b
}

function escapeReg(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
