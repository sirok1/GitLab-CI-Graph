import { describe, it, expect } from "vitest";
import { transform, reachable } from "./graph";
import type { PipelineModel, PipelineJob } from "./model";
const job = (name: string, stage: string): PipelineJob => ({
  id: name,
  name,
  stage,
  needs: [],
  dependencies: [],
  extends: [],
  rulesCount: 0,
  hasArtifacts: false,
  hasExplicitNeeds: false,
});
const model: PipelineModel = {
  source: { mode: "LOCAL" },
  stages: [{ name: "build" }, { name: "test" }],
  jobs: [job("build", "build"), job("test", "test"), job("lint", "test")],
  edges: [{ source: "build", target: "test", artifacts: true, optional: true }],
  warnings: [],
  errors: [],
  files: [],
  valid: true,
  validation: "STRUCTURE ONLY",
};
describe("pipeline transformation", () => {
  it("places stages in columns and keeps only explicit needs", () => {
    const g = transform(model, "Stages");
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(1);
    expect(g.nodes[0].position.x).toBeLessThan(g.nodes[1].position.x);
    expect(g.edges[0].style?.strokeDasharray).toBeTruthy();
    expect(g.columns).toHaveLength(2);
  });
  it("uses dagre for dependency layout", () => {
    const g = transform(model, "DAG");
    expect(g.nodes[0].position.x).toBeLessThan(g.nodes[1].position.x);
    expect(g.columns).toHaveLength(0);
  });
  it("finds recursive dependencies and handles cycles", () => {
    const edges = [
      ...model.edges,
      { source: "test", target: "deploy", optional: false },
      { source: "deploy", target: "build", optional: false },
    ];
    expect([...reachable("deploy", edges, "upstream")].sort()).toEqual([
      "build",
      "deploy",
      "test",
    ]);
  });
  it("lays out 300 jobs with finite coordinates", () => {
    const jobs = Array.from({ length: 300 }, (_, i) =>
      job(`job-${i}`, i < 150 ? "build" : "test"),
    );
    const large = {
      ...model,
      jobs,
      edges: jobs
        .slice(150)
        .map((j, i) => ({ source: jobs[i].id, target: j.id, optional: false })),
    };
    const result = transform(large, "DAG");
    expect(result.nodes).toHaveLength(300);
    expect(result.edges).toHaveLength(150);
    expect(
      result.nodes.every(
        (n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
      ),
    ).toBe(true);
  });
});
