#!/usr/bin/env bash
set -euo pipefail

# The GitLab build image supplies JDK 21; install the pinned official Node distribution.
case "$(uname -m)" in
  x86_64) node_arch=x64 ;;
  aarch64|arm64) node_arch=arm64 ;;
  *) echo "Unsupported runner architecture" >&2; exit 1 ;;
esac
node_version="${NODE_VERSION:-24.13.0}"
node_archive="node-v${node_version}-linux-${node_arch}.tar.xz"
node_download="$(mktemp -d)"
trap 'rm -rf -- "$node_download"' EXIT
curl --fail --silent --show-error --retry 3 "https://nodejs.org/dist/v${node_version}/${node_archive}" -o "$node_download/$node_archive"
curl --fail --silent --show-error --retry 3 "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o "$node_download/SHASUMS256.txt"
(
  cd "$node_download"
  awk -v name="$node_archive" '$2 == name { print }' SHASUMS256.txt > archive.sha256
  test -s archive.sha256
  sha256sum --check archive.sha256
)
mkdir -p .ci-tools/node
tar -xJf "$node_download/$node_archive" --strip-components=1 -C .ci-tools/node
.ci-tools/node/bin/node --version
