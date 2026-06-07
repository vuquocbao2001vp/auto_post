"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { GroupRecord, MediaFile, TemplateRecord } from "@/lib/types";
import {
  computeNextDailyRun,
  getCurrentDatetimeLocalValue,
  getCurrentTimeValue,
  getDefaultTimezone
} from "@/lib/utils";

type ScheduleFormProps = {
  mode: "create" | "edit";
  scheduleId?: string;
};

type ScheduleDetails = {
  id: string;
  template_id: string | null;
  template_name_snapshot: string;
  body_snapshot: string;
  media_files_snapshot: MediaFile[];
  schedule_type: "one_time" | "daily";
  run_at: string | null;
  time_of_day: string | null;
  timezone: string;
  catch_up_minutes: number;
  schedule_groups: Array<{ group_id: string }>;
};

function toDatetimeLocal(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toTimeInput(value?: string | null) {
  if (!value) {
    return "09:00";
  }

  return value.slice(0, 5);
}

export function ScheduleForm({ mode, scheduleId }: ScheduleFormProps) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [scheduleType, setScheduleType] = useState<"one_time" | "daily">("one_time");
  const [runAt, setRunAt] = useState(getCurrentDatetimeLocalValue());
  const [timeOfDay, setTimeOfDay] = useState(getCurrentTimeValue());
  const [timezone, setTimezone] = useState(getDefaultTimezone());
  const [catchUpMinutes, setCatchUpMinutes] = useState(30);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const baseRequests = [
          supabase
            .from("templates")
            .select("id, name, body, media_files, created_at")
            .order("created_at", { ascending: false }),
          supabase
            .from("groups")
            .select("id, url, label, status, created_at")
            .eq("status", "active")
            .order("created_at", { ascending: false })
        ] as const;

        const [templateRes, groupRes, scheduleRes] = await Promise.all([
          ...baseRequests,
          mode === "edit" && scheduleId
            ? supabase
                .from("schedules")
                .select(
                  "id, template_id, template_name_snapshot, body_snapshot, media_files_snapshot, schedule_type, run_at, time_of_day, timezone, catch_up_minutes, schedule_groups(group_id)"
                )
                .eq("id", scheduleId)
                .single()
            : Promise.resolve({ data: null, error: null })
        ]);

        if (templateRes.error) {
          throw templateRes.error;
        }

        if (groupRes.error) {
          throw groupRes.error;
        }

        const nextTemplates = (templateRes.data ?? []) as TemplateRecord[];
        const nextGroups = (groupRes.data ?? []) as GroupRecord[];
        const existingSchedule = scheduleRes.data as ScheduleDetails | null;

        setTemplates(nextTemplates);
        setGroups(nextGroups);

        if (mode === "edit" && existingSchedule) {
          setTemplateId(existingSchedule.template_id ?? nextTemplates[0]?.id ?? "");
          setSelectedGroupIds(existingSchedule.schedule_groups.map((item) => item.group_id));
          setScheduleType(existingSchedule.schedule_type);
          setRunAt(toDatetimeLocal(existingSchedule.run_at));
          setTimeOfDay(toTimeInput(existingSchedule.time_of_day));
          setTimezone(existingSchedule.timezone);
          setCatchUpMinutes(existingSchedule.catch_up_minutes);
        } else if (nextTemplates[0]) {
          setTemplateId(nextTemplates[0].id);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load schedule form.");
      } finally {
        setInitialLoading(false);
      }
    };

    void load();
  }, [mode, scheduleId]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templateId, templates]
  );

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((current) =>
      current.includes(groupId) ? current.filter((value) => value !== groupId) : [...current, groupId]
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

      if (!selectedTemplate) {
        throw new Error("Select a template first.");
      }

      if (!selectedGroupIds.length) {
        throw new Error("Select at least one group.");
      }

      const nextRunAt =
        scheduleType === "one_time"
          ? new Date(runAt).toISOString()
          : computeNextDailyRun(timeOfDay);

      if (!nextRunAt || Number.isNaN(new Date(nextRunAt).getTime())) {
        throw new Error("Choose a valid schedule time.");
      }

      const schedulePayload = {
        template_id: selectedTemplate.id,
        template_name_snapshot: selectedTemplate.name,
        body_snapshot: selectedTemplate.body,
        media_files_snapshot: selectedTemplate.media_files,
        schedule_type: scheduleType,
        run_at: scheduleType === "one_time" ? new Date(runAt).toISOString() : null,
        time_of_day: scheduleType === "daily" ? `${timeOfDay}:00` : null,
        timezone,
        status: "active",
        next_run_at: nextRunAt,
        catch_up_minutes: catchUpMinutes
      };

      let activeScheduleId = scheduleId;

      if (mode === "edit" && scheduleId) {
        const { error: updateError } = await supabase.from("schedules").update(schedulePayload).eq("id", scheduleId);
        if (updateError) {
          throw updateError;
        }

        const { error: deleteLinksError } = await supabase.from("schedule_groups").delete().eq("schedule_id", scheduleId);
        if (deleteLinksError) {
          throw deleteLinksError;
        }
      } else {
        const { data: insertedSchedule, error: insertError } = await supabase
          .from("schedules")
          .insert({
            user_id: user.id,
            ...schedulePayload
          })
          .select("id")
          .single();

        if (insertError) {
          throw insertError;
        }

        activeScheduleId = insertedSchedule.id;
      }

      if (!activeScheduleId) {
        throw new Error("Schedule ID missing.");
      }

      const groupRows = selectedGroupIds.map((groupId, index) => ({
        schedule_id: activeScheduleId,
        group_id: groupId,
        position: index
      }));

      const { error: linkError } = await supabase.from("schedule_groups").insert(groupRows);
      if (linkError) {
        throw linkError;
      }

      router.push("/schedules");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not ${mode} schedule.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid two">
      <section className="card stack">
        <div>
          <span className="eyebrow">{mode === "edit" ? "Edit schedule" : "New schedule"}</span>
          <h1 className="page-title">{mode === "edit" ? "Update posting job" : "Create a posting job"}</h1>
          <p className="page-copy">
            {mode === "edit"
              ? "Edit the schedule, target groups, or snapshot source template."
              : "For daily schedules, the next run is computed in the browser timezone at creation time and then moved one day forward each time the extension claims it."}
          </p>
        </div>

        {selectedTemplate ? (
          <div className="status-message">
            <strong>{selectedTemplate.name}</strong>
            <div className="table-subtle">{selectedTemplate.body.slice(0, 120) || "No text"}</div>
          </div>
        ) : null}
      </section>

      <section className="card">
        {initialLoading ? (
          <div className="status-message">Loading schedule form...</div>
        ) : (
          <form className="stack" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="templateId">Template</label>
              <select id="templateId" value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
                {templates.length === 0 ? <option value="">No templates available</option> : null}
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="scheduleType">Schedule type</label>
              <select
                id="scheduleType"
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value as "one_time" | "daily")}
              >
                <option value="one_time">One time</option>
                <option value="daily">Daily</option>
              </select>
            </div>

            {scheduleType === "one_time" ? (
              <div className="field">
                <label htmlFor="runAt">Run at</label>
                <input id="runAt" type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} required />
              </div>
            ) : (
              <div className="field">
                <label htmlFor="timeOfDay">Daily time</label>
                <input id="timeOfDay" type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} required />
              </div>
            )}

            <div className="field">
              <label htmlFor="timezone">Timezone</label>
              <input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="catchUpMinutes">Catch-up window in minutes</label>
              <input
                id="catchUpMinutes"
                type="number"
                min={1}
                value={catchUpMinutes}
                onChange={(e) => setCatchUpMinutes(Number(e.target.value))}
                required
              />
            </div>

            <div className="field">
              <label>Target groups</label>
              {groups.length === 0 ? (
                <div className="status-message">Add active groups before creating schedules.</div>
              ) : (
                <ul className="checkbox-list">
                  {groups.map((group) => (
                    <li key={group.id} className="checkbox-item">
                      <input
                        id={`group-${group.id}`}
                        type="checkbox"
                        checked={selectedGroupIds.includes(group.id)}
                        onChange={() => toggleGroup(group.id)}
                      />
                      <label htmlFor={`group-${group.id}`}>
                        <strong>{group.label || "Untitled group"}</strong>
                        <div className="table-subtle mono">{group.url}</div>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {message ? <div className="status-message status-error">{message}</div> : null}

            <div className="form-actions">
              <button className="primary-button" disabled={loading} type="submit">
                {loading ? "Saving..." : mode === "edit" ? "Save changes" : "Create schedule"}
              </button>
              <button className="secondary-button" type="button" onClick={() => router.push("/schedules")}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
