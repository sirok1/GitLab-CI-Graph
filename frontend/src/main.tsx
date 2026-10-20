import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  useNodesInitialized,
  useNodesState,
  ViewportPortal,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./style.css";
import { send, type PipelineJob, type ViewState } from "./model";
import { reachable, transform, type JobNode } from "./graph";

const JobCard = memo(({ data, selected }: NodeProps<JobNode>) => {
  const j = data.job;
  return (
    <div
      className={`job ${selected ? "selected" : ""} ${data.dimmed ? "dimmed" : ""} ${data.match ? "match" : ""}`}
      title={`${j.name}\n${j.sourceFile ?? "Resolved job"}:${j.sourceLine ?? ""}${j.extends.length ? `\nExtends: ${j.extends.join(", ")}` : ""}${j.stageInheritedFrom ? `\nStage inherited from: ${j.stageInheritedFrom}` : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <strong>{j.name}</strong>
      <div className="stage">{j.stage}</div>
      <div className="counts">
        needs: {j.needs.length} · rules: {j.rulesCount}
      </div>
      <div className="badges">
        {j.whenType === "manual" && <span>MANUAL</span>}
        {j.allowFailure && <span>ALLOW FAILURE</span>}
        {j.hasArtifacts && <span>ARTIFACTS</span>}
        {j.trigger && <span>CHILD PIPELINE</span>}
        {j.environment && <span>{j.environment}</span>}
        {j.extends.length > 0 && (
          <span className="extends-badge" title={j.extends.join(", ")}>
            EXTENDS: {j.extends.join(", ")}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
const nodeTypes = { job: JobCard };
const initial: ViewState = {
  configs: [],
  selectedFile: "",
  dark: true,
  loading: true,
};
function Details({ job }: { job: PipelineJob }) {
  return (
    <aside>
      <h3>{job.name}</h3>
      <button
        disabled={!job.sourceFile}
        onClick={() => send({ type: "job:navigate", job: job.id })}
      >
        Go to definition
      </button>
      <dl>
        {Object.entries({
          Stage: job.stage,
          "Stage inherited from": job.stageInheritedFrom,
          Needs: job.needs
            .map(
              (n) =>
                `${n.job}${n.optional ? " (optional)" : ""}${n.artifacts ? " (artifacts)" : ""}${n.project ? ` (${n.project})` : ""}`,
            )
            .join(", "),
          Dependencies: job.dependencies.join(", "),
          When: job.whenType ?? "on_success",
          "Allow failure": String(job.allowFailure ?? false),
          Environment: job.environment,
          Extends: job.extends.join(", "),
          "Local template ancestry": job.inheritanceChain?.join(", "),
          "Unresolved templates": job.unresolvedExtends?.join(", "),
          Rules: String(job.rulesCount),
          Image: job.image,
          Trigger: job.trigger?.description,
          Source: job.sourceFile
            ? `${job.sourceFile}:${job.sourceLine}`
            : "No exact local definition",
        }).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
function App() {
  const [state, setState] = useState<ViewState>(initial);
  const [mode, setMode] = useState("LOCAL");
  const [ref, setRef] = useState("");
  const [layout, setLayout] = useState<"Stages" | "DAG">("Stages");
  const [search, setSearch] = useState("");
  const [matchIndex, setMatchIndex] = useState(-1);
  const [selected, setSelected] = useState<string>();
  const [focus, setFocus] = useState<"upstream" | "downstream" | "">("");
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    job: PipelineJob;
  }>();
  const [reset, setReset] = useState(0);
  const [graphNodes, setGraphNodes, onNodesChange] = useNodesState<JobNode>([]);
  const fittedGraph = useRef<unknown>(null);
  const flow = useReactFlow<JobNode>();
  const nodesInitialized = useNodesInitialized();
  useEffect(() => {
    const update = (event: Event) => {
      const next = (event as CustomEvent<ViewState>).detail;
      setState((previous) => ({
        ...next,
        pipeline:
          next.loading ||
          JSON.stringify(previous.pipeline) === JSON.stringify(next.pipeline)
            ? previous.pipeline
            : next.pipeline,
      }));
    };
    window.addEventListener("pipeline:update", update);
    return () => window.removeEventListener("pipeline:update", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.dark ? "dark" : "light";
  }, [state.dark]);
  useEffect(() => {
    if (state.defaultRef) setRef(state.defaultRef);
  }, [state.defaultRef]);
  const p = state.pipeline;
  const graph = useMemo(
    () => (p ? transform(p, layout) : { nodes: [], edges: [], columns: [] }),
    [p, layout, reset],
  );
  useEffect(() => setGraphNodes(graph.nodes), [graph, setGraphNodes]);
  function fitGraph() {
    const currentNodes = flow.getNodes();
    if (!currentNodes.length) return;
    if (layout === "DAG") {
      void flow.fitView({ padding: 0.15, duration: 200 });
      return;
    }
    const bounds = flow.getNodesBounds(currentNodes);
    const x = Math.min(0, bounds.x);
    const y = Math.min(0, bounds.y - 45);
    const right = Math.max(
      bounds.x + bounds.width,
      ...graph.columns.map((c) => c.x + 250),
    );
    void flow.fitBounds(
      { x, y, width: right - x, height: bounds.y + bounds.height - y + 20 },
      { padding: 0.12, duration: 200 },
    );
  }
  useEffect(() => {
    if (p && nodesInitialized && fittedGraph.current !== graph) {
      const timer = setTimeout(() => {
        fittedGraph.current = graph;
        fitGraph();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [graph, nodesInitialized]);
  const matches = useMemo(
    () =>
      graph.nodes.filter(
        (n) => search && n.id.toLowerCase().includes(search.toLowerCase()),
      ),
    [graph, search],
  );
  const active = useMemo(
    () => (selected && focus && p ? reachable(selected, p.edges, focus) : null),
    [selected, focus, p],
  );
  const nodePresentation = useMemo(
    () =>
      new Map(
        graph.nodes.map((n) => [
          n.id,
          {
            ...n.data,
            match:
              !!search && n.id.toLowerCase().includes(search.toLowerCase()),
            dimmed: !!active && !active.has(n.id),
          },
        ]),
      ),
    [graph, active, search],
  );
  const nodes = useMemo(
    () =>
      graphNodes.map((n) => {
        return {
          ...n,
          selected: n.id === selected,
          data: nodePresentation.get(n.id) ?? n.data,
        };
      }),
    [graphNodes, selected, nodePresentation],
  );
  const edges = useMemo(
    () =>
      graph.edges.map((e) => ({
        ...e,
        className:
          selected &&
          (e.source === selected ||
            e.target === selected ||
            (active?.has(e.source) && active.has(e.target)))
            ? "active-edge"
            : "",
        style: {
          ...e.style,
          opacity:
            active && (!active.has(e.source) || !active.has(e.target))
              ? 0.15
              : 1,
        },
      })),
    [graph, selected, active],
  );
  const job = p?.jobs.find((j) => j.id === selected);
  function change(source: { mode?: string; file?: string; ref?: string }) {
    send({ type: "source:change", ...source });
  }
  return (
    <main onClick={() => setMenu(undefined)}>
      <header>
        <select
          aria-label="Pipeline source"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            change({ mode: e.target.value });
          }}
        >
          <option value="LOCAL">Local</option>
          <option value="GITLAB">GitLab</option>
        </select>
        <select
          aria-label="CI configuration"
          value={state.selectedFile}
          onChange={(e) => change({ file: e.target.value })}
        >
          {state.configs.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        {mode === "GITLAB" && (
          <input
            aria-label="GitLab ref"
            placeholder="Default ref"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onBlur={() => {
              if (ref) change({ ref });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") change({ ref });
            }}
          />
        )}
        <select
          aria-label="Layout"
          value={layout}
          onChange={(e) => setLayout(e.target.value as typeof layout)}
        >
          <option>Stages</option>
          <option>DAG</option>
        </select>
        <input
          aria-label="Search jobs"
          placeholder="Search jobs"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setMatchIndex(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSearch("");
            if (e.key === "Enter" && matches.length) {
              const index = (matchIndex + 1) % matches.length;
              setMatchIndex(index);
              const n = matches[index];
              setSelected(n.id);
              void flow.fitView({
                nodes: [{ id: n.id }],
                duration: 250,
                maxZoom: 1.1,
              });
            }
          }}
        />
        <button onClick={() => send({ type: "graph:refresh" })} title="Refresh">
          ↻
        </button>
        <button onClick={fitGraph}>Fit View</button>
        <button onClick={() => setReset((r) => r + 1)}>Reset layout</button>
        <button onClick={() => send({ type: "settings:open" })}>
          Settings
        </button>
      </header>
      <div className="status">
        <b>
          {p?.source.mode === "GITLAB"
            ? "RESOLVED BY GITLAB"
            : mode === "LOCAL"
              ? "LOCAL"
              : "GITLAB"}
        </b>
        {p?.source.ref && <span>{p.source.ref}</span>}
        <span>
          {state.loading
            ? "Loading…"
            : p
              ? `${p.valid ? "✓" : "✕"} ${p.validation === "STRUCTURE ONLY" ? "YAML structure valid · local extends expanded; rules/external includes unresolved" : p.valid ? "Valid" : "Invalid"}`
              : ""}
        </span>
        {search && <span>{matches.length} matches</span>}
      </div>
      {state.error && (
        <div role="alert" className="error">
          <strong>Pipeline cannot be resolved</strong>
          <p>{state.error}</p>
          <button onClick={() => send({ type: "settings:open" })}>
            Settings
          </button>
        </div>
      )}
      {p && (p.errors.length > 0 || p.warnings.length > 0) && (
        <details className="messages" open={p.errors.length > 0}>
          <summary>
            {p.errors.length} errors · {p.warnings.length} warnings
          </summary>
          {p.errors.map((e, i) => (
            <p className="error" key={`e${i}`}>
              {e}
            </p>
          ))}
          {p.warnings.map((w, i) => (
            <p key={`w${i}`}>{w.message}</p>
          ))}
        </details>
      )}
      {!p && !state.loading && !state.error ? (
        <div className="empty">
          <h2>No GitLab CI configuration found</h2>
          <p>Expected: .gitlab-ci.yml</p>
          <button onClick={() => send({ type: "file:select" })}>
            Select file
          </button>
        </div>
      ) : (
        <div className="workspace">
          <div className="canvas">
            <ReactFlow<JobNode>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              colorMode={state.dark ? "dark" : "light"}
              minZoom={0.08}
              maxZoom={2}
              nodesConnectable={false}
              onNodesChange={onNodesChange}
              onNodeClick={(_, n) => setSelected(n.id)}
              onNodeDoubleClick={(_, n) =>
                send({ type: "job:navigate", job: n.id })
              }
              onPaneClick={() => {
                setSelected(undefined);
                setFocus("");
              }}
              onNodeContextMenu={(e, n) => {
                e.preventDefault();
                setSelected(n.id);
                setMenu({ x: e.clientX, y: e.clientY, job: n.data.job });
              }}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
              {nodes.length > 12 && (
                <MiniMap
                  pannable
                  zoomable
                  style={{ width: 140, height: 90 }}
                  nodeColor="var(--accent)"
                />
              )}
              <ViewportPortal>
                {graph.columns.map((c) => (
                  <div
                    key={c.name}
                    className="column"
                    style={{
                      left: c.x,
                      height: Math.max(
                        600,
                        ...nodes.map((n) => n.position.y + 180),
                      ),
                    }}
                  >
                    <b>{c.name.toUpperCase()}</b>
                  </div>
                ))}
              </ViewportPortal>
            </ReactFlow>
            {job && (
              <div className="focusbar">
                <button
                  className={focus === "upstream" ? "chosen" : ""}
                  onClick={() =>
                    setFocus(focus === "upstream" ? "" : "upstream")
                  }
                >
                  Show dependencies
                </button>
                <button
                  className={focus === "downstream" ? "chosen" : ""}
                  onClick={() =>
                    setFocus(focus === "downstream" ? "" : "downstream")
                  }
                >
                  Show downstream
                </button>
              </div>
            )}
          </div>
          {job && <Details job={job} />}
        </div>
      )}
      {menu && (
        <div
          className="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 210),
            top: Math.min(menu.y, window.innerHeight - 230),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            [
              "Go to definition",
              () => send({ type: "job:navigate", job: menu.job.id }),
            ],
            [
              "Copy job name",
              () => {
                const area = document.createElement("textarea");
                area.value = menu.job.name;
                document.body.append(area);
                area.select();
                document.execCommand("copy");
                area.remove();
              },
            ],
            ["Focus dependencies", () => setFocus("upstream")],
            ["Focus downstream", () => setFocus("downstream")],
            ["Open details", () => setSelected(menu.job.id)],
            ...(state.gitLabConfigured
              ? [
                  [
                    "Open project in GitLab",
                    () => send({ type: "project:open" }),
                  ],
                ]
              : []),
          ].map(([label, action]) => (
            <button
              key={String(label)}
              onClick={() => {
                (action as () => void)();
                setMenu(undefined);
              }}
            >
              {String(label)}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <ReactFlowProvider>
    <App />
  </ReactFlowProvider>,
);
