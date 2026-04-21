import {
  agentRoles,
  boundaryCards,
  commandCards,
  productTracks,
  repoIdentity,
  reviewClaims,
} from "@firapps/foundation";

export function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{repoIdentity.eyebrow}</p>
          <h1>{repoIdentity.name}</h1>
          <p className="tagline">{repoIdentity.tagline}</p>
        </div>

        <aside className="hero-panel">
          <p className="panel-kicker">Doctrine</p>
          <ul className="stack">
            {repoIdentity.doctrine.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </aside>
      </section>

      <section className="command-grid">
        {commandCards.map((card) => (
          <article key={card.command} className="command-card">
            <p className="panel-kicker">{card.label}</p>
            <code>{card.command}</code>
            <p>{card.note}</p>
          </article>
        ))}
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>Repo boundary</h2>
          <ul className="stack">
            {boundaryCards.map((card) => (
              <li key={card.title}>
                <strong>{card.title}</strong>
                <p>{card.summary}</p>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h2>Active tracks</h2>
          <ul className="stack">
            {productTracks.map((track) => (
              <li key={track.name}>
                <strong>{track.name}</strong>
                <p>{track.summary}</p>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel panel-wide">
          <h2>Review claims</h2>
          <div className="claim-grid">
            {reviewClaims.map((claim) => (
              <section key={claim.claim} className="claim-card">
                <h3>{claim.claim}</h3>
                <p>{claim.evidence}</p>
                <span>{claim.source}</span>
              </section>
            ))}
          </div>
        </article>

        <article className="panel panel-wide">
          <h2>Product bootstrap team</h2>
          <div className="role-grid">
            {agentRoles.map((role) => (
              <section key={role.name} className="role-card">
                <h3>{role.name}</h3>
                <p>{role.summary}</p>
                <span>{role.handoff}</span>
              </section>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
