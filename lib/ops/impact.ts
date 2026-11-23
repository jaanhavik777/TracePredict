import type { PoolClient } from "pg";
import type { Service } from "./contracts";

export type ImpactNode = Service & { relation: "AFFECTED" | "UPSTREAM" | "DOWNSTREAM"; path: number[] };
type Dependency = { service_id: number; depends_on_service_id: number };
export type DeploymentSignal = {
  deployment_id: number; service_id: number; version: string; environment: string;
  deployed_at: string; deployment_status: string;
};

export function impactPaths(services: Service[], dependencies: Dependency[], affected: number[], depth = 4) {
  const byId = new Map(services.map((service) => [service.service_id, service]));
  const roots = [...new Set(affected)].filter((id) => byId.has(id));
  const nodes: ImpactNode[] = roots.map((id) => ({ ...byId.get(id)!, relation: "AFFECTED", path: [id] }));
  for (const relation of ["UPSTREAM", "DOWNSTREAM"] as const) {
    const adjacency = new Map<number, number[]>();
    for (const edge of dependencies) {
      const [from, to] = relation === "UPSTREAM"
        ? [edge.service_id, edge.depends_on_service_id] : [edge.depends_on_service_id, edge.service_id];
      const neighbors = adjacency.get(from) ?? [];
      neighbors.push(to);
      adjacency.set(from, neighbors);
    }
    const seen = new Set(roots);
    const queue = roots.map((id) => [id]);
    for (const path of queue) {
      if (path.length > depth) continue;
      for (const id of adjacency.get(path[path.length - 1]) ?? []) {
        const service = byId.get(id);
        if (!service || seen.has(id)) continue;
        seen.add(id);
        const nextPath = [...path, id];
        queue.push(nextPath);
        nodes.push({ ...service, relation, path: nextPath });
      }
    }
  }
  return nodes;
}

export async function caseImpact(client: PoolClient, serviceId: number, environment: string, openedAt: string) {
  const { rows: services } = await client.query<Service>(
    "SELECT service_id, service_name, criticality FROM services ORDER BY service_id",
  );
  const { rows: dependencies } = await client.query<Dependency>(
    "SELECT service_id, depends_on_service_id FROM service_dependencies ORDER BY service_id, depends_on_service_id",
  );
  const nodes = impactPaths(services, dependencies, [serviceId]);
  const { rows: deployments } = await client.query<DeploymentSignal>(
    `SELECT deployment_id, service_id, version, environment, deployed_at, deployment_status
     FROM deployments WHERE service_id = ANY($1::int[]) AND lower(environment) = $2
       AND deployed_at BETWEEN ($3::timestamptz AT TIME ZONE 'UTC') - INTERVAL '7 days'
         AND ($3::timestamptz AT TIME ZONE 'UTC')
     ORDER BY deployed_at DESC LIMIT 60`,
    [nodes.map((node) => node.service_id), environment, openedAt],
  );
  return { nodes, deployments };
}
