# FileHub V3 — Complete Production

Production-oriented mobile-first FileHub frontend for Vercel with Supabase Auth, PostgreSQL, private Storage, secure share links, QR, previews, activity, trash/restore and a server-authorized Admin Control Center.

## Connected Supabase project
- Project ref: `gttdnziyfbpbzkizsczc`
- Region: `ap-south-1`
- URL: `https://gttdnziyfbpbzkizsczc.supabase.co`
- File bucket: `filehub-files` (private)
- Avatar bucket: `filehub-avatars`
- Browser uses only the publishable/anon key. Service-role secrets stay server-side in Supabase.

## Vercel / GitHub deployment
This archive is packaged with the Vite project at the repository root. After extracting and pushing its contents to GitHub, import that repository into Vercel.
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- No Root Directory change is required when the repository contains the extracted project files at its root.

Environment variables are optional because the public Supabase configuration is included, but preferred:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Never add `SUPABASE_SERVICE_ROLE_KEY` to Vercel/frontend environment variables.

## Supabase backend
The connected production project has active Edge Functions for secure share creation/opening/public files and the admin dashboard endpoint. The V3 admin control UI uses server-authorized Supabase RPCs for management actions, so admin operations do not depend on a browser service-role key.

Migrations included:
- `20260916_filehub_production_hardening.sql`
- `20260916_filehub_v3_admin_management.sql`

The V3 migration adds:
- `filehub_admin_has_permission`
- `filehub_admin_dashboard_data`
- `filehub_admin_action`

Admin capabilities in the UI include:
- Overview/statistics
- User list, name/quota editing, block/unblock
- File list, rename/visibility editing, trash/restore
- Share-link list and revoke
- Admin audit log
- Add existing FileHub users as admins
- Activate/deactivate non-owner admins
- Fine-grained admin permissions

## Data flow
Vercel hosts the frontend only. User data remains in Supabase:
- Auth users → Supabase Auth
- File bytes → private `filehub-files` Storage
- File metadata → `public.files`
- Profiles → `public.profiles`
- Downloads → `public.file_downloads`
- Shares → `public.share_links`
- Activity → `public.activity_logs`
- Admin registry/permissions/audit → `admin_accounts`, `admin_permissions`, `admin_activity_logs`

## Security
Private files are accessed through authenticated Storage policies/signed URLs. Admin authorization is checked using the authenticated Supabase identity plus server-side admin permissions. The 4-digit file code is only a search identifier. Do not expose service-role secrets in public code.

## Local build
```bash
npm install
npm run build
```

## Testing
`FileHub_Testing_Suite_v3.html` checks public configuration, PostgREST reachability, RPCs, Storage buckets, active Edge Functions, QR support and camera capability without creating production data.

A final browser smoke test should still be performed after Vercel deployment: create account → upload → preview → download → share → QR → trash/restore → admin login → user/file/share management.
