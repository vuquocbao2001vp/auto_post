"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState("/templates");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (next?.startsWith("/")) {
      setNextPath(next);
    }

    if (!isSupabaseConfigured()) {
      return;
    }

    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace(next || "/templates");
      }
    });
  }, [router]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (!isSupabaseConfigured()) {
        throw new Error("Missing Supabase environment variables.");
      }

      const supabase = getSupabaseBrowserClient();
      const action =
        mode === "sign_in"
          ? supabase.auth.signInWithPassword({ email, password })
          : supabase.auth.signUp({ email, password });

      const { error } = await action;

      if (error) {
        throw error;
      }

      if (mode === "sign_up") {
        setMessage("Account created. If email confirmation is enabled, confirm it before signing in.");
      } else {
        router.replace(nextPath);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-layout">
      <div className="login-card">
        <div>
          <span className="eyebrow">Supabase auth</span>
          <h1 className="page-title">{mode === "sign_in" ? "Sign in" : "Create account"}</h1>
          <p className="page-copy">Use the same account in the dashboard and in the Chrome extension popup.</p>
        </div>

        {!isSupabaseConfigured() ? (
          <div className="status-message status-error">
            Missing Supabase config. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env.local</code>.
          </div>
        ) : null}

        <div className="login-switch">
          <button
            type="button"
            className={mode === "sign_in" ? "primary-button" : "ghost-button"}
            onClick={() => setMode("sign_in")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "sign_up" ? "primary-button" : "ghost-button"}
            onClick={() => setMode("sign_up")}
          >
            Create account
          </button>
        </div>

        <form className="stack" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {message ? <div className="status-message">{message}</div> : null}
          <button className="primary-button" disabled={loading || !isSupabaseConfigured()} type="submit">
            {loading ? "Working..." : mode === "sign_in" ? "Sign in" : "Create account"}
          </button>
        </form>

        <Link href="/" className="ghost-button">
          Back to landing page
        </Link>
      </div>
    </div>
  );
}
