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
  const [actionTemplateId, setActionTemplateId] = useState<string | null>(null);

  useEffect(() => {
    void loadTemplates();
  }, []);

  const loadTemplates = async () => {
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

  const deleteTemplate = async (templateId: string) => {
    const confirmed = window.confirm("Delete this template? Existing schedules keep their snapshots, but this template will disappear.");
    if (!confirmed) {
      return;
    }

    setActionTemplateId(templateId);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const template = templates.find((item) => item.id === templateId);
      const { error: deleteError } = await supabase.from("templates").delete().eq("id", templateId);
      if (deleteError) {
        throw deleteError;
      }

      const removedPaths = (template?.media_files ?? [])
        .map((file) => {
          const marker = "/storage/v1/object/public/template-media/";
          const index = file.url.indexOf(marker);
          return index === -1 ? null : decodeURIComponent(file.url.slice(index + marker.length));
        })
        .filter((path): path is string => Boolean(path));

      if (removedPaths.length) {
        await supabase.storage.from("template-media").remove(removedPaths);
      }

      setTemplates((current) => current.filter((templateItem) => templateItem.id !== templateId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete template.");
    } finally {
      setActionTemplateId(null);
    }
  };

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
                  <th>Actions</th>
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
                    <td>
                      <div className="inline-actions">
                        <Link href={`/templates/${template.id}/edit`} className="secondary-button">
                          Edit
                        </Link>
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={actionTemplateId === template.id}
                          onClick={() => deleteTemplate(template.id)}
                        >
                          {actionTemplateId === template.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
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
