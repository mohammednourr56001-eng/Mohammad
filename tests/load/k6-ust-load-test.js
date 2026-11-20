import http from 'k6/http';
import { check, sleep } from 'k6';

// =============================================================================
// UST Platform — k6 Distributed Load Test Suite
// Usage: k6 run -e BASE_URL=https://your-staging-url.run.app tests/load/k6-ust-load-test.js
// =============================================================================
export const options = {
  scenarios: {
    browse_catalog_spike: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '1m', target: 100 },
        { duration: '2m', target: 500 },
        { duration: '2m', target: 1000 },
        { duration: '1m', target: 0 },
      ],
      exec: 'browseCatalog',
    },
    exam_list_concurrency: {
      executor: 'constant-vus',
      vus: 100,
      duration: '3m',
      exec: 'readExams',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // < 1% errors
    http_req_duration: ['p(95)<250', 'p(99)<600'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export function browseCatalog() {
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { 'health status 200': (r) => r.status === 200 });

  const catalog = http.get(`${BASE_URL}/api/catalog/lectures`);
  check(catalog, {
    'catalog status 200': (r) => r.status === 200,
    'catalog has specializations': (r) => r.body.includes('specializations'),
  });
  sleep(1);
}

export function readExams() {
  const res = http.get(`${BASE_URL}/api/exams`);
  check(res, {
    'exams status 200': (r) => r.status === 200,
    'exams JSON returned': (r) => r.body.includes('exams'),
  });
  sleep(0.8);
}
