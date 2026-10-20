import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateVersion } from "./version.mjs";

export async function publishGitLab(
  env = process.env,
  request = fetch,
  directory = "build/release",
) {
  if (!env.CI_COMMIT_TAG?.startsWith("v"))
    throw new Error("A v-prefixed release tag is required");
  const version = validateVersion(env.CI_COMMIT_TAG.slice(1));
  if (!env.CI_JOB_TOKEN || !env.CI_PROJECT_ID || !env.CI_API_V4_URL)
    throw new Error("GitLab CI job token, API URL and project ID are required");
  const base = `${env.CI_API_V4_URL.replace(/\/$/, "")}/projects/${encodeURIComponent(env.CI_PROJECT_ID)}`;
  const zipName = `gitlab-ci-graph-${version}.zip`;
  const names = [zipName, "SHA256SUMS", "RELEASE_NOTES.md"];
  const files = await Promise.all(
    names.map((name) => readFile(`${directory}/${name}`)),
  );
  const digest = createHash("sha256").update(files[0]).digest("hex");
  if (files[1].toString().trim() !== `${digest}  ${zipName}`)
    throw new Error("ZIP checksum does not match SHA256SUMS");
  const existing = await request(
    `${base}/releases/${encodeURIComponent(env.CI_COMMIT_TAG)}`,
    {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: { "JOB-TOKEN": env.CI_JOB_TOKEN },
    },
  );
  await existing.arrayBuffer();
  if (existing.ok)
    throw new Error("Release already exists; refusing to replace its assets");
  if (existing.status !== 404)
    throw new Error(`GitLab GET failed: HTTP ${existing.status}`);
  async function api(url, method, body, contentType) {
    const response = await request(url, {
      method,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: { "JOB-TOKEN": env.CI_JOB_TOKEN, "Content-Type": contentType },
    });
    if (!response.ok)
      throw new Error(
        `GitLab ${method} failed: HTTP ${response.status}. Check project permissions and whether this version was already released.`,
      );
    await response.arrayBuffer();
  }
  const links = [];
  for (const [index, name] of names.entries()) {
    const url = `${base}/packages/generic/gitlab-ci-graph/${version}/${name}`;
    await api(url, "PUT", files[index], "application/octet-stream");
    links.push({
      name,
      url,
      link_type: name.endsWith(".zip") ? "package" : "other",
      direct_asset_path: `/${name}`,
    });
  }
  await api(
    `${base}/releases`,
    "POST",
    JSON.stringify({
      tag_name: env.CI_COMMIT_TAG,
      name: `GitLab CI Graph ${env.CI_COMMIT_TAG}`,
      description: files[2].toString("utf8"),
      assets: { links },
    }),
    "application/json",
  );
  console.log(`Published GitLab release ${env.CI_COMMIT_TAG}`);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  publishGitLab().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
