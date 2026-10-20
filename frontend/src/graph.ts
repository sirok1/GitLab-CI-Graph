import dagre from "@dagrejs/dagre";
import { MarkerType, type Node, type Edge } from "@xyflow/react";
import type { PipelineModel, PipelineJob, PipelineEdge } from "./model";
export type JobNode = Node<
  { job: PipelineJob; dimmed?: boolean; match?: boolean },
  "job"
>;
export function transform(
  model: PipelineModel,
  layout: "Stages" | "DAG",
): { nodes: JobNode[]; edges: Edge[]; columns: { name: string; x: number }[] } {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 35, ranksep: 90 });
  graph.setDefaultEdgeLabel(() => ({}));
  model.jobs.forEach((j) => graph.setNode(j.id, { width: 230, height: 130 }));
  model.edges.forEach((e) => graph.setEdge(e.source, e.target));
  if (layout === "DAG") dagre.layout(graph);
  const counts = new Map<string, number>();
  const nodes: JobNode[] = model.jobs.map((job) => {
    const row = counts.get(job.stage) ?? 0;
    counts.set(job.stage, row + 1);
    const p =
      layout === "DAG"
        ? graph.node(job.id)
        : {
            x:
              Math.max(
                0,
                model.stages.findIndex((s) => s.name === job.stage),
              ) *
                320 +
              135,
            y: row * 170 + 110,
          };
    return {
      id: job.id,
      type: "job",
      position: { x: p.x - 115, y: p.y - 65 },
      data: { job },
    };
  });
  const edges: Edge[] = model.edges.map((e, i) => ({
    id: `need-${i}`,
    source: e.source,
    target: e.target,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeDasharray: e.optional ? "6 4" : undefined },
    label: e.optional ? "optional" : undefined,
    data: { artifacts: e.artifacts, optional: e.optional },
  }));
  return {
    nodes,
    edges,
    columns:
      layout === "Stages"
        ? model.stages.map((s, i) => ({ name: s.name, x: i * 320 + 20 }))
        : [],
  };
}
export function reachable(
  id: string,
  edges: PipelineEdge[],
  direction: "upstream" | "downstream",
): Set<string> {
  const found = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    edges.forEach((e) => {
      const next =
        direction === "upstream"
          ? e.target === current
            ? e.source
            : null
          : e.source === current
            ? e.target
            : null;
      if (next && !found.has(next)) {
        found.add(next);
        queue.push(next);
      }
    });
  }
  return found;
}
