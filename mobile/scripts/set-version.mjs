#!/usr/bin/env node
/**
 * Set the app version across both native projects in one step.
 *
 *   node scripts/set-version.mjs 1.2.0 7
 *   pnpm version:set 1.2.0 7
 *
 * Android `versionCode` and iOS `CFBundleVersion` must increase monotonically
 * for every store upload — a collision is rejected at upload time, after the
 * build. So the build number is checked against what is currently committed
 * and a non-increasing value is refused here, where it costs nothing.
 * `--allow-same-build` exists for re-cutting a build that never reached a
 * store.
 *
 * The rewrite functions are pure and exported so they can be tested without
 * touching the working tree (see test/set-version.test.mjs).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const MOBILE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..")
export const GRADLE_PATH = join(MOBILE_DIR, "android/app/build.gradle")
export const PBXPROJ_PATH = join(
  MOBILE_DIR,
  "ios/App/App.xcodeproj/project.pbxproj"
)

/** Marketing versions are MAJOR.MINOR.PATCH; stores reject anything else. */
export function parseVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value ?? "")) {
    throw new Error(
      `version must be MAJOR.MINOR.PATCH (got ${JSON.stringify(value)})`
    )
  }
  return value
}

export function parseBuild(value) {
  if (!/^\d+$/.test(String(value ?? ""))) {
    throw new Error(
      `build number must be a positive integer (got ${JSON.stringify(value)})`
    )
  }
  const n = Number(value)
  if (n < 1) throw new Error("build number must be >= 1")
  return n
}

/** What the Gradle file currently declares — the source of truth for both. */
export function readCurrent(gradle) {
  const version = gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? null
  const build = gradle.match(/versionCode\s+(\d+)/)?.[1] ?? null
  return { version, build: build === null ? null : Number(build) }
}

export function bumpGradle(gradle, { version, build }) {
  let seenName = 0
  let seenCode = 0
  const out = gradle
    .replace(/versionName\s+"[^"]+"/g, () => {
      seenName++
      return `versionName "${version}"`
    })
    .replace(/versionCode\s+\d+/g, () => {
      seenCode++
      return `versionCode ${build}`
    })
  if (seenName !== 1 || seenCode !== 1) {
    throw new Error(
      `expected exactly one versionName and one versionCode in build.gradle, ` +
        `found ${seenName} and ${seenCode}`
    )
  }
  return out
}

export function bumpPbxproj(pbxproj, { version, build }) {
  let seenMarketing = 0
  let seenProject = 0
  const out = pbxproj
    .replace(/MARKETING_VERSION = [^;]+;/g, () => {
      seenMarketing++
      return `MARKETING_VERSION = ${version};`
    })
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, () => {
      seenProject++
      return `CURRENT_PROJECT_VERSION = ${build};`
    })
  // Debug and Release configurations — both must move together, or a TestFlight
  // build and an App Store build report different versions from one commit.
  if (seenMarketing < 1 || seenMarketing !== seenProject) {
    throw new Error(
      `expected matching MARKETING_VERSION/CURRENT_PROJECT_VERSION counts in ` +
        `project.pbxproj, found ${seenMarketing} and ${seenProject}`
    )
  }
  return out
}

function main(argv) {
  const allowSame = argv.includes("--allow-same-build")
  const [rawVersion, rawBuild] = argv.filter((a) => !a.startsWith("--"))
  if (!rawVersion) {
    console.error(
      "usage: set-version.mjs <MAJOR.MINOR.PATCH> <buildNumber> [--allow-same-build]"
    )
    process.exit(2)
  }
  const version = parseVersion(rawVersion)
  const build = parseBuild(rawBuild)

  const gradle = readFileSync(GRADLE_PATH, "utf8")
  const pbxproj = readFileSync(PBXPROJ_PATH, "utf8")
  const current = readCurrent(gradle)

  if (current.build !== null && build < current.build) {
    throw new Error(
      `build number ${build} is lower than the current ${current.build}; ` +
        `store uploads require a monotonically increasing build number`
    )
  }
  if (current.build !== null && build === current.build && !allowSame) {
    throw new Error(
      `build number ${build} is already committed; pass --allow-same-build ` +
        `only if that build never reached a store`
    )
  }

  writeFileSync(GRADLE_PATH, bumpGradle(gradle, { version, build }))
  writeFileSync(PBXPROJ_PATH, bumpPbxproj(pbxproj, { version, build }))
  console.log(
    `${current.version ?? "?"} (${current.build ?? "?"}) -> ${version} (${build})`
  )
  console.log("updated android/app/build.gradle and ios/.../project.pbxproj")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`set-version: ${error.message}`)
    process.exit(1)
  }
}
