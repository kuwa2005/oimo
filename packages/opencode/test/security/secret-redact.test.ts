import { describe, expect, test } from "bun:test"
import { redactSecrets, redactUserParts } from "../../src/security/secret-redact"

describe("redactSecrets — must catch", () => {
  test("aws access key", () => {
    const r = redactSecrets("key=AKIAIOSFODNN7EXAMPLE ok")
    expect(r.redacted).toBe(true)
    expect(r.hits).toContain("aws_key")
    expect(r.text).not.toContain("AKIAIOSFODNN7EXAMPLE")
    expect(r.text).toContain("[REDACTED:aws_key]")
  })

  test("bearer token", () => {
    const r = redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaaaaaaa.bbbbbbbbbb")
    expect(r.redacted).toBe(true)
    expect(r.hits.length).toBeGreaterThan(0)
    expect(r.text).not.toMatch(/Bearer\s+eyJ/)
  })

  test("jwt three segments", () => {
    const r = redactSecrets("tok=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaaaaaaa.bbbbbbbbbb")
    expect(r.redacted).toBe(true)
    expect(r.hits).toContain("jwt")
  })

  test("pem private key", () => {
    const r = redactSecrets("-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----")
    expect(r.redacted).toBe(true)
    expect(r.hits).toContain("private_key")
    expect(r.text).not.toContain("BEGIN PRIVATE KEY")
  })

  test("connection string", () => {
    const r = redactSecrets("db=postgres://user:s3cretPass@host:5432/app")
    expect(r.redacted).toBe(true)
    expect(r.hits).toContain("connection_string")
    expect(r.text).not.toContain("s3cretPass")
  })

  test("password assignment long value", () => {
    const r = redactSecrets("password: 'hunter2hunter2'")
    expect(r.redacted).toBe(true)
    expect(r.hits).toContain("generic_token")
    expect(r.text).not.toContain("hunter2hunter2")
  })

  test("github token", () => {
    const r = redactSecrets("export GH=ghp_abcdefghijklmnopqrstuvwxyz0123456789")
    expect(r.redacted).toBe(true)
    expect(r.hits).toContain("github_token")
  })

  test("openai key", () => {
    const r = redactSecrets("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz012345")
    expect(r.redacted).toBe(true)
    expect(r.hits).toContain("openai_key")
  })
})

describe("redactSecrets — must not false-positive", () => {
  test("TypeScript optional password field", () => {
    const src = "type Cfg = { password?: string; apiKey?: string }"
    const r = redactSecrets(src)
    expect(r.redacted).toBe(false)
    expect(r.text).toBe(src)
  })

  test("comment about setting password", () => {
    const src = "// set your password in the dashboard"
    expect(redactSecrets(src).redacted).toBe(false)
  })

  test("placeholder password values", () => {
    expect(redactSecrets('password: "***"').redacted).toBe(false)
    expect(redactSecrets("password=changeme").redacted).toBe(false)
    expect(redactSecrets("api_key=<your-api-key>").redacted).toBe(false)
    expect(redactSecrets("token: REDACTED").redacted).toBe(false)
    expect(redactSecrets("password=$PASSWORD").redacted).toBe(false)
  })

  test("short dummy under length floor", () => {
    expect(redactSecrets("password: short").redacted).toBe(false)
  })

  test("plain base64-ish without jwt shape", () => {
    const src = "data=YWJjZGVmZ2hpamtsbW5vcA=="
    expect(redactSecrets(src).redacted).toBe(false)
  })

  test("variable names alone", () => {
    const src = "const apiKey = process.env.API_KEY\nconst password = getPassword()"
    expect(redactSecrets(src).redacted).toBe(false)
  })

  test("example README code without real aws key shape is untouched", () => {
    const src = "export AWS_ACCESS_KEY_ID=YOUR_KEY_HERE\n# see docs"
    expect(redactSecrets(src).redacted).toBe(false)
  })

  test("truncated AKIA is still masked (correct for compliance)", () => {
    // Document writing with real-shaped examples should use --compliance off.
    expect(redactSecrets("AKIAIOSFODNN7EXAMPLE").redacted).toBe(true)
  })
})

describe("redactSecrets — UX / safety", () => {
  test("replacement never embeds original secret", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE"
    const r = redactSecrets(`use ${secret} please`)
    expect(r.text.includes(secret)).toBe(false)
    expect(JSON.stringify(r.hits).includes(secret)).toBe(false)
  })

  test("context around secret remains", () => {
    const r = redactSecrets("Please upload to S3 with AKIAIOSFODNN7EXAMPLE then list buckets")
    expect(r.text).toContain("Please upload to S3 with")
    expect(r.text).toContain("then list buckets")
  })

  test("large paste stays fast and still catches", () => {
    const pad = "x".repeat(200_000)
    const body = `${pad}\npassword: 'real-secret-value-here'\n${pad}`
    const t0 = performance.now()
    const r = redactSecrets(body)
    const ms = performance.now() - t0
    expect(r.redacted).toBe(true)
    expect(ms).toBeLessThan(500)
  })

  test("off path identity: empty hits when clean", () => {
    const src = "refactor the auth module please"
    const r = redactSecrets(src)
    expect(r).toEqual({ text: src, redacted: false, hits: [] })
  })
})

describe("redactUserParts", () => {
  test("skips synthetic text", () => {
    const parts = [
      { type: "text" as const, text: "password: 'hunter2hunter2'", synthetic: true },
      { type: "text" as const, text: "hello AKIAIOSFODNN7EXAMPLE" },
    ]
    const r = redactUserParts(parts)
    expect(r.parts[0].text).toContain("hunter2hunter2")
    expect(r.parts[1].text).not.toContain("AKIAIOSFODNN7EXAMPLE")
    expect(r.redacted).toBe(true)
  })
})
