"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MediaFile, TemplateRecord } from "@/lib/types";

type TemplateFormProps = {
  mode: "create" | "edit";
  templateId?: string;
};

function getStoragePathFromPublicUrl(url: string) {
  const marker = "/storage/v1/object/public/template-media/";
  const index = url.indexOf(marker);
  if (index === -1) {
    return null;
  }

  return decodeURIComponent(url.slice(index + marker.length));
}

export function TemplateForm({ mode, templateId }: TemplateFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [existingMedia, setExistingMedia] = useState<MediaFile[]>([]);
  const [removedMediaUrls, setRemovedMediaUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(mode === "edit");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "edit" || !templateId) {
      return;
    }

    const load = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase
          .from("templates")
          .select("id, name, body, media_files, created_at")
          .eq("id", templateId)
          .single();

        if (error) {
          throw error;
        }

        const template = data as TemplateRecord;
        setName(template.name);
        setBody(template.body);
        setExistingMedia(template.media_files ?? []);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load template.");
      } finally {
        setInitialLoading(false);
      }
    };

    void load();
  }, [mode, templateId]);

  const activeExistingMedia = useMemo(
    () => existingMedia.filter((file) => !removedMediaUrls.includes(file.url)),
    [existingMedia, removedMediaUrls]
  );

  const toggleRemoveMedia = (url: string) => {
    setRemovedMediaUrls((current) =>
      current.includes(url) ? current.filter((value) => value !== url) : [...current, url]
    );
  };

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
      const selectedFiles = files ? Array.from(files) : [];

      const videoCount =
        activeExistingMedia.filter((file) => file.type.startsWith("video/")).length +
        selectedFiles.filter((file) => file.type.startsWith("video/")).length;
      if (videoCount > 1) {
        throw new Error("Keep at most one video per template.");
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

      const nextMedia = [...activeExistingMedia, ...uploadedMedia];
      const payload = { name, body, media_files: nextMedia };

      if (mode === "edit" && templateId) {
        const { error } = await supabase.from("templates").update(payload).eq("id", templateId);
        if (error) {
          throw error;
        }

        const removedPaths = removedMediaUrls
          .map((url) => getStoragePathFromPublicUrl(url))
          .filter((path): path is string => Boolean(path));

        if (removedPaths.length) {
          await supabase.storage.from("template-media").remove(removedPaths);
        }
      } else {
        const { error } = await supabase.from("templates").insert({
          user_id: user.id,
          ...payload
        });

        if (error) {
          throw error;
        }
      }

      router.push("/templates");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not ${mode} template.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid two">
      <section className="card">
        <span className="eyebrow">{mode === "edit" ? "Edit template" : "New template"}</span>
        <h1 className="page-title">{mode === "edit" ? "Update posting template" : "Create posting template"}</h1>
        <p className="page-copy">
          Template media is uploaded into the public <code>template-media</code> bucket so the extension can fetch it.
        </p>
      </section>

      <section className="card">
        {initialLoading ? (
          <div className="status-message">Loading template...</div>
        ) : (
          <form className="stack" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="name">Template name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="body">Post body</label>
              <textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} />
            </div>

            {existingMedia.length > 0 ? (
              <div className="field">
                <label>Existing media</label>
                <ul className="checkbox-list">
                  {existingMedia.map((file) => (
                    <li key={file.url} className="checkbox-item">
                      <input
                        id={`media-${file.url}`}
                        type="checkbox"
                        checked={!removedMediaUrls.includes(file.url)}
                        onChange={() => toggleRemoveMedia(file.url)}
                      />
                      <label htmlFor={`media-${file.url}`}>
                        <strong>{file.name}</strong>
                        <div className="table-subtle mono">{file.type || "unknown"}</div>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="help-text">Uncheck an item to remove it when saving.</p>
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="files">{mode === "edit" ? "Upload more media" : "Images or one short video"}</label>
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
                {loading ? "Saving..." : mode === "edit" ? "Save changes" : "Save template"}
              </button>
              <button className="secondary-button" type="button" onClick={() => router.push("/templates")}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
