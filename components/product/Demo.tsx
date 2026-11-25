"use client";
import Link from "next/link";
import { useState } from "react";

const signals = ["Unexpected access change", "Second monitor confirms the change"];
export default function Demo() {
  const [step, setStep] = useState(0);
  return <main className="product-narrow">
    <Link href="/">← TracePredict</Link>
    <h1>Try a sample incident</h1>
    <p className="muted">This walkthrough uses sample data and runs in your browser.</p>
    <section className="card">
      <h2>Identity service access review</h2>
      <p className="panel-label">{step === 0 ? "Awaiting alerts" : step === 3 ? "Resolved · 1 case" : "Investigating · 1 case"}</p>
      {step > 0 && <ol className="timeline">{signals.slice(0, step > 1 ? 2 : 1).map((signal) => <li key={signal}>{signal}</li>)}</ol>}
      {step > 1 && <p>Both alerts reference the same service, environment, and category. They stay in one case.</p>}
      {step === 3 && <p><strong>Resolution</strong> · On-call confirmed the change was part of an approved access review.</p>}
      {step < 3
        ? <button className="btn" onClick={() => setStep(step + 1)}>{["Receive an alert", "Receive a related alert", "Resolve the case"][step]}</button>
        : <button className="btn btn-blue" onClick={() => setStep(0)}>Restart walkthrough</button>}
    </section>
    <Link className="btn product-link" href="/signup">Create a workspace</Link>
  </main>;
}
