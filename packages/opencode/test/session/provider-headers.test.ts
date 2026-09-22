import { afterEach, describe, expect, test } from "bun:test"
import {
  OIMO_USER_AGENT,
  ZEN_COMPAT_VERSION,
  ZEN_USER_AGENT,
  oimoUserAgent,
  providerRequestHeaders,
  resolveOpencodeClient,
  zenCompatVersion,
  zenUserAgent,
} from "../../src/session/provider-headers"

const ORIGINAL_CLIENT = process.env.MIMOCODE_CLIENT
const ORIGINAL_OPENCODE_CLIENT = process.env.OPENCODE_CLIENT

describe("zenCompatVersion", () => {
  test("raises fork / local versions to the Console free-tier floor", () => {
    expect(zenCompatVersion("0.3.0")).toBe(ZEN_COMPAT_VERSION)
    expect(zenCompatVersion("local")).toBe(ZEN_COMPAT_VERSION)
    expect(zenCompatVersion("1.17.99")).toBe(ZEN_COMPAT_VERSION)
    expect(zenCompatVersion("1.18.0")).toBe(ZEN_COMPAT_VERSION)
  })

  test("keeps versions already at or above the floor", () => {
    expect(zenCompatVersion(ZEN_COMPAT_VERSION)).toBe(ZEN_COMPAT_VERSION)
    expect(zenCompatVersion("1.18.32")).toBe("1.18.32")
    expect(zenCompatVersion("1.18.33")).toBe("1.18.33")
    expect(zenCompatVersion("2.0.0")).toBe("2.0.0")
  })
})

