"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type GroupFormProps = {
  groupId: string;
};

export function GroupForm({ groupId }: GroupFormProps) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"active" | "invalid">("active");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("groups")
          .select("id, label, url, status")
          .eq("id", groupId)
          .single();

        if (error) {
          throw error;
        }

        setLabel(data.label ?? "");
        setUrl(data.url);
        setStatus(data.status);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load group.");
      } finally {
        setInitialLoading(false);
      }
    };

    void load();
  }, [groupId]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("groups")
        .update({
          label: label || null,
          url,
          status
        })
        .eq("id", groupId);

      if (error) {
        throw error;
      }

      router.push("/groups");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update group.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid two">
      <section className="card">
        <span className="eyebrow">Edit group</span>
        <h1 className="page-title">Update target group</h1>
        <p className="page-copy">Edit the saved label, URL, or mark the row invalid to keep it out of new schedules.</p>
      </section>

      <section className="card">
        {initialLoading ? (
          <div className="status-message">Loading group...</div>
        ) : (
          <form className="stack" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="label">Label</label>
              <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="url">Group URL</label>
              <input id="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" value={status} onChange={(e) => setStatus(e.target.value as "active" | "invalid")}>
                <option value="active">active</option>
                <option value="invalid">invalid</option>
              </select>
            </div>

            {message ? <div className="status-message status-error">{message}</div> : null}

            <div className="form-actions">
              <button className="primary-button" disabled={loading} type="submit">
                {loading ? "Saving..." : "Save changes"}
              </button>
              <button className="secondary-button" type="button" onClick={() => router.push("/groups")}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
