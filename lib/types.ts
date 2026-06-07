export type MediaFile = {
  name: string;
  size: number;
  type: string;
  url: string;
};

export type TemplateRecord = {
  id: string;
  name: string;
  body: string;
  media_files: MediaFile[];
  created_at: string;
};

export type GroupRecord = {
  id: string;
  url: string;
  label: string | null;
  status: "active" | "invalid";
  created_at: string;
};

export type ScheduleRecord = {
  id: string;
  template_id: string | null;
  template_name_snapshot: string;
  body_snapshot: string;
  media_files_snapshot: MediaFile[];
  schedule_type: "one_time" | "daily";
  run_at: string | null;
  time_of_day: string | null;
  timezone: string;
  status: "active" | "running" | "completed" | "paused" | "missed";
  last_run_at: string | null;
  next_run_at: string;
  catch_up_minutes: number;
  created_at: string;
};

export type ExecutionLogRecord = {
  id: string;
  created_at: string;
  group_url: string;
  status:
    | "success"
    | "pending_approval"
    | "login_required"
    | "checkpoint"
    | "group_unavailable"
    | "upload_failed"
    | "ui_not_found"
    | "unknown_error";
  step: "open_group" | "open_composer" | "fill_text" | "upload_media" | "submit_post";
  message: string;
  job_run_id: string;
  schedule_id: string;
};
