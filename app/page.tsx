import Link from "next/link";

export default function HomePage() {
  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="hero-card">
          <span className="hero-eyebrow">Simple MVP</span>
          <h1 className="hero-title">Manage Facebook group posting from one lightweight dashboard.</h1>
          <p className="hero-copy">
            Create reusable templates, save group URLs, schedule one-time or daily runs, and let a Chrome
            extension publish with the Facebook account already signed in on the customer&apos;s browser.
          </p>
          <div className="hero-actions">
            <Link href="/login" className="primary-button">
              Sign in
            </Link>
            <Link href="/templates" className="secondary-button">
              Open dashboard
            </Link>
          </div>
        </div>
        <div className="hero-grid">
          <div className="feature-card">
            <span className="eyebrow">Flow</span>
            <h3>How this MVP works</h3>
            <ol className="feature-list">
              <li>Create a template with text and optional media.</li>
              <li>Paste Facebook group URLs.</li>
              <li>Create a one-time or daily schedule.</li>
              <li>Extension polls Supabase, claims due jobs, posts, and logs outcomes.</li>
            </ol>
          </div>
          <div className="feature-card">
            <span className="eyebrow">Setup</span>
            <h3>Deploy footprint</h3>
            <ul className="feature-list">
              <li>Next.js app on Vercel or Cloudflare Pages.</li>
              <li>Supabase Auth, Postgres, and Storage.</li>
              <li>Unpacked Chrome extension for internal pilots.</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
