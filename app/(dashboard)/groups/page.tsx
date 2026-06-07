"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { GroupRecord } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: requestError } = await supabase
          .from("groups")
          .select("id, url, label, status, created_at")
          .order("created_at", { ascending: false });

        if (requestError) {
          throw requestError;
        }

        setGroups((data ?? []) as GroupRecord[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load groups.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Groups</span>
          <h1 className="page-title">Target groups</h1>
          <p className="page-copy">Paste the exact Facebook group URLs you want the extension to visit.</p>
        </div>
        <Link href="/groups/new" className="primary-button">
          Add groups
        </Link>
      </header>

      <section className="card">
        {error ? <div className="status-message status-error">{error}</div> : null}
        {loading ? (
          <div className="status-message">Loading groups...</div>
        ) : groups.length === 0 ? (
          <div className="status-message">No groups saved yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.id}>
                    <td>{group.label || "Untitled group"}</td>
                    <td className="mono">{group.url}</td>
                    <td>
                      <span className={`badge ${group.status === "active" ? "badge-success" : "badge-warning"}`}>
                        {group.status}
                      </span>
                    </td>
                    <td>{formatDateTime(group.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
