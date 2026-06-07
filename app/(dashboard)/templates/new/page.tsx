"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MediaFile } from "@/lib/types";

export default function NewTemplatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
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

      const uploadedMedia: MediaFile[] = [];

      if (files?.length) {
        const selectedFiles = Array.from(files);

        if (selectedFiles.filter((file) => file.type.startsWith("video/")).length > 1) {
          throw new Error("Upload at most one video per template.");
        }

        for (const file of selectedFiles) {
          const storagePath = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/\s+/g, "-")}`;
          const { error: uploadError } = await supabase.storage
            .from("template-media")
            .upload(storagePath, file, { cacheControl: "3600", upsert: false });

          if (uploadError) {
            throw uploadError;
          }

          const { data: publicData } = supabase.storage.from("template-media").getPublicUrl(storagePath);

          uploadedMedia.push({
            name: file.name,
            size: file.size,
            type: file.type,
            url: publicData.publicUrl
          });
        }
      }

      const { error } = await supabase.from("templates").insert({
        user_id: user.id,
        name,
        body,
        media_files: uploadedMedia
      });

      if (error) {
        throw error;
      }

      router.push("/templates");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save template.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid two">
      <section className="card">
        <span className="eyebrow">New template</span>
        <h1 className="page-title">Create posting template</h1>
        <p className="page-copy">
          Template media is uploaded into the public <code>template-media</code> bucket so the extension can fetch it.
        </p>
      </section>

      <section className="card">
        <form className="stack" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="name">Template name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="field">
            <label htmlFor="body">Post body</label>
            <textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="files">Images or one short video</label>
            <input
              id="files"
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(e) => setFiles(e.target.files)}
            />
            <p className="help-text">Keep uploads small. The extension converts these public URLs back into Files at runtime.</p>
          </div>

          {message ? <div className="status-message status-error">{message}</div> : null}

          <div className="form-actions">
            <button className="primary-button" disabled={loading} type="submit">
              {loading ? "Saving..." : "Save template"}
            </button>
            <button className="secondary-button" type="button" onClick={() => router.push("/templates")}>
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
