create extension if not exists pgcrypto;

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  body text not null default '',
  media_files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  label text,
  status text not null default 'active' check (status in ('active', 'invalid')),
  created_at timestamptz not null default now()
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid references public.templates (id) on delete set null,
  template_name_snapshot text not null,
  body_snapshot text not null default '',
  media_files_snapshot jsonb not null default '[]'::jsonb,
  schedule_type text not null check (schedule_type in ('one_time', 'daily')),
  run_at timestamptz,
  time_of_day time,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  status text not null default 'active' check (status in ('active', 'running', 'completed', 'paused', 'missed')),
  last_run_at timestamptz,
  next_run_at timestamptz not null,
  catch_up_minutes integer not null default 30,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_groups (
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  position integer not null default 0,
  primary key (schedule_id, group_id)
);

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  browser_id text,
  status text not null default 'running' check (status in ('running', 'success', 'partial_error', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text
);

create table if not exists public.execution_logs (
  id uuid primary key default gen_random_uuid(),
  job_run_id uuid not null references public.job_runs (id) on delete cascade,
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  group_url text not null,
  status text not null check (
    status in (
      'success',
      'pending_approval',
      'login_required',
      'checkpoint',
      'group_unavailable',
      'upload_failed',
      'ui_not_found',
      'unknown_error'
    )
  ),
  step text not null check (
    step in ('open_group', 'open_composer', 'fill_text', 'upload_media', 'submit_post')
  ),
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_templates_user_id on public.templates (user_id);
create index if not exists idx_groups_user_id on public.groups (user_id);
create index if not exists idx_schedules_user_id_next_run_at on public.schedules (user_id, next_run_at);
create index if not exists idx_job_runs_user_id_started_at on public.job_runs (user_id, started_at desc);
create index if not exists idx_execution_logs_user_id_created_at on public.execution_logs (user_id, created_at desc);

alter table public.templates enable row level security;
alter table public.groups enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_groups enable row level security;
alter table public.job_runs enable row level security;
alter table public.execution_logs enable row level security;

drop policy if exists "templates owner access" on public.templates;
create policy "templates owner access" on public.templates
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "groups owner access" on public.groups;
create policy "groups owner access" on public.groups
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "schedules owner access" on public.schedules;
create policy "schedules owner access" on public.schedules
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "schedule_groups owner access" on public.schedule_groups;
create policy "schedule_groups owner access" on public.schedule_groups
for all using (
  exists (
    select 1
    from public.schedules s
    where s.id = schedule_groups.schedule_id
      and s.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.schedules s
    where s.id = schedule_groups.schedule_id
      and s.user_id = auth.uid()
  )
);

drop policy if exists "job_runs owner access" on public.job_runs;
create policy "job_runs owner access" on public.job_runs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "execution_logs owner access" on public.execution_logs;
create policy "execution_logs owner access" on public.execution_logs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('template-media', 'template-media', true)
on conflict (id) do nothing;

drop policy if exists "public media read" on storage.objects;
create policy "public media read" on storage.objects
for select using (bucket_id = 'template-media');

drop policy if exists "authenticated media upload" on storage.objects;
create policy "authenticated media upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'template-media'
  and position(auth.uid()::text || '/' in name) = 1
);

drop policy if exists "owners update media" on storage.objects;
create policy "owners update media" on storage.objects
for update to authenticated
using (
  bucket_id = 'template-media'
  and position(auth.uid()::text || '/' in name) = 1
)
with check (
  bucket_id = 'template-media'
  and position(auth.uid()::text || '/' in name) = 1
);

drop policy if exists "owners delete media" on storage.objects;
create policy "owners delete media" on storage.objects
for delete to authenticated
using (
  bucket_id = 'template-media'
  and position(auth.uid()::text || '/' in name) = 1
);

create or replace function public.claim_due_schedule(p_browser_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  due_schedule public.schedules%rowtype;
  created_run public.job_runs%rowtype;
  payload jsonb;
begin
  select *
  into due_schedule
  from public.schedules s
  where s.user_id = auth.uid()
    and s.status = 'active'
    and s.next_run_at <= now()
    and s.next_run_at >= now() - make_interval(mins => s.catch_up_minutes)
  order by s.next_run_at asc
  limit 1
  for update skip locked;

  if due_schedule.id is null then
    update public.schedules
    set status = 'missed'
    where user_id = auth.uid()
      and status = 'active'
      and next_run_at < now() - make_interval(mins => catch_up_minutes);

    return null;
  end if;

  update public.schedules
  set status = 'running',
      next_run_at = case
        when due_schedule.schedule_type = 'daily' then due_schedule.next_run_at + interval '1 day'
        else due_schedule.next_run_at
      end
  where id = due_schedule.id;

  insert into public.job_runs (schedule_id, user_id, browser_id)
  values (due_schedule.id, auth.uid(), p_browser_id)
  returning * into created_run;

  select jsonb_build_object(
    'job_run_id', created_run.id,
    'schedule_id', due_schedule.id,
    'schedule_type', due_schedule.schedule_type,
    'template_name', due_schedule.template_name_snapshot,
    'body', due_schedule.body_snapshot,
    'media_files', due_schedule.media_files_snapshot,
    'next_run_at', due_schedule.next_run_at,
    'groups', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', g.id,
            'url', g.url,
            'label', g.label,
            'status', g.status
          )
          order by sg.position asc, g.created_at asc
        )
        from public.schedule_groups sg
        join public.groups g on g.id = sg.group_id
        where sg.schedule_id = due_schedule.id
      ),
      '[]'::jsonb
    )
  )
  into payload;

  return payload;
end;
$$;

grant execute on function public.claim_due_schedule(text) to authenticated;

create or replace function public.complete_job_run(
  p_job_run_id uuid,
  p_status text,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  related_schedule public.schedules%rowtype;
begin
  update public.job_runs
  set status = p_status,
      error_message = p_error_message,
      finished_at = now()
  where id = p_job_run_id
    and user_id = auth.uid();

  select s.*
  into related_schedule
  from public.schedules s
  join public.job_runs jr on jr.schedule_id = s.id
  where jr.id = p_job_run_id
    and jr.user_id = auth.uid();

  if related_schedule.id is null then
    return;
  end if;

  update public.schedules
  set status = case
      when related_schedule.schedule_type = 'one_time' then 'completed'
      else 'active'
    end,
    last_run_at = now()
  where id = related_schedule.id;
end;
$$;

grant execute on function public.complete_job_run(uuid, text, text) to authenticated;
