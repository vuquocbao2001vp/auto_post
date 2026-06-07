"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type AuthGuardProps = {
  children: React.ReactNode;
};

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "ready" | "invalid">("loading");

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setState("invalid");
      return;
    }

    const supabase = getSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }

      setState("ready");
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      }
    });

    return () => subscription.unsubscribe();
  }, [pathname, router]);

  if (state === "invalid") {
    return (
      <div className="center-message">
        <h1>Missing Supabase config</h1>
        <p>Copy <code>.env.example</code> to <code>.env.local</code> and set your Supabase URL and anon key.</p>
      </div>
    );
  }

  if (state !== "ready") {
    return (
      <div className="center-message">
        <h1>Loading dashboard...</h1>
        <p>Checking your session.</p>
      </div>
    );
  }

  return <>{children}</>;
}
