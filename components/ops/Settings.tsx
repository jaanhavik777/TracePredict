"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api-client";
import { categories, memberRoles, type Team } from "@/lib/ops/contracts";
import { pretty } from "./format";

type SettingsData = {
  members: { team_id: string; user_id: number; full_name: string; is_active: boolean; role: string }[];
  sources: { source_id: string; team_id: string; name: string; enabled: boolean }[];
  retention: { team_id: string; retention_days: number }[];
  runbooks: { category: string; name: string; version: number; steps: string[] }[];
};
type SourceKey = { path: string; key: string };
type User = { user_id: number; full_name: string; is_active: boolean };

export default function Settings({ teams, onChange }: { teams: Team[]; onChange: () => void }) {
  const [settings, setSettings] = useState<SettingsData>();
  const [users, setUsers] = useState<User[]>([]);
  const [secret, setSecret] = useState<SourceKey | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [result, directory] = await Promise.all([
      api<SettingsData>("/api/ops/settings"), api<{ users: User[] }>("/api/users"),
    ]);
    setSettings(result);
    setUsers(directory.users);
  }, []);
  useEffect(() => { load().catch((failure) => setError(failure.message)); }, [load]);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await api<SourceKey | { saved: boolean }>("/api/ops/settings", { method: "POST", body });
      if ("key" in result) setSecret(result);
      await load();
      onChange();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const data = { ...values, action };
    if (action === "membership") void save({ ...data, userId: Number(values.userId) });
    else if (action === "retention") void save({ ...data, days: Number(values.days) });
    else if (action === "runbook") void save({ ...data, steps: String(values.steps).split(/\r?\n/).map((step) => step.trim()).filter(Boolean) });
    else void save(data);
  }
  const teamOptions = teams.map((team) => <option key={team.team_id} value={team.team_id}>{team.name}</option>);
  return <>
    {error && <p className="ops-card ops-padded error" role="alert">{error}</p>}
    {secret && <section className="ops-card ops-padded">
      <div className="ops-section-title"><div><h2>New source credential</h2><p>Save the key in your alerting system’s secret store. It is shown once.</p></div>
        <button className="ops-button" onClick={() => setSecret(null)}>Dismiss</button></div>
      <label>Receiver path<input readOnly value={secret.path} onFocus={(event) => event.target.select()} /></label>
      <label>Signing key<input readOnly value={secret.key} onFocus={(event) => event.target.select()} /></label>
    </section>}
    <div className="ops-profile-grid">
      <section className="ops-card ops-padded"><h2>Team management</h2>
        <form className="ops-form" onSubmit={(event) => submit(event, "team")}>
          <label>Team name<input required name="name" minLength={2} maxLength={80} placeholder="e.g. Identity response" /></label>
          <button disabled={busy} className="ops-button">Create team</button>
        </form>
        <form className="ops-form" onSubmit={(event) => submit(event, "membership")}>
          <label>Team<select name="teamId" required>{teamOptions}</select></label>
          <label>User<select name="userId" required>{users.filter((user) => user.is_active).map((user) =>
            <option value={user.user_id} key={user.user_id}>{user.full_name}</option>)}</select></label>
          <label>Role<select name="role">{memberRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
          <button disabled={busy || !teams.length} className="ops-button ops-primary">Save membership</button>
        </form>
        <ul className="ops-items">{settings?.members.map((member) => <li key={`${member.team_id}/${member.user_id}`}>
          <div><strong>{member.full_name}</strong><small>{teams.find((team) => team.team_id === member.team_id)?.name} · {member.role}</small></div>
          <button type="button" disabled={busy} className="ops-button" onClick={() => save({
            action: "remove", teamId: member.team_id, userId: member.user_id,
          })}>Remove</button>
        </li>)}</ul>
      </section>
      <section className="ops-card ops-padded"><h2>Alert sources</h2>
        <form className="ops-form" onSubmit={(event) => submit(event, "source")}>
          <label>Owning team<select name="teamId" required>{teamOptions}</select></label>
          <label>Source name<input name="name" required minLength={2} maxLength={80} placeholder="e.g. Identity monitor" /></label>
          <button disabled={busy || !teams.length} className="ops-button ops-primary">Create signed source</button>
        </form>
        <ul className="ops-items">{settings?.sources.map((source) => <li key={source.source_id}>
          <div><strong>{source.name}</strong><small>{teams.find((team) => team.team_id === source.team_id)?.name} · {source.enabled ? "Enabled" : "Revoked"}</small></div>
          {source.enabled && <button type="button" className="ops-button" disabled={busy} onClick={() => save({ action: "revoke", sourceId: source.source_id })}>Revoke</button>}
        </li>)}</ul>
      </section>
    </div>
    <div className="ops-profile-grid">
      <section className="ops-card ops-padded"><h2>Evidence retention</h2>
        <p className="ops-muted">Restricted details expire after the team’s retention window. Shared summaries and audit records remain available.</p>
        <form className="ops-form" onSubmit={(event) => submit(event, "retention")}>
          <label>Team<select name="teamId" required>{teamOptions}</select></label>
          <label>Retention days<input name="days" type="number" min={7} max={365} required defaultValue={90} /></label>
          <button disabled={busy || !teams.length} className="ops-button ops-primary">Save retention policy</button>
        </form>
        <ul className="ops-items">{settings?.retention.map((item) => <li key={item.team_id}>
          <strong>{teams.find((team) => team.team_id === item.team_id)?.name}</strong><span>{item.retention_days} days</span>
        </li>)}</ul>
      </section>
      <section className="ops-card ops-padded"><h2>Runbook versions</h2>
        <p className="ops-muted">Publishing a version applies it to newly opened cases in that category.</p>
        <form className="ops-form" onSubmit={(event) => submit(event, "runbook")}>
          <label>Category<select name="category">{categories.map((category) => <option key={category} value={category}>{pretty(category)}</option>)}</select></label>
          <label>Runbook title<input name="name" required minLength={2} maxLength={80} /></label>
          <label className="ops-full">Steps, one per line<textarea name="steps" required rows={4} maxLength={5000} /></label>
          <button className="ops-button ops-primary" disabled={busy}>Publish new version</button>
        </form>
        <ul className="ops-items">{settings?.runbooks.map((item) => <li key={item.category}>
          <div><strong>{item.name}</strong><small>{pretty(item.category)} · {item.steps.length} steps</small></div><span>v{item.version}</span>
        </li>)}</ul>
      </section>
    </div>
  </>;
}
