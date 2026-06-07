"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ScheduleRecord } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

type ScheduleRow = ScheduleRecord & {
  schedule_groups?: Array<{ group_id: string }>;
};

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: requestError } = await supabase
          .from("schedules")
          .select("id, template_id, template_name_snapshot, body_snapshot, media_files_snapshot, schedule_type, run_at, time_of_day, timezone, status, last_run_at, next_run_at, catch_up_minutes, created_at, schedule_groups(group_id)")
          .order("created_at", { ascending: false });

        if (requestError) {
          throw requestError;
        }

        setSchedules((data ?? []) as ScheduleRow[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load schedules.");
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
          <span className="eyebrow">Schedules</span>
          <h1 className="page-title">Posting schedules</h1>
          <p className="page-copy">Each schedule stores a snapshot of template text and media so future edits do not change old runs.</p>
        </div>
        <Link href="/schedules/new" className="primary-button">
          Create schedule
        </Link>
      </header>

      <section className="card">
        {error ? <div className="status-message status-error">{error}</div> : null}
        {loading ? (
          <div className="status-message">Loading schedules...</div>
        ) : schedules.length === 0 ? (
          <div className="status-message">No schedules created yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Template snapshot</th>
                  <th>Type</th>
                  <th>Next run</th>
                  <th>Groups</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule.id}>
                    <td>
                      <strong>{schedule.template_name_snapshot}</strong>
                      <div className="table-subtle">{schedule.body_snapshot.slice(0, 110) || "No text"}</div>
                    </td>
                    <td>{schedule.schedule_type}</td>
                    <td>{formatDateTime(schedule.next_run_at)}</td>
                    <td>{schedule.schedule_groups?.length ?? 0}</td>
                    <td>
                      <span className="badge">{schedule.status}</span>
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
