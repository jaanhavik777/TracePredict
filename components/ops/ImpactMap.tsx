"use client";

import { useState } from "react";
import type { DeploymentSignal, ImpactNode } from "@/lib/ops/impact";
import { pretty, timestamp } from "./format";

const columns = [
  ["UPSTREAM", "Upstream dependencies"],
  ["AFFECTED", "Affected service"],
  ["DOWNSTREAM", "Downstream at risk"],
] as const;

export default function ImpactMap({ nodes, deployments }: { nodes: ImpactNode[]; deployments: DeploymentSignal[] }) {
  const [selected, setSelected] = useState<ImpactNode | null>(null);
  const focus = selected ?? nodes.find((node) => node.relation === "AFFECTED");
  const labels = new Map(nodes.map((item) => [item.service_id, item.service_name]));
  const path = focus?.relation === "DOWNSTREAM" ? [...focus.path].reverse() : focus?.path;
  const recent = deployments.filter((item) => item.service_id === focus?.service_id);
  return <section className="ops-card ops-padded">
    <h2>Service impact</h2>
    <p className="ops-muted">Select a service to inspect the dependency path and deployments before this case opened.</p>
    <div className="ops-map">
      {columns.map(([relation, title]) => <div className="ops-map-column" key={relation}>
        <h3>{title}</h3>
        {nodes.filter((item) => item.relation === relation).map((item) => <button className="ops-node" aria-pressed={item === focus}
          key={item.service_id} onClick={() => setSelected(item)}>
          <strong>{item.service_name}</strong>
          <small>{pretty(item.criticality)} criticality{item.path.length > 1 && ` · ${item.path.length - 1} hop${item.path.length > 2 ? "s" : ""}`}</small>
        </button>)}
        {!nodes.some((item) => item.relation === relation) && <p className="ops-muted">None mapped</p>}
      </div>)}
    </div>
    {focus && <div className="ops-map-evidence">
      <h3>{focus.service_name}</h3>
      {path && path.length > 1 && <p className="ops-path">{path.map((id) => labels.get(id)).join(" → ")}</p>}
      <p className="ops-muted">Arrows point from a service to its dependency.</p>
      {recent.length ? <ul className="ops-items">{recent.map((item) => <li key={item.deployment_id}>
        <div><strong>{item.version}</strong><small>{item.environment} · {timestamp(item.deployed_at)}</small></div>
        <span>{pretty(item.deployment_status)}</span>
      </li>)}</ul> : <p>No deployments in this environment during the seven days before intake.</p>}
    </div>}
  </section>;
}
