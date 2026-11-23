"use client";

import { type FormEvent } from "react";
import type { SecurityCase } from "@/lib/ops/contracts";
import type { Coordination } from "@/lib/ops/coordination";
import { pretty, timestamp } from "./format";

type Props = {
  record: SecurityCase; response: Coordination; canWrite: boolean; busy: boolean;
  submit: (body: Record<string, unknown>) => void; postmortem?: string;
};

export default function ResponsePlan({ record, response, canWrite, busy, submit, postmortem }: Props) {
  const active = record.status !== "RESOLVED";
  const writable = active && canWrite;
  const name = (id: number | null) => response.owners.find((owner) => owner.user_id === id)?.full_name
    ?? (id === null ? "Unassigned" : `User #${id}`);

  function handoff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    submit({ action: "handoff", ownerId: Number(form.get("owner")) || null, note: form.get("note") });
  }

  function followup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    submit({ action: "followup", title: form.get("title"), ownerId: Number(form.get("owner")), dueOn: form.get("due") });
  }

  return <>
    <div className="ops-profile-grid">
      <section className="ops-card ops-padded">
        <h2>Response coordination</h2>
        <dl className="ops-facts">
          <div><dt>Owner</dt><dd>{name(record.owner_id)}</dd></div>
          <div><dt>Acknowledge by</dt><dd>{record.ack_due_at ? timestamp(record.ack_due_at) : "Unavailable"}</dd></div>
          <div><dt>Acknowledgement</dt><dd>{record.acknowledged_at ? timestamp(record.acknowledged_at) : "Pending"}</dd></div>
          <div><dt>Escalation</dt><dd>{record.escalated_at ? timestamp(record.escalated_at) : "—"}</dd></div>
        </dl>
        {writable && !record.acknowledged_at && <button type="button" className="ops-button ops-primary" disabled={busy}
          onClick={() => submit({ action: "acknowledge" })}>Acknowledge case</button>}
        {writable && <form className="ops-form" onSubmit={handoff}>
          <label>New owner<select name="owner" defaultValue={record.owner_id ?? ""}>
            <option value="">Unassigned</option>
            {response.owners.map((owner) => <option key={owner.user_id} value={owner.user_id}>{owner.full_name}</option>)}
          </select></label>
          <label>Handoff note<input name="note" required minLength={3} maxLength={300} /></label>
          <button className="ops-button" disabled={busy}>Record handoff</button>
        </form>}
      </section>
      <section className="ops-card ops-padded">
        <h2>Runbook</h2>
        {response.runbook ? <>
          <p className="ops-muted">{response.runbook.name} · Version {response.runbook.version}</p>
          <ul className="ops-items ops-checklist">{response.runbook.steps.map((step, index) => <li key={index}>
            <label><input type="checkbox" checked={record.checked_steps.includes(index)} disabled={!writable || busy}
              onChange={(event) => submit({ action: "check", step: index, checked: event.target.checked })} />{step}</label>
          </li>)}</ul>
        </> : <p>No runbook was assigned to this case.</p>}
      </section>
    </div>
    <div className="ops-profile-grid">
      <section className="ops-card ops-padded">
        <h2>Response timeline</h2>
        {response.events.length ? <ol className="ops-items">{response.events.map((event) => <li key={event.event_id}>
          <div><strong>{pretty(event.kind)}</strong><p>{event.detail}</p><small>{timestamp(event.created_at)} · {event.actor_id ? `User #${event.actor_id}` : "Automation"}</small></div>
        </li>)}</ol> : <p className="ops-muted">No response milestones recorded.</p>}
        {record.status === "RESOLVED" && postmortem && <a className="ops-button" href={postmortem}>Download postmortem draft</a>}
      </section>
      <section className="ops-card ops-padded">
        <h2>Follow-up actions</h2>
        {response.followups.length ? <ul className="ops-items">{response.followups.map((item) => <li key={item.followup_id}>
          <div><strong>{item.title}</strong><small>{name(item.owner_id)} · Due {item.due_on}{item.done_at ? " · Complete" : ""}</small></div>
          {canWrite && !item.done_at && <button type="button" className="ops-button" disabled={busy}
            onClick={() => submit({ action: "complete", followupId: item.followup_id })}>Complete</button>}
        </li>)}</ul> : <p className="ops-muted">No follow-ups recorded.</p>}
        {canWrite && !!response.owners.length && <form className="ops-form" onSubmit={followup}>
          <label className="ops-full">Action<input name="title" required minLength={3} maxLength={180} /></label>
          <label>Owner<select name="owner" required>{response.owners.map((owner) => <option key={owner.user_id} value={owner.user_id}>{owner.full_name}</option>)}</select></label>
          <label>Due date<input type="date" name="due" required /></label>
          <button className="ops-button ops-primary" disabled={busy}>Add follow-up</button>
        </form>}
      </section>
    </div>
  </>;
}
