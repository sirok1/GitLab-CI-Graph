import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateVersion } from "./version.mjs";

export function changelogSection(changelog, heading) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${heading}]`));
  if (start < 0) return "";
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("## "),
  );
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

export function releaseNotes(version, changelog, cwd = process.cwd()) {
  validateVersion(version);
  const git = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  let previous;
  try {
    previous = git([
      "describe",
      "--tags",
      "--abbrev=0",
      "--match",
      "v[0-9]*",
      `--exclude=v${version}`,
      "HEAD",
    ]);
  } catch {
    /* first release */
  }
  const range = previous ? `${previous}..HEAD` : "HEAD";
  const commits = git(["log", "--no-merges", "--format=- %s (`%h`)", range]);
  const curated =
    changelogSection(changelog, version) ||
    changelogSection(changelog, "Unreleased");
  return (
    [
      `# GitLab CI Graph ${version}`,
      ...(version.includes("-")
        ? ["**Pre-release**: intended for testing before the stable release."]
        : []),
      ...(curated ? [curated] : []),
      "## Commits",
      commits || "No new non-merge commits since the previous release.",
      "## Installation",
      `Download \`gitlab-ci-graph-${version}.zip\`, then open Settings → Plugins → Install Plugin from Disk. Requires a compatible JetBrains IDE 2025.3.1+ with YAML and JCEF.`,
      "Local mode shows structural YAML; GitLab mode resolves the pipeline with CI Lint. No real pipeline is started.",
      ...(previous
        ? [`Changes since \`${previous}\`.`]
        : ["First tagged release."]),
    ].join("\n\n") + "\n"
  );
}

export async function prepareRelease(version, cwd = process.cwd()) {
  validateVersion(version);
  const name = `gitlab-ci-graph-${version}.zip`;
  const zip = `${cwd}/build/distributions/${name}`;
  const notes = releaseNotes(
    version,
    await readFile(`${cwd}/CHANGELOG.md`, "utf8"),
    cwd,
  );
  const checksum = createHash("sha256")
    .update(await readFile(zip))
    .digest("hex");
  await mkdir(`${cwd}/build/release`, { recursive: true });
  await copyFile(zip, `${cwd}/build/release/${name}`);
  await writeFile(`${cwd}/build/release/RELEASE_NOTES.md`, notes);
  await writeFile(`${cwd}/build/release/SHA256SUMS`, `${checksum}  ${name}\n`);
  console.log(`Prepared ${name}, SHA256SUMS and RELEASE_NOTES.md`);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  prepareRelease(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
