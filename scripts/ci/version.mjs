import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const identifier = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const versionPattern = new RegExp(
  `^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-${identifier}(?:\\.${identifier})*)?$`,
);
export function validateVersion(value) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !versionPattern.test(value)
  )
    throw new Error(
      "Expected a SemVer version, for example 0.2.0 or 0.2.0-rc.1",
    );
  return value;
}
export function releaseVersion(
  env = process.env,
  properties = readFileSync("gradle.properties", "utf8"),
) {
  const tag =
    env.CI_COMMIT_TAG ||
    (env.GITHUB_REF_TYPE === "tag" ? env.GITHUB_REF_NAME : "");
  if (tag) {
    if (!tag.startsWith("v")) throw new Error("Release tags must start with v");
    return validateVersion(tag.slice(1));
  }
  return validateVersion(
    properties.match(/^pluginVersion\s*=\s*(\S+)\s*$/m)?.[1],
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(releaseVersion());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
