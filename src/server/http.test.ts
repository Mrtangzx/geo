import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./errors";
import { readJsonBody } from "./http";

function browserRequest(origin: string, host = "127.0.0.1:3000") {
  return new Request("http://localhost:3000/api/projects", {
    method: "POST",
    headers: { origin, host, "content-type": "application/json" },
    body: JSON.stringify({ name: "合成回归资料" }),
  });
}

test("accepts the actual browser destination when Next uses an internal hostname", async () => {
  assert.deepEqual(await readJsonBody(browserRequest("http://127.0.0.1:3000")), {
    name: "合成回归资料",
  });
});

test("rejects a foreign browser origin even when forwarding headers claim it", async () => {
  const request = browserRequest("https://untrusted.example");
  request.headers.set("x-forwarded-host", "untrusted.example");
  request.headers.set("x-forwarded-proto", "https");
  await assert.rejects(readJsonBody(request), (error: unknown) =>
    error instanceof AppError && error.status === 403 && error.code === "ORIGIN_REJECTED");
});

test("rejects malformed and opaque origins", async () => {
  for (const origin of ["null", "not-an-origin"]) {
    await assert.rejects(readJsonBody(browserRequest(origin)), (error: unknown) =>
      error instanceof AppError && error.status === 403);
  }
});
