"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { TemplateRecord } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: requestError } = await supabase
          .from("templates")
          .select("id, name, body, media_files, created_at")
          .order("created_at", { ascending: false });

        if (requestError) {
          throw requestError;
        }

        setTemplates((data ?? []) as TemplateRecord[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load templates.");
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
          <span className="eyebrow">Templates</span>
          <h1 className="page-title">Post templates</h1>
          <p className="page-copy">Keep reusable post copy and public media URLs that the extension can fetch later.</p>
        </div>
        <div className="page-actions">
          <Link href="/templates/new" className="primary-button">
            Create template
          </Link>
        </div>
      </header>

      <section className="card">
        {error ? <div className="status-message status-error">{error}</div> : null}
        {loading ? (
          <div className="status-message">Loading templates...</div>
        ) : templates.length === 0 ? (
          <div className="status-message">No templates yet. Create one to start scheduling posts.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Body preview</th>
                  <th>Media</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <strong>{template.name}</strong>
                    </td>
                    <td className="table-subtle">{template.body.slice(0, 140) || "No text"}</td>
                    <td>
                      <span className="badge">{template.media_files?.length ?? 0} files</span>
                    </td>
                    <td>{formatDateTime(template.created_at)}</td>
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
