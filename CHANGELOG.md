# Changelog

Release notes use the matching version section below. For future versions without a section, notes use Unreleased and the Git commit history since the previous tag.

## [Unreleased]

### Added

- Copy the visible graph workspace to the clipboard or save it as PNG for sharing in chats.

### Fixed

- Render screenshot vectors directly at high PNG resolution (4x by default), compensating for graph zoom instead of enlarging a screen-resolution raster.

- Automatically crop empty screenshot margins around visible graph content with a small padding, preserving zoom and pan.

- Preserve zoom and pan when pipeline files refresh, including recovery from invalid YAML.
- Resolve local `extends` from hidden and regular jobs, including nested/multiple parents and local includes; display inherited stages, template badges and ancestry.
- Preserve original `extends` metadata in GitLab resolved mode and warn about cycles, unavailable templates and undeclared stages.

## [0.1.0]

### Added

- GitLab CI Graph Tool Window with React Flow embedded in JCEF.
- Local YAML discovery and local includes, stage columns and DAG layout.
- Explicit needs edges, optional/artifact metadata and job badges.
- Job details, search, upstream/downstream focus and editor navigation.
- GitLab CI Lint resolved mode for GitLab.com and self-hosted instances.
- PasswordSafe token storage and light/dark theme support.
- GitLab CI and GitHub Actions builds and tagged releases with ZIP, SHA-256 and release notes.

### Fixed

- Preserve React Flow node state and viewport while dragging jobs.
- Refresh the graph from unsaved editor changes, including local include files, after a 400 ms debounce.

### Limitations

- Local mode does not evaluate GitLab rules or inheritance; external includes require GitLab mode.
- Child pipeline expansion and caret-to-graph selection are not implemented.
