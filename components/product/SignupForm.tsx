"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api-client";

export default function SignupForm({ invite, registrationOpen }: { invite: string; registrationOpen: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/signup", { method: "POST", body: { ...values, ...(invite ? { invite } : {}) } });
      router.push("/workspace");
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function accept() {
    setBusy(true);
    setError("");
    try {
      await api("/api/workspace/join", { method: "POST", body: { invite } });
      router.push("/ops");
      router.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="product-narrow">
    <Link href="/">← TracePredict</Link>
    <h1>{invite ? "Join a workspace" : "Create your workspace"}</h1>
    {invite && <p className="muted">Use the email address your workspace lead invited.</p>}
    {invite || registrationOpen ? <form className="card product-form" onSubmit={submit}>
      {!invite && <label>Workspace name<input name="workspace" required minLength={2} maxLength={80} /></label>}
      <label>Full name<input name="fullName" required minLength={2} maxLength={100} autoComplete="name" /></label>
      <label>Work email<input name="email" type="email" required maxLength={150} autoComplete="email" /></label>
      <label>Password<input name="password" type="password" required minLength={12} maxLength={72} autoComplete="new-password" /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn" disabled={busy}>{invite ? "Join with a new account" : "Create workspace"}</button>
      {invite && <button type="button" className="btn btn-blue" onClick={accept} disabled={busy}>Accept with signed-in account</button>}
    </form> : <section className="card"><p>Workspace registration is currently closed. You can still <Link href="/demo">explore the demo</Link>.</p></section>}
    <Link href={invite ? `/login?invite=${encodeURIComponent(invite)}` : "/login"}>Already have an account? Sign in</Link>
  </main>;
}
