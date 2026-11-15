const { loadEnv } = require("@medusajs/utils");
loadEnv("test", process.cwd());

module.exports = {
  transform: {
    "^.+\\.[jt]s$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: true },
        },
      },
    ],
    // The React Email templates (src/modules/resend/emails/*.tsx), so a spec
    // can render the real thing (email-render.unit.spec.ts). Same runtime as
    // tsconfig's "jsx": "react-jsx".
    "^.+\\.tsx$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true, decorators: true },
          transform: { react: { runtime: "automatic" } },
        },
      },
    ],
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "tsx", "json"],
  modulePathIgnorePatterns: [
    "dist/",
    "<rootDir>/.medusa/",
    "<rootDir>/restaurant-marketplace/",
  ],
  setupFiles: ["./integration-tests/setup.js"],
  // MikroORM writes a schema snapshot per module per test database and never
  // cleans them up; a full integration pass leaks ~7 GB. See the file header.
  globalTeardown: "./integration-tests/prune-orm-snapshots.js",
};

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = ["**/integration-tests/http/*.spec.[jt]s"];
  // Module/app integration runners create a DB and run all migrations in
  // beforeAll; the 5s Jest default trips on cold CI runners. Jest applies
  // testTimeout to hooks too.
  module.exports.testTimeout = 120000;
  // The runner's wait between tests never ends on a workflow execution left
  // unfinished (SD-53 (d)); bound it, under that hook timeout, before any
  // spec loads it.
  module.exports.setupFiles = [
    ...module.exports.setupFiles,
    "./integration-tests/http/helpers/install-runner-wait-bound.ts",
  ];
} else if (process.env.TEST_TYPE === "integration:modules") {
  // Require `.spec.` like the other two modes do. Matching every .ts under a
  // module's __tests__ dir also matched shared helper files, and Jest fails a
  // "suite" that declares no tests — so adding a fixtures file to any module
  // broke the run. Both *.unit.spec.ts and *.integration.spec.ts still match,
  // so this drops nothing that was being tested.
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.spec.[jt]s"];
  module.exports.testTimeout = 120000;
} else if (process.env.TEST_TYPE === "unit") {
  module.exports.testMatch = ["**/src/**/__tests__/**/*.unit.spec.[jt]s"];
}


module.exports.coverageReporters = ["text", "json-summary"];
