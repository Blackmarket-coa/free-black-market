import http from "k6/http"
import { check, sleep } from "k6"
import { Rate } from "k6/metrics"

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000"
const DURATION = __ENV.K6_DURATION || "1m"

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
    const ok = check(res, {
      "status < 500": (r) => r.status < 500,
    })
    failureRate.add(!ok)
    sleep(0.5)
  }
}
