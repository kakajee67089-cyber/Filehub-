# Final deployment checklist

- [x] Mobile-first FileHub UI from the supplied spec.
- [x] Exactly 3 bottom navigation items: Your Files, Home, Profile.
- [x] Search by filename and 4-digit file code.
- [x] Guest mode blocks private uploads and supports account conversion.
- [x] Supabase Auth session handling.
- [x] Supabase Storage upload to random user-scoped paths.
- [x] File metadata in PostgreSQL.
- [x] File preview for images/PDF/video/audio.
- [x] Download audit RPC and activity logging.
- [x] Secure server-side share token generation.
- [x] Share link view/download mode with expiry and revoke.
- [x] QR generation and browser camera scan where supported.
- [x] Notifications + database-backed clear timestamp.
- [x] Profile name/photo/settings/security views.
- [x] Activity, shared links and trash/restore screens.
- [x] Private primary storage bucket; public avatar bucket.
- [x] Publishable/anon key only in frontend.
- [x] Supabase Edge Functions use server-side secrets.
- [x] Supabase production schema/function updates applied to project `gttdnziyfbpbzkizsczc`.

After Vercel deploy, open `FileHub_Testing_Suite.html` and run the smoke tests. Then create a test account in the main FileHub site and verify one real upload, one preview, one download and one share-link flow.
