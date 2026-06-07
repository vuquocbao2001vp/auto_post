"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeGroupUrls } from "@/lib/utils";

export default function NewGroupsPage() {
  const router = useRouter();
  const [labelPrefix, setLabelPrefix] = useState("");
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("User session not found.");
      }

      const parsedUrls = normalizeGroupUrls(urls);
      if (!parsedUrls.length) {
        throw new Error("Paste at least one group URL.");
      }

      const rows = parsedUrls.map((url, index) => ({
        user_id: user.id,
        url,
        label: labelPrefix ? `${labelPrefix} ${index + 1}` : null,
        status: /^https?:\/\/(www\.)?facebook\.com\/groups\//i.test(url) ? "active" : "invalid"
      }));

      const { error } = await supabase.from("groups").insert(rows);

      if (error) {
        throw error;
      }

      router.push("/groups");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save groups.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid two">
      <section className="card">
        <span className="eyebrow">Bulk import</span>
        <h1 className="page-title">Save group URLs</h1>
        <p className="page-copy">Each non-empty line becomes one row. URLs that do not match the Facebook group pattern are marked invalid.</p>
      </section>

      <section className="card">
        <form className="stack" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="labelPrefix">Label prefix</label>
            <input
              id="labelPrefix"
              value={labelPrefix}
              onChange={(e) => setLabelPrefix(e.target.value)}
              placeholder="Example: Hanoi campaign"
            />
          </div>

          <div className="field">
            <label htmlFor="urls">Group URLs</label>
            <textarea
              id="urls"
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder={"https://www.facebook.com/groups/123456789\nhttps://www.facebook.com/groups/example-group"}
              required
            />
          </div>

          {message ? <div className="status-message status-error">{message}</div> : null}

          <div className="form-actions">
            <button className="primary-button" disabled={loading} type="submit">
              {loading ? "Saving..." : "Save groups"}
            </button>
            <button className="secondary-button" type="button" onClick={() => router.push("/groups")}>
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
