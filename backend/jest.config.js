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
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.[jt]s"];
  module.exports.testTimeout = 120000;
} else if (process.env.TEST_TYPE === "unit") {
  module.exports.testMatch = ["**/src/**/__tests__/**/*.unit.spec.[jt]s"];
}


module.exports.coverageReporters = ["text", "json-summary"];
