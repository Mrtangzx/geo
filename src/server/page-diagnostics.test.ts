import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { inspectRobots } from "./page-diagnostics";

test("robots wildcard matching preserves path and terminal-anchor semantics", () => {
  const cases = [
    ["/*aaa$", "/aaaXaaa", "disallowed"],
    ["/foo*bar$", "/fooXXbar", "disallowed"],
    ["/foo*bar$", "/fooXXbarX", "allowed"],
    ["*foo*bar$", "/fooXXbar", "disallowed"],
    ["/*foo*", "/fooXX", "disallowed"],
    ["/foo*", "/fo", "allowed"],
  ] as const;
  for (const [rule, path, expected] of cases) {
    assert.equal(inspectRobots(`User-agent: *\nDisallow: ${rule}`, `https://public.example${path}`).crawlerAccess, expected);
  }
});

test("robots combines longest applicable rules and favors Allow at equal specificity", () => {
  const body = "User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /same*\nAllow: /same*\nUser-agent: GPTBot\nDisallow: /";
  assert.equal(inspectRobots(body, "https://public.example/private/secret").crawlerAccess, "disallowed");
  assert.equal(inspectRobots(body, "https://public.example/private/public").crawlerAccess, "allowed");
  assert.equal(inspectRobots(body, "https://public.example/same/file").crawlerAccess, "allowed");
});

test("adversarial wildcard rules finish inside an isolated hard timeout", async () => {
  const moduleUrl = pathToFileURL(resolve("src/server/page-diagnostics.ts")).href;
  const script = `
    import assert from "node:assert/strict";
    import * as diagnostics from ${JSON.stringify(moduleUrl)};
    const inspectRobots = diagnostics.inspectRobots ?? diagnostics.default?.inspectRobots;
    const rule = "User-agent: *\\nDisallow: /" + "*a".repeat(32) + "b$";
    const missingSuffix = "https://public.example/" + "a".repeat(300);
    const matching = missingSuffix + "b";
    const start = performance.now();
    assert.equal(inspectRobots(rule, missingSuffix).crawlerAccess, "allowed");
    assert.equal(inspectRobots(rule, matching).crawlerAccess, "disallowed");
    assert.ok(performance.now() - start < 1000, "rules must not cause synchronous backtracking");
    console.log("bounded-wildcard-matching");
  `;
  // A node:test timeout alone cannot interrupt a synchronous regex on the same
  // event loop. The child is forcibly terminated if the vulnerable code returns.
  const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(), timeout: 10_000, maxBuffer: 64 * 1024, encoding: "utf8", windowsHide: true,
  });
  assert.match(result.stdout, /bounded-wildcard-matching/);
});
