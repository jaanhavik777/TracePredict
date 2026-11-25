
"use client";

import { useState } from "react";

interface SearchResult {
  incident_id: number;
  title: string;
  similarity_pct: number;
  root_cause: string | null;
  resolution: string | null;
}

export default function Page() {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!searchQuery.trim()) {
      setError("Please enter a search query.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setHasSearched(true);
      setResults([]);

      const response = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery.trim())}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to search incidents.");
      }

      setResults(data.results ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <section className="card search-console">
        <h1>Semantic search</h1>
        <p className="muted">
          Search historical incidents using their meaning, symptoms,
          root causes, and resolutions.
        </p>

        <form onSubmit={handleSearch} className="search-controls">
          <input
            type="text"
            aria-label="Incident description"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Describe the incident you're looking for..."
          />

          <button
            type="submit"
            disabled={loading}
            className="btn"
          >
            {loading ? "Searching..." : "Search incidents"}
          </button>
        </form>
      </section>

      {loading && (
        <p className="muted">Finding semantically similar incidents...</p>
      )}

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {!loading && hasSearched && !error && results.length === 0 && (
        <section className="card">
          <p>No similar incidents found. Try a different description.</p>
        </section>
      )}

      {!loading && results.length > 0 && (
        <section className="card">
          <h2>Search results ({results.length})</h2>

          {results.map((incident) => (
            <article
              key={incident.incident_id}
              className="search-result"
            >
              <div className="result-heading">
                <h3>
                  <a
                    href={`/incidents/${incident.incident_id}`}
                  >
                    {incident.title}
                  </a>
                </h3>

                <span className="badge sev-low">
                  {incident.similarity_pct}% match
                </span>
              </div>

              <p className="panel-label">
                Incident #{incident.incident_id}
              </p>

              <div className="grid2">
                <div>
                  <strong>Root cause</strong>
                  <p className="muted">
                    {incident.root_cause || "Not available"}
                  </p>
                </div>

                <div>
                  <strong>Resolution</strong>
                  <p className="muted">
                    {incident.resolution || "Not available"}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
