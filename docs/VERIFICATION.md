# Verification record

Checked on Windows with JDK 21, Node 24.13.0, Gradle 9.0.0 and IntelliJ IDEA 2025.3.1 (IU-253.29346.138).

- `gradlew.bat test`: 22 backend tests and 4 frontend tests passed. Includes parser fixtures, local extends precedence/nesting/includes/nulls/cycles/depth limits, the reported Android publish-stage regression, CI Lint responses/errors/timeout, preserved extends metadata in resolved mode, encoded project paths, merged stage ordering, malformed-token error redaction, graph transformation and 300-job layout.
- IntelliJ document integration test: editing the main YAML and a local include triggers the listener and parsing reads their unsaved text while disk contents remain unchanged. Disposing the listener stops further callbacks. Refresh uses a 400 ms debounce in the Tool Window.
- `gradlew.bat buildPlugin`: ZIP created under `build/distributions/` with the production frontend and Kotlin backend.
- `gradlew.bat verifyPlugin`: Compatible with the targeted IDEA build. Only the template-word rule for the explicitly requested `space.sirok.gitlab-ci-graph` ID is muted. No internal API suppression or compatibility failure suppression is configured.
- `gradlew.bat runIde`: sandbox IDE launched, opened the example project and rendered the graph in JCEF (5 jobs, 3 stages, 4 edges).
- Double-click `test-web`: editor caret moved to the job definition at line 13.
- Saved YAML refresh: temporarily adding a job changed the logged/visible graph to 6 jobs and 5 edges; the example was restored to 5 jobs and 4 edges.
- `node scripts/jcef-smoke.mjs`: checked the actual embedded browser through the sandbox's opt-in local DevTools endpoint. Verified stage columns, node/edge counts, all nodes inside Fit View bounds, search match/Escape, both layouts, details and recursive upstream focus. Screenshot is a real capture of the plugin view.
- The JCEF smoke test also loads an Android inheritance fixture temporarily: both publish jobs resolve to `publish_android`, EXTENDS badges and stage provenance are visible, hidden templates stay out of the DAG, and undeclared-stage warnings appear. The fixture is removed and the original configuration restored. Drag still leaves the viewport and other jobs stable.

Not verified against a live authenticated GitLab server: no server/project/token was supplied. API behavior was exercised through local mock HTTP servers. The implementation uses the real CI Lint endpoint.

IDE theme detection and change subscription are implemented; an actual IDE light/dark switch was not part of the manual check. Compatibility with WebStorm and later IDE releases has not been verified.

The downloaded IDEA sandbox also logged errors from its bundled Kubernetes RPC components and warnings about disabled Ultimate plugins. The graph loaded successfully; these errors were not in this plugin's classes. No existing IDE installation or global IDE configuration was modified.

CI/release tooling was checked locally: both YAML files parsed, GitHub Actions passed actionlint 1.7.12, Bash scripts passed syntax checks, and three Node test cases covered tag versions, release notes, checksum validation and GitLab requests through a mock transport (including refusal to overwrite an existing release). A real Gradle build with `-PpluginVersion=0.2.0-rc.1` produced the matching ZIP and embedded plugin.xml version. The default 0.1.0 build was restored afterward. Hosted Linux CI jobs, Docker setup and live release publication have not been executed.
