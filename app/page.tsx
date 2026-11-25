import Link from "next/link";

export default function Home() {
  return <main className="product-home">
    <nav className="product-nav" aria-label="Product">
      <strong className="nav-brand"><span className="nav-mark" aria-hidden="true" />TracePredict</strong>
      <Link href="/login">Sign in</Link>
    </nav>
    <section className="product-hero">
      <div>
        <h1>From incoming alert to resolved issue.</h1>
        <p className="muted">Connect your tools, give your team one case to investigate, and keep a record of what fixed it.</p>
        <div className="row product-actions">
          <Link className="btn product-link" href="/signup">Create a workspace</Link>
          <Link className="btn btn-blue product-link" href="/demo">Try a sample incident</Link>
        </div>
      </div>
      <section className="login-visual product-feed" aria-label="Issue workflow">
        <p className="panel-label">Issue workflow</p>
        <ol className="panel-list">
          <li><strong>Receive</strong><span>GitHub Issues or signed webhooks</span></li>
          <li><strong>Investigate</strong><span>Service impact, evidence, and owners</span></li>
          <li><strong>Resolve</strong><span>Runbooks, follow-ups, and postmortems</span></li>
        </ol>
      </section>
    </section>
  </main>;
}
