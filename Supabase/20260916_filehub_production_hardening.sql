-- FileHub production hardening / frontend support.
-- Existing core tables, RLS and storage bucket are preserved.

alter table public.profiles
  add column if not exists notification_cleared_at timestamptz not null default '1970-01-01T00:00:00Z';

create index if not exists idx_files_owner_name on public.files(owner_id, lower(display_name));
create index if not exists idx_files_owner_original_name on public.files(owner_id, lower(original_name));
create index if not exists idx_files_visibility on public.files(visibility) where is_trashed = false;
create index if not exists idx_share_links_token_active on public.share_links(token) where disabled = false;

create or replace function public.filehub_search_files(p_query text, p_limit integer default 50)
returns setof public.files
language sql
stable
security invoker
set search_path = public
as $$
  select f.* from public.files f
  where f.owner_id = auth.uid()
    and not f.is_trashed
    and (
      nullif(trim(p_query),'') is null
      or lower(f.display_name) like '%' || lower(trim(p_query)) || '%'
      or lower(f.original_name) like '%' || lower(trim(p_query)) || '%'
      or f.file_code = regexp_replace(trim(p_query),'[^0-9]','','g')
    )
  order by f.updated_at desc
  limit greatest(1, least(coalesce(p_limit,50),100));
$$;

drop function if exists public.filehub_search_public_files(text, integer);
create or replace function public.filehub_search_public_files(p_query text, p_limit integer default 50)
returns setof public.files
language sql
stable
security definer
set search_path = public
as $$
  select f.* from public.files f
  where f.visibility = 'public'
    and not f.is_trashed
    and (
      nullif(trim(p_query),'') is null
      or lower(f.display_name) like '%' || lower(trim(p_query)) || '%'
      or lower(f.original_name) like '%' || lower(trim(p_query)) || '%'
      or f.file_code = regexp_replace(trim(p_query),'[^0-9]','','g')
    )
  order by f.updated_at desc
  limit greatest(1, least(coalesce(p_limit,50),100));
$$;
revoke all on function public.filehub_search_public_files(text, integer) from public;
grant execute on function public.filehub_search_public_files(text, integer) to anon, authenticated;

create or replace function public.filehub_record_download(p_file_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.files;
begin
  select * into f from public.files where id = p_file_id and not is_trashed;
  if not found then raise exception 'File not found'; end if;
  if auth.uid() is not null and (f.owner_id = auth.uid() or f.visibility = 'public') then
    insert into public.file_downloads(file_id,user_id,user_agent)
    values(f.id,auth.uid(),coalesce(current_setting('request.headers',true)::json->>'user-agent',''));
    insert into public.activity_logs(actor_id,action,entity_type,entity_id,metadata)
    values(auth.uid(),'file_downloaded','file',f.id,jsonb_build_object('name',f.display_name,'source','authenticated'));
    return true;
  end if;
  raise exception 'Not authorized to record this download';
end;
$$;
revoke all on function public.filehub_record_download(uuid) from public;
grant execute on function public.filehub_record_download(uuid) to authenticated;

create or replace function public.filehub_clear_notifications()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.profiles set notification_cleared_at = now(), updated_at = now() where id = auth.uid();
  return found;
end;
$$;
revoke all on function public.filehub_clear_notifications() from public;
grant execute on function public.filehub_clear_notifications() to authenticated;

-- Public avatar bucket. The primary file bucket remains private.
insert into storage.buckets (id,name,public,file_size_limit)
values ('filehub-avatars','filehub-avatars',true,5242880)
on conflict (id) do nothing;

drop policy if exists "filehub avatars public read" on storage.objects;
create policy "filehub avatars public read" on storage.objects
for select to public
using (bucket_id = 'filehub-avatars');

drop policy if exists "filehub avatars authenticated insert" on storage.objects;
create policy "filehub avatars authenticated insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'filehub-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "filehub avatars owner update" on storage.objects;
create policy "filehub avatars owner update" on storage.objects
for update to authenticated
using (bucket_id = 'filehub-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text))
with check (bucket_id = 'filehub-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "filehub avatars owner delete" on storage.objects;
create policy "filehub avatars owner delete" on storage.objects
for delete to authenticated
using (bucket_id = 'filehub-avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
