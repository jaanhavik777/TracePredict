"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api-client";
import type { Team } from "@/lib/ops/contracts";

type Service = { team_id: string; service_id: number; name: string };
type Source = { source_id: string; team_id: string; name: string; provider: "signed" | "github"; enabled: boolean; repository: string | null; service_id: number; last_delivery: string | null };
type Data = { teams: Team[]; services: Service[]; connections: Source[] };
type Result = { path?: string; key?: string; invitePath?: string; deliveryId?: string };

export default function Connections() {
  const [data, setData] = useState<Data>();
  const [teamId, setTeam] = useState("");
  const [provider, setProvider] = useState("github");
  const [result, setResult] = useState<Result>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const workspace = await api<Data>("/api/workspace");
    setData(workspace);
    setTeam((id) => id || workspace.teams[0]?.team_id || "");
  }
  useEffect(() => { void load().catch((failure) => setError(failure.message)); }, []);
  const team = data?.teams.find((item) => item.team_id === teamId);
  const services = data?.services.filter((item) => item.team_id === teamId) ?? [];
  const lead = team?.role === "LEAD" || team?.role === "ADMIN";

  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    if (body.action === "github" || body.action === "signed" || body.action === "invite") setResult(undefined);
    try {
      const response = await api<Result>("/api/workspace", { method: "POST", body: { ...body, teamId } });
      if (response.path || response.invitePath) setResult(response);
      else if (response.deliveryId) setNotice("Test issue queued. Open the case queue to review it after processing.");
      else setNotice("Saved.");
      await load();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function read(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void submit({ ...values, action, ...(values.serviceId ? { serviceId: Number(values.serviceId) } : {}) });
  }

  return <main>
    <div className="result-heading">
      <h1>Workspace connections</h1>
      <Link href="/ops">Open case queue →</Link>
    </div>
    <p className="muted">Connect a repository or alerting tool to log issues in your workspace.</p>
    {data && <label className="product-selector">Workspace
      <select value={teamId} onChange={(event) => { setTeam(event.target.value); setResult(undefined); setNotice(""); }}>
        {data.teams.map((item) => <option key={item.team_id} value={item.team_id}>{item.name}</option>)}
      </select>
    </label>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    {!data && !error && <p role="status">Loading workspace…</p>}
    {data && !team && <p>You haven’t joined a workspace yet.</p>}
    {team && !lead && <p>Your lead manages this workspace’s connections. <Link href="/ops">View cases</Link>.</p>}
    {lead && <>
      {result && <section className="card product-form">
        <div className="result-heading"><h2>{result.key ? "Connection credentials" : "Invitation link"}</h2>
          <button className="btn btn-blue btn-sm" onClick={() => setResult(undefined)}>Dismiss</button></div>
        {result.key && <>
          <p className="muted">Copy the signing secret now. The workspace won’t display it again.</p>
          <label>Webhook URL<input readOnly value={window.location.origin + result.path} onFocus={(event) => event.target.select()} /></label>
          <label>Signing secret<input readOnly value={result.key} onFocus={(event) => event.target.select()} /></label>
        </>}
        {result.invitePath && <label>Share this link privately<input readOnly value={window.location.origin + result.invitePath} onFocus={(event) => event.target.select()} /></label>}
      </section>}
      <div className="grid2">
        <form className="card product-form" onSubmit={(event) => read(event, provider)}>
          <h2>Connect a tool</h2>
          <label>Provider<select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="github">GitHub Issues</option><option value="signed">Signed webhook</option>
          </select></label>
          <label>Connection name<input name="name" required minLength={2} maxLength={80} /></label>
          <label>Service<select name="serviceId" required>{services.map((service) => <option value={service.service_id} key={service.service_id}>{service.name}</option>)}</select></label>
          {provider === "github" ? <>
            <label>Repository<input name="repository" placeholder="owner/repository" required maxLength={140} /></label>
            <p className="muted">Add the URL and signing secret under the repository’s webhook settings. Set the content type to JSON and subscribe to Issues.</p>
          </> : <p className="muted">Send JSON and sign the exact request body with HMAC-SHA256. The connection is bound to the selected service.</p>}
          <button className="btn" disabled={busy || !services.length}>Create connection</button>
        </form>
        <div>
          <form className="card product-form" onSubmit={(event) => read(event, "service")}>
            <h2>Add a service</h2>
            <label>Service name<input name="name" required minLength={2} maxLength={80} /></label>
            <button className="btn btn-blue" disabled={busy}>Add service</button>
          </form>
          <form className="card product-form" onSubmit={(event) => read(event, "invite")}>
            <h2>Invite a teammate</h2>
            <label>Email<input name="email" type="email" required maxLength={150} /></label>
            <label>Role<select name="role"><option value="RESPONDER">Responder</option><option value="AUDITOR">Auditor</option></select></label>
            <button className="btn btn-blue" disabled={busy}>Create invitation link</button>
          </form>
        </div>
      </div>
      <section className="card">
        <h2>Connections</h2>
        {!data?.connections.some((source) => source.team_id === teamId) && <p className="muted">No connections yet.</p>}
        <ul className="panel-list">{data?.connections.filter((source) => source.team_id === teamId).map((source) => <li key={source.source_id}>
          <div><strong>{source.name}</strong><p className="muted">{source.repository ?? "Signed webhook"} · {source.enabled ? "Enabled" : "Revoked"}
            {source.last_delivery ? " · Last received " + new Date(source.last_delivery).toLocaleString() : " · Awaiting first delivery"}</p></div>
          {source.enabled && <div className="row">
            <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => submit({ action: "test", sourceId: source.source_id })}>Send test issue</button>
            <button className="btn btn-blue btn-sm danger" disabled={busy} onClick={() => submit({ action: "revoke", sourceId: source.source_id })}>Revoke</button>
          </div>}
        </li>)}</ul>
      </section>
    </>}
  </main>;
}
