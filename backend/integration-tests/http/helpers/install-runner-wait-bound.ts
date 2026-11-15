// integration:http setupFiles (jest.config.js): bound the runner's wait
// between tests before any spec loads @medusajs/test-utils (SD-53 (d),
// see bound-runner-wait.ts).
import { installRunnerWaitBound } from "./bound-runner-wait"

installRunnerWaitBound()
