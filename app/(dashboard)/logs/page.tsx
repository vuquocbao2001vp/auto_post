"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ExecutionLogRecord } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export default function LogsPage() {
  const [logs, setLogs] = useState<ExecutionLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: requestError } = await supabase
          .from("execution_logs")
          .select("id, created_at, group_url, status, step, message, job_run_id, schedule_id")
          .order("created_at", { ascending: false })
          .limit(100);

        if (requestError) {
          throw requestError;
        }

        setLogs((data ?? []) as ExecutionLogRecord[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load logs.");
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
          <span className="eyebrow">Logs</span>
          <h1 className="page-title">Execution logs</h1>
          <p className="page-copy">Simple operator view: what job failed, at which step, and the raw message returned by the extension.</p>
        </div>
      </header>

      <section className="card">
        {error ? <div className="status-message status-error">{error}</div> : null}
        {loading ? (
          <div className="status-message">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="status-message">No logs yet. Once the extension runs, failures and successes appear here.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Group</th>
                  <th>Status</th>
                  <th>Step</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.created_at)}</td>
                    <td className="mono">{log.group_url}</td>
                    <td>
                      <span className="badge">{log.status}</span>
                    </td>
                    <td>{log.step}</td>
                    <td>{log.message}</td>
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
