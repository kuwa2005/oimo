import { describe, expect, test } from "bun:test"
import path from "path"
import { formatSessionDirectory, sameDirectory } from "../../../src/cli/cmd/tui/util/switch-directory"

describe("switch-directory", () => {
  test("sameDirectory compares resolved paths", () => {
    expect(sameDirectory("/tmp/foo", "/tmp/foo/")).toBe(true)
    expect(sameDirectory("/tmp/foo", "/tmp/bar")).toBe(false)
    expect(sameDirectory(undefined, "/tmp/foo")).toBe(false)
  })

  test("formatSessionDirectory shows basename and path", () => {
    const dir = path.join("/home", "ubuntu", "workspace", "oimo")
    expect(formatSessionDirectory(dir)).toContain("oimo")
    expect(formatSessionDirectory(dir, dir)).not.toContain("(")
  })
})
