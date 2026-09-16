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
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "ts", "json"],
  modulePathIgnorePatterns: [
    "dist/",
    "<rootDir>/.medusa/",
    "<rootDir>/restaurant-marketplace/",
  ],
  setupFiles: ["./integration-tests/setup.js"],
};

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = ["**/integration-tests/http/*.spec.[jt]s"];
  // Module/app integration runners create a DB and run all migrations in
  // beforeAll; the 5s Jest default trips on cold CI runners. Jest applies
  // testTimeout to hooks too.
  module.exports.testTimeout = 120000;
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
