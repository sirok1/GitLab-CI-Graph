import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { releaseVersion, validateVersion } from "./version.mjs";
import {
  changelogSection,
  prepareRelease,
  releaseNotes,
} from "./prepare-release.mjs";
import { publishGitLab } from "./publish-gitlab.mjs";

test("versions follow release tags on both providers; branches use the project default", () => {
  assert.equal(releaseVersion({}, "pluginVersion=0.1.0\n"), "0.1.0");
  assert.equal(releaseVersion({ CI_COMMIT_TAG: "v0.2.0" }, ""), "0.2.0");
  assert.equal(
    releaseVersion(
      { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v1.0.0-rc.1" },
      "",
    ),
    "1.0.0-rc.1",
  );
  assert.equal(
    releaseVersion(
      { GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "vfeature" },
      "pluginVersion=0.1.0",
    ),
    "0.1.0",
  );
  for (const value of [
    "01.0.0",
    "0.1",
    "../../file",
    "1.0.0-01",
    "1.0.0\nINJECT=x",
  ])
    assert.throws(() => validateVersion(value));
  assert.throws(() => releaseVersion({ CI_COMMIT_TAG: "1.0.0" }, ""));
});

test("changelog extraction isolates the requested section", () => {
  const text =
    "## [Unreleased]\n\n- New fix\n\n## [0.1.0]\n\n- Initial release\n";
  assert.equal(changelogSection(text, "0.1.0"), "- Initial release");
  assert.equal(changelogSection(text, "Unreleased"), "- New fix");
  assert.equal(changelogSection(text, "0.2.0"), "");
});

test("notes use ancestor tags; release bundle has a verified ZIP and durable GitLab asset links", async () => {
  const root = await mkdtemp(join(tmpdir(), "ci-graph-release-"));
  const git = (args) =>
    execFileSync("git", args, { cwd: root, stdio: "ignore" });
  try {
    git(["init", "--initial-branch=main"]);
    await writeFile(join(root, "file.txt"), "first");
    git(["add", "."]);
    const commit = (message) =>
      git([
        "-c",
        "user.name=CI Tests",
        "-c",
        "user.email=ci@example.invalid",
        "commit",
        "-m",
        message,
      ]);
    commit("Initial implementation");
    assert.match(releaseNotes("0.1.0", "", root), /First tagged release/);
    git(["tag", "v0.1.0"]);
    await writeFile(join(root, "file.txt"), "second");
    git(["add", "."]);
    commit("Fix graph refresh");
    git(["tag", "v0.2.0"]);
    const changelog =
      "## [Unreleased]\n\n- Unreleased change\n\n## [0.2.0]\n\n- Curated refresh fix\n";
    const notes = releaseNotes("0.2.0", changelog, root);
    assert.match(notes, /Curated refresh fix/);
    assert.match(notes, /Fix graph refresh/);
    assert.doesNotMatch(notes, /Initial implementation|Unreleased change/);
    assert.match(notes, /Changes since `v0.1.0`/);
    assert.match(
      releaseNotes("0.3.0-rc.1", changelog, root),
      /Pre-release|Unreleased change/,
    );
    await mkdir(join(root, "build/distributions"), { recursive: true });
    await writeFile(
      join(root, "build/distributions/gitlab-ci-graph-0.2.0.zip"),
      "zip fixture",
    );
    await writeFile(join(root, "CHANGELOG.md"), changelog);
    await prepareRelease("0.2.0", root);
    const directory = join(root, "build/release");
    assert.equal(
      await readFile(join(directory, "RELEASE_NOTES.md"), "utf8"),
      notes,
    );
    const requests = [];
    const env = {
      CI_COMMIT_TAG: "v0.2.0",
      CI_PROJECT_ID: "123",
      CI_API_V4_URL: "https://gitlab.example.com/gitlab/api/v4",
      CI_JOB_TOKEN: "test-job-token",
    };
    await publishGitLab(
      env,
      async (url, options) => {
        requests.push({ url, ...options });
        return new Response("{}", {
          status: options.method === "GET" ? 404 : 201,
        });
      },
      directory,
    );
    assert.equal(requests.length, 5);
    assert(
      requests
        .slice(1, 4)
        .every(
          (r) =>
            r.method === "PUT" &&
            r.url.includes("/packages/generic/gitlab-ci-graph/0.2.0/"),
        ),
    );
    assert(
      requests.every(
        (r) =>
          r.headers["JOB-TOKEN"] === "test-job-token" && r.redirect === "error",
      ),
    );
    const release = JSON.parse(requests[4].body);
    assert.equal(release.tag_name, "v0.2.0");
    assert.equal(release.description, notes);
    assert.equal(release.assets.links.length, 3);
    assert.equal(
      release.assets.links[0].direct_asset_path,
      "/gitlab-ci-graph-0.2.0.zip",
    );
    await assert.rejects(
      publishGitLab(
        env,
        async () => new Response("{}", { status: 401 }),
        directory,
      ),
      /HTTP 401/,
    );
    let existingReleaseCalls = 0;
    await assert.rejects(
      publishGitLab(
        env,
        async (_url, options) => {
          existingReleaseCalls++;
          assert.equal(options.method, "GET");
          return new Response("{}", { status: 200 });
        },
        directory,
      ),
      /already exists/,
    );
    assert.equal(existingReleaseCalls, 1);
    await writeFile(join(directory, "SHA256SUMS"), "invalid hash");
    await assert.rejects(
      publishGitLab(
        env,
        async () => {
          assert.fail("Must not upload corrupt ZIP");
        },
        directory,
      ),
      /checksum/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
