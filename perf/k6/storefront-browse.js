import http from "k6/http"
import { check, sleep } from "k6"
import { Rate } from "k6/metrics"

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"
// PERF_DURATION, not K6_DURATION: k6 treats K6_DURATION as its own --duration
// option, which overrides `scenarios` with a single one-VU default scenario.
const DURATION = __ENV.PERF_DURATION || "1m"

const failureRate = new Rate("failed_requests")

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "10s", target: 5 },
        { duration: DURATION, target: 20 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],          // < 1% failed requests
    http_req_duration: ["p(95)<800"],        // P95 < 800 ms
    failed_requests: ["rate<0.01"],
  },
}

const PATHS = [
  "/api/health",
  "/",
  "/products",
  "/collections",
]

export default function () {
  for (const path of PATHS) {
    const res = http.get(`${BASE_URL}${path}`)
    // A refused connection has status 0, which the old "status < 500" check
    // counted as a success: every request in the nightly failed while
    // failed_requests reported 0%. Require a real HTTP response.
    const ok = check(res, {
      "got an HTTP response below 500": (r) => r.status >= 200 && r.status < 500,
    })
    failureRate.add(!ok)
    sleep(0.5)
  }
}