describe("resolveOpencodeClient", () => {
  afterEach(() => {
    if (ORIGINAL_CLIENT === undefined) delete process.env.MIMOCODE_CLIENT
    else process.env.MIMOCODE_CLIENT = ORIGINAL_CLIENT
    if (ORIGINAL_OPENCODE_CLIENT === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = ORIGINAL_OPENCODE_CLIENT
  })

  test("defaults to cli", () => {
    delete process.env.MIMOCODE_CLIENT
    delete process.env.OPENCODE_CLIENT
    expect(resolveOpencodeClient()).toBe("cli")
  })

  test("OPENCODE_CLIENT wins over MIMOCODE_CLIENT", () => {
    process.env.MIMOCODE_CLIENT = "desktop"
    process.env.OPENCODE_CLIENT = "acp"
    expect(resolveOpencodeClient()).toBe("acp")
  })

  test("explicit arg wins over env", () => {
    process.env.OPENCODE_CLIENT = "desktop"
    expect(resolveOpencodeClient("app")).toBe("app")
  })
})

describe("providerRequestHeaders", () => {
  afterEach(() => {
    if (ORIGINAL_CLIENT === undefined) delete process.env.MIMOCODE_CLIENT
    else process.env.MIMOCODE_CLIENT = ORIGINAL_CLIENT
    if (ORIGINAL_OPENCODE_CLIENT === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = ORIGINAL_OPENCODE_CLIENT
  })

  test("Zen / big-pickle: official-compatible identity headers", () => {
    delete process.env.MIMOCODE_CLIENT
    delete process.env.OPENCODE_CLIENT
    const headers = providerRequestHeaders({
      providerID: "opencode",
      sessionID: "ses_abc",
      requestID: "msg_123",
      projectID: "prj_xyz",
      parentSessionID: "ses_parent",
    })

    expect(headers["User-Agent"]).toBe(zenUserAgent())
    expect(headers["User-Agent"]).toBe(ZEN_USER_AGENT)
    expect(headers["User-Agent"]).toBe(`opencode/${ZEN_COMPAT_VERSION}`)
    expect(headers["User-Agent"].startsWith("opencode/")).toBe(true)
    expect(headers["x-opencode-client"]).toBe("cli")
    expect(headers["x-opencode-session"]).toBe("ses_abc")
    expect(headers["x-opencode-request"]).toBe("msg_123")
    expect(headers["x-opencode-project"]).toBe("prj_xyz")
    expect(headers["x-session-affinity"]).toBeUndefined()
    expect(headers["x-parent-session-id"]).toBe("ses_parent")
  })

  test("Zen: x-opencode-client follows MIMOCODE_CLIENT (default cli)", () => {
    delete process.env.OPENCODE_CLIENT
    process.env.MIMOCODE_CLIENT = "desktop"
    const headers = providerRequestHeaders({
      providerID: "opencode",
      sessionID: "ses_1",
    })
    expect(headers["x-opencode-client"]).toBe("desktop")
  })

  test("Zen: OPENCODE_CLIENT aliases upstream flag", () => {
    delete process.env.MIMOCODE_CLIENT
    process.env.OPENCODE_CLIENT = "app"
    const headers = providerRequestHeaders({
      providerID: "opencode",
      sessionID: "ses_1",
    })
    expect(headers["x-opencode-client"]).toBe("app")
  })

  test("Zen: explicit client arg wins over env", () => {
    process.env.MIMOCODE_CLIENT = "desktop"
    const headers = providerRequestHeaders({
      providerID: "opencode",
      client: "acp",
      sessionID: "ses_1",
    })
    expect(headers["x-opencode-client"]).toBe("acp")
  })

  test("Zen: providerID prefix match (opencode-go)", () => {
    delete process.env.MIMOCODE_CLIENT
    delete process.env.OPENCODE_CLIENT
    const headers = providerRequestHeaders({
      providerID: "opencode-go",
      sessionID: "ses_1",
      requestID: "msg_1",
    })
    expect(headers["User-Agent"]).toBe(ZEN_USER_AGENT)
    expect(headers["x-opencode-session"]).toBe("ses_1")
    expect(headers["x-opencode-client"]).toBe("cli")
  })

  test("Zen: identity headers win over extra User-Agent", () => {
    const headers = providerRequestHeaders({
      providerID: "opencode",
      sessionID: "ses_1",
      parentSessionID: "ses_parent",
      extra: { "User-Agent": "oimo/spoof", "x-custom": "keep" },
    })
    expect(headers["User-Agent"]).toBe(ZEN_USER_AGENT)
    expect(headers["x-custom"]).toBe("keep")
    expect(headers["x-parent-session-id"]).toBe("ses_parent")
  })

  test("non-Zen: oimo UA + session affinity; extra/plugin can override UA", () => {
    const headers = providerRequestHeaders({
      providerID: "anthropic",
      sessionID: "ses_abc",
      requestID: "msg_123",
      parentSessionID: "ses_parent",
      extra: { Authorization: "Bearer x" },
    })

    expect(headers["User-Agent"]).toBe(oimoUserAgent())
    expect(headers["User-Agent"]).toBe(OIMO_USER_AGENT)
    expect(headers["User-Agent"].startsWith("oimo/")).toBe(true)
    expect(headers["x-session-affinity"]).toBe("ses_abc")
    expect(headers["X-Session-Id"]).toBe("ses_abc")
    expect(headers["x-parent-session-id"]).toBe("ses_parent")
    expect(headers["Authorization"]).toBe("Bearer x")
    expect(headers["x-opencode-client"]).toBeUndefined()
    expect(headers["x-opencode-session"]).toBeUndefined()
  })

  test("non-Zen: Codex-style plugin User-Agent wins (upstream merge order)", () => {
    const headers = providerRequestHeaders({
      providerID: "openai",
      sessionID: "ses_1",
      extra: {
        originator: "opencode",
        "User-Agent": "opencode/1.18.19 (linux 6.1; x64)",
      },
    })
    expect(headers["User-Agent"]).toBe("opencode/1.18.19 (linux 6.1; x64)")
    expect(headers.originator).toBe("opencode")
    expect(headers["x-session-affinity"]).toBe("ses_1")
  })

  test("omits empty optional fields", () => {
    delete process.env.MIMOCODE_CLIENT
    delete process.env.OPENCODE_CLIENT
    const zen = providerRequestHeaders({ providerID: "opencode" })
    expect(zen["x-opencode-session"]).toBeUndefined()
    expect(zen["x-opencode-request"]).toBeUndefined()
    expect(zen["x-opencode-project"]).toBeUndefined()
    expect(zen["x-opencode-client"]).toBe("cli")
    expect(zen["User-Agent"]).toBe(ZEN_USER_AGENT)

    const other = providerRequestHeaders({ providerID: "openai" })
    expect(other["x-session-affinity"]).toBeUndefined()
    expect(other["x-parent-session-id"]).toBeUndefined()
    expect(other["User-Agent"]).toBe(OIMO_USER_AGENT)
  })
})
