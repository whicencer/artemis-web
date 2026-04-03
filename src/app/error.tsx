"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-state">
      <h1>Mission control temporarily unavailable</h1>
      <p>NASA source feeds could not be loaded right now. Retry to recover live mission data.</p>
      <button className="button" onClick={() => reset()} type="button">
        Retry
      </button>
    </main>
  );
}
