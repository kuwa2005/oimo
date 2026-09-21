import { describe, expect, test } from "bun:test"
import * as ConfigCompliance from "../../src/config/compliance"

describe("ConfigCompliance.redactInput", () => {
  test("default off", () => {
    const prev = process.env.MIMOCODE_COMPLIANCE
    delete process.env.MIMOCODE_COMPLIANCE
    expect(ConfigCompliance.redactInput({})).toBe(false)
    expect(ConfigCompliance.redactInput({ compliance: { redact_input: false } })).toBe(false)
    if (prev !== undefined) process.env.MIMOCODE_COMPLIANCE = prev
  })

  test("config opt-in", () => {
    const prev = process.env.MIMOCODE_COMPLIANCE
    delete process.env.MIMOCODE_COMPLIANCE
    expect(ConfigCompliance.redactInput({ compliance: { redact_input: true } })).toBe(true)
    if (prev !== undefined) process.env.MIMOCODE_COMPLIANCE = prev
    else delete process.env.MIMOCODE_COMPLIANCE
  })

  test("env overrides off config", () => {
    const prev = process.env.MIMOCODE_COMPLIANCE
    process.env.MIMOCODE_COMPLIANCE = "1"
    expect(ConfigCompliance.redactInput({ compliance: { redact_input: false } })).toBe(true)
    if (prev !== undefined) process.env.MIMOCODE_COMPLIANCE = prev
    else delete process.env.MIMOCODE_COMPLIANCE
  })
})
