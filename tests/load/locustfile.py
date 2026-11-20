from locust import HttpUser, task, between

# =============================================================================
# UST Platform — Locust Load Testing Suite
# Usage: locust -f tests/load/locustfile.py --host=http://127.0.0.1:3000
# =============================================================================
class UstStudentUser(HttpUser):
    wait_time = between(0.5, 2.5)

    @task(4)
    def browse_lectures_catalog(self):
        with self.client.get("/api/catalog/lectures", catch_response=True) as resp:
            if resp.status_code != 200:
                resp.failure(f"Catalog failed with {resp.status_code}")

    @task(2)
    def browse_exams(self):
        with self.client.get("/api/exams", catch_response=True) as resp:
            if resp.status_code != 200:
                resp.failure(f"Exams failed with {resp.status_code}")

    @task(1)
    def check_liveness(self):
        self.client.get("/api/liveness")
