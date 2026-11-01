import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/change-scope.mjs", import.meta.url));
function fixture(t, changes, strict = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scope-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = {
    version: 1,
    projects: [
      { id: "core", root: "packages/core" },
      { id: "web", root: "apps/web", dependsOn: ["core"] },
      { id: "other", root: "apps/other" },
    ],
    ignoredInputs: ["docs/"],
    unmapped: strict ? "error" : "all",
  };
  fs.writeFileSync(
    path.join(root, "temporary-policy.json"),
    JSON.stringify(config),
  );
  fs.writeFileSync(path.join(root, "changes.json"), JSON.stringify(changes));
  const args = [
    "plan",
    "--config",
    path.join(root, "temporary-policy.json"),
    "--changes",
    "changes.json",
  ];
  const run = (extra) =>
    spawnSync(process.execPath, [cli, ...args, ...extra], {
      cwd: root,
      encoding: "utf8",
    });
  return { root, args, run, config };
}

for (const policy of [
  "docs/private-policy.json",
  "apps/web/private-policy.json",
  "ci/private-policy.json",
]) {
  test(`explicit offline policy selects every project: ${policy}`, (t) => {
    const f = fixture(t, [policy], true);
    const result = f.run(["--policy-path", policy, "--format", "json"]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.mode, "all");
    assert.deepEqual(
      [...plan.projects].sort(),
      f.config.projects.map((p) => p.id).sort(),
    );
    assert.equal(plan.totals.global, 1);
    assert(plan.reasons.every((reason) => reason.kind === "global"));
    assert(!result.stdout.includes("private-policy"));
    assert(!result.stdout.includes(f.root));
  });
}

test("default offline behavior stays compatible, and an explicit policy overrides ignores", (t) => {
  const f = fixture(t, ["docs/private-policy.json"]);
  assert.equal(JSON.parse(f.run(["--format", "json"]).stdout).mode, "empty");
  const result = f.run([
    "--policy-path",
    "docs/private-policy.json",
    "--format",
    "matrix",
    "--fail-if-affected",
  ]);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    include: [{ shard: 1, projects: ["core", "other", "web"] }],
  });
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(f.root, "temporary-policy.json"))),
    f.config,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(f.root, "changes.json"))),
    ["docs/private-policy.json"],
  );
});

test("a policy selector is an exact file, not a directory prefix", (t) => {
  const f = fixture(t, ["docs/private-policy.json.extra"]);
  const result = f.run([
    "--policy-path",
    "docs/private-policy.json",
    "--format",
    "json",
  ]);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).mode, "empty");
});

test("unsafe logical policy paths fail with fixed-code diagnostics", (t) => {
  const f = fixture(t, []);
  for (const policy of [
    "../PRIVATE_PATH",
    "/PRIVATE_PATH",
    "C:/PRIVATE_PATH",
    "docs/",
    "x/".repeat(129) + "PRIVATE_PATH",
  ]) {
    const result = f.run(["--policy-path", policy]);
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      version: 1,
      ok: false,
      error: { code: "invalid-path" },
    });
    assert(!result.stdout.includes("PRIVATE_PATH"));
    assert(!result.stdout.includes(f.root));
  }
});

test("logical policy flag is refused in Git mode before attempting Git", (t) => {
  const f = fixture(t, []);
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "plan",
      "--base",
      "PRIVATE_REF",
      "--repo",
      "missing",
      "--policy-path",
      "docs/policy.json",
    ],
    { cwd: f.root, encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    ok: false,
    error: { code: "usage" },
  });
});

test("help documents the logical policy option", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--policy-path/);
});
