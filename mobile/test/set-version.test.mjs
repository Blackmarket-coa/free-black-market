import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  GRADLE_PATH,
  PBXPROJ_PATH,
  bumpGradle,
  bumpPbxproj,
  parseBuild,
  parseVersion,
  readCurrent,
} from "../scripts/set-version.mjs"

// The real files, read but never written — these assertions are what catch a
// Capacitor regeneration silently changing the shape the script depends on.
const GRADLE = readFileSync(GRADLE_PATH, "utf8")
const PBXPROJ = readFileSync(PBXPROJ_PATH, "utf8")

test("parseVersion accepts MAJOR.MINOR.PATCH and rejects the rest", () => {
  assert.equal(parseVersion("1.2.0"), "1.2.0")
  assert.equal(parseVersion("10.0.11"), "10.0.11")
  for (const bad of ["1.2", "1", "v1.2.0", "1.2.0-beta", "", null, undefined]) {
    assert.throws(() => parseVersion(bad), /MAJOR\.MINOR\.PATCH/)
  }
})

test("parseBuild accepts positive integers only", () => {
  assert.equal(parseBuild("7"), 7)
  assert.equal(parseBuild(7), 7)
  for (const bad of ["0", "-1", "1.5", "abc", "", null, undefined]) {
    assert.throws(() => parseBuild(bad))
  }
})

test("readCurrent reads the committed version out of build.gradle", () => {
  const current = readCurrent(GRADLE)
  assert.equal(typeof current.version, "string")
  assert.equal(typeof current.build, "number")
  assert.match(current.version, /^\d+\.\d+\.\d+$/)
})

test("bumpGradle rewrites both fields in the real file", () => {
  const out = bumpGradle(GRADLE, { version: "2.3.4", build: 12 })
  assert.match(out, /versionName "2\.3\.4"/)
  assert.match(out, /versionCode 12/)
  assert.deepEqual(readCurrent(out), { version: "2.3.4", build: 12 })
  // Nothing else moved: exactly two lines differ.
  const changed = out
    .split("\n")
    .filter((line, i) => line !== GRADLE.split("\n")[i])
  assert.equal(changed.length, 2)
})

test("bumpGradle refuses a file that lost its version fields", () => {
  assert.throws(
    () => bumpGradle("android { }", { version: "1.0.0", build: 1 }),
    /expected exactly one versionName and one versionCode/
  )
})

test("bumpPbxproj moves Debug and Release together", () => {
  const out = bumpPbxproj(PBXPROJ, { version: "2.3.4", build: 12 })
  const marketing = [...out.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(
    (m) => m[1]
  )
  const project = [...out.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map(
    (m) => m[1]
  )
  assert.ok(marketing.length >= 2, "expected Debug and Release configs")
  assert.equal(marketing.length, project.length)
  assert.deepEqual(new Set(marketing), new Set(["2.3.4"]))
  assert.deepEqual(new Set(project), new Set(["12"]))
})

test("bumpPbxproj refuses a file with mismatched version keys", () => {
  assert.throws(
    () => bumpPbxproj("MARKETING_VERSION = 1.0;", { version: "1.0.0", build: 1 }),
    /matching MARKETING_VERSION\/CURRENT_PROJECT_VERSION counts/
  )
})

test("the two platforms currently agree on version and build", () => {
  // A drift here means someone edited one project by hand — exactly the
  // failure this script exists to prevent.
  const { version, build } = readCurrent(GRADLE)
  const marketing = new Set(
    [...PBXPROJ.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1])
  )
  const project = new Set(
    [...PBXPROJ.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1])
  )
  assert.deepEqual(marketing, new Set([version]), "iOS marketing version drift")
  assert.deepEqual(project, new Set([String(build)]), "iOS build number drift")
})
