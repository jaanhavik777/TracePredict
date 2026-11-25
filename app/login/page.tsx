"use client";
// Login page. OWNER: Jaanhavi
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Login failed");
        return;
      }
      const user = await res.json();
      const invite = new URLSearchParams(window.location.search).get("invite");
      router.push(user.role === "CUSTOMER" ? invite && /^[a-f0-9]{64}$/.test(invite) ? `/signup?invite=${invite}` : "/workspace" : "/incidents");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <header className="login-intro">
        <span className="nav-mark" aria-hidden="true" />
        <h1>TracePredict</h1>
        <p className="muted">Incident intelligence and security operations</p>
      </header>
      <figure className="login-visual">
        <figcaption><span>Service impact</span><span>Illustrative case</span></figcaption>
        <div className="login-map">
          <div className="login-map-node login-map-dependency">
            <strong>Session store</strong><small>Upstream dependency</small>
          </div>
          <div className="login-map-node login-map-affected">
            <strong>Auth service</strong><small>Affected service</small>
          </div>
          <div className="login-map-node login-map-downstream">
            <strong>Customer portal</strong><small>Downstream at risk</small>
          </div>
        </div>
      </figure>
      <form onSubmit={onSubmit} className="card login-form">
        <h2>Sign in</h2>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                 autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete="current-password" />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="submit" disabled={busy} className="btn login-submit">
          {busy ? "Signing in…" : "Sign in"}<span aria-hidden="true">↗</span>
        </button>
        <Link href="/signup" className="login-back">Create a workspace</Link>
      </form>
    </main>
  );
}
