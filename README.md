# Auto Post MVP

Minimal MVP for scheduling Facebook group posts with:

- `Next.js` dashboard
- `Supabase` Auth, Postgres, Storage
- `Chrome extension` that polls due schedules and posts using the Facebook session already logged into Chrome

## What is included

- Sign up / sign in page
- Templates page and template creation with media upload
- Groups page and bulk group URL import
- Schedules page and schedule creation
- Logs page for simple operator visibility
- Supabase SQL schema with RLS and RPC functions
- Unpacked Chrome extension with Supabase login and polling

## Local setup

1. Create a Supabase project.
2. In Supabase SQL editor, run [`supabase/schema.sql`](./supabase/schema.sql).
3. Copy `.env.example` to `.env.local`.
4. Fill:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Install dependencies:

```bash
npm install
```

6. Start the app:

```bash
npm run dev
```

7. Open `http://localhost:3000`.

## Chrome extension setup

Follow [`extension/README.md`](./extension/README.md).

The popup needs:

- Supabase URL
- Supabase anon key
- Same email/password as the dashboard

## Supabase notes

- This MVP creates a public bucket named `template-media`.
- Media URLs are stored directly in templates and schedule snapshots.
- The extension fetches those public URLs and reconstructs `File` objects in the browser before uploading to Facebook.

## Deployment

### Web app

- `Vercel` or `Cloudflare Pages`

### Database and storage

- `Supabase`

### Extension

- Start with `Load unpacked`
- Later publish to Chrome Web Store if needed

## Known limitations

- Facebook UI selectors can change and break posting.
- If Chrome is closed or offline at the scheduled time, jobs can be missed.
- The extension uses broad host permissions because the Supabase project URL is configured by the user at runtime.
- This repo does not include unit tests by design for this MVP scope.
