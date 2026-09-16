-- FileHub V3 server-authorized admin RPCs. No service-role key reaches the browser.
create or replace function public.filehub_admin_has_permission(p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.admin_accounts aa
    left join public.admin_permissions ap on ap.admin_id=aa.id and ap.permission_key=p_permission and ap.enabled=true
    where aa.user_id=auth.uid() and aa.is_active=true and (aa.is_owner=true or ap.id is not null)
  );
$$;
revoke all on function public.filehub_admin_has_permission(text) from public;
grant execute on function public.filehub_admin_has_permission(text) to authenticated;

create or replace function public.filehub_admin_dashboard_data(p_section text default 'dashboard')
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;
begin
  if not public.filehub_admin_has_permission('view_activity_logs') then raise exception 'Not authorized'; end if;
  if p_section='dashboard' then
    select jsonb_build_object(
      'users',(select count(*) from profiles),
      'files',(select count(*) from files),
      'downloads',(select count(*) from file_downloads),
      'shares',(select count(*) from share_links),
      'admin_count',(select count(*) from admin_accounts where is_active),
      'storage_bytes',coalesce((select sum(size_bytes) from files where not is_trashed),0),
      'recent_activity',coalesce((select jsonb_agg(x) from (select id,action,entity_type,entity_id,metadata,created_at from activity_logs order by created_at desc limit 50)x),'[]'::jsonb),
      'admins',coalesce((select jsonb_agg(x) from (select id,email,display_name,is_active,is_owner,created_at from admin_accounts order by created_at)x),'[]'::jsonb)
    ) into r;
  elsif p_section='users' then
    if not public.filehub_admin_has_permission('manage_users') then raise exception 'Missing manage_users permission'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into r from (select id,full_name,email,avatar_url,role,is_blocked,storage_quota_bytes,created_at,updated_at from profiles order by created_at desc limit 500)x;
  elsif p_section='files' then
    if not public.filehub_admin_has_permission('manage_files') then raise exception 'Missing manage_files permission'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into r from (select f.id,f.owner_id,f.original_name,f.display_name,f.storage_path,f.mime_type,f.extension,f.size_bytes,f.visibility,f.is_favorite,f.is_trashed,f.deleted_at,f.file_code,f.created_at,f.updated_at,p.full_name as owner_name,p.email as owner_email from files f left join profiles p on p.id=f.owner_id order by f.updated_at desc limit 500)x;
  elsif p_section='shares' then
    if not public.filehub_admin_has_permission('manage_shares') then raise exception 'Missing manage_shares permission'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into r from (select s.id,s.file_id,s.owner_id,s.token,s.mode,s.expires_at,s.disabled,s.created_at,f.display_name,f.original_name,p.full_name as owner_name,p.email as owner_email from share_links s left join files f on f.id=s.file_id left join profiles p on p.id=s.owner_id order by s.created_at desc limit 500)x;
  elsif p_section='activity' then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into r from (select * from admin_activity_logs order by created_at desc limit 300)x;
  else raise exception 'Unknown section'; end if;
  return r;
end $$;
revoke all on function public.filehub_admin_dashboard_data(text) from public;
grant execute on function public.filehub_admin_dashboard_data(text) to authenticated;

create or replace function public.filehub_admin_action(p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare aid uuid; target uuid; patch jsonb; key text; enabled boolean; r jsonb;
begin
  select id into aid from admin_accounts where user_id=auth.uid() and is_active=true limit 1;
  if aid is null then raise exception 'Not authorized'; end if;
  if p_action='update_user' then
    if not public.filehub_admin_has_permission('manage_users') then raise exception 'Missing manage_users permission'; end if;
    target=(p_payload->>'user_id')::uuid; patch='{}'::jsonb;
    if p_payload ? 'full_name' then patch=patch||jsonb_build_object('full_name',left(trim(p_payload->>'full_name'),120)); end if;
    if p_payload ? 'is_blocked' then patch=patch||jsonb_build_object('is_blocked',(p_payload->>'is_blocked')::boolean); end if;
    if p_payload ? 'storage_quota_bytes' and public.filehub_admin_has_permission('manage_storage') then patch=patch||jsonb_build_object('storage_quota_bytes',greatest(0,(p_payload->>'storage_quota_bytes')::bigint)); end if;
    update profiles set full_name=coalesce(patch->>'full_name',full_name),is_blocked=coalesce((patch->>'is_blocked')::boolean,is_blocked),storage_quota_bytes=coalesce((patch->>'storage_quota_bytes')::bigint,storage_quota_bytes),updated_at=now() where id=target;
    insert into admin_activity_logs(admin_user_id,action,target_type,target_id,metadata) values(auth.uid(),'user_updated','user',target::text,patch);
    return jsonb_build_object('ok',true);
  elsif p_action='update_file' then
    if not public.filehub_admin_has_permission('manage_files') then raise exception 'Missing manage_files permission'; end if;
    target=(p_payload->>'file_id')::uuid;
    update files set display_name=case when p_payload ? 'display_name' and length(trim(p_payload->>'display_name'))>0 then left(trim(p_payload->>'display_name'),255) else display_name end,
      visibility=case when p_payload->>'visibility' in ('private','public') then p_payload->>'visibility' else visibility end,
      is_favorite=case when p_payload ? 'is_favorite' then (p_payload->>'is_favorite')::boolean else is_favorite end,
      is_trashed=case when p_payload ? 'is_trashed' then (p_payload->>'is_trashed')::boolean else is_trashed end,
      deleted_at=case when p_payload ? 'is_trashed' then case when (p_payload->>'is_trashed')::boolean then now() else null end else deleted_at end,
      updated_at=now() where id=target;
    insert into admin_activity_logs(admin_user_id,action,target_type,target_id,metadata) values(auth.uid(),'file_updated','file',target::text,p_payload);
    return jsonb_build_object('ok',true);
  elsif p_action='revoke_share' then
    if not public.filehub_admin_has_permission('manage_shares') then raise exception 'Missing manage_shares permission'; end if;
    target=(p_payload->>'share_id')::uuid; update share_links set disabled=true where id=target;
    insert into admin_activity_logs(admin_user_id,action,target_type,target_id,metadata) values(auth.uid(),'share_revoked','share',target::text,'{}'); return jsonb_build_object('ok',true);
  elsif p_action='set_permission' then
    if not public.filehub_admin_has_permission('manage_admins') then raise exception 'Missing manage_admins permission'; end if;
    target=(p_payload->>'admin_id')::uuid; key=p_payload->>'permission_key'; enabled=(p_payload->>'enabled')::boolean;
    if key not in ('manage_users','manage_files','view_private_files','delete_files','rename_files','upload_files','manage_storage','manage_shares','view_activity_logs','manage_admins') then raise exception 'Unknown permission'; end if;
    if exists(select 1 from admin_accounts where id=target and is_owner=true and enabled=false) then raise exception 'Owner permissions cannot be disabled'; end if;
    insert into admin_permissions(admin_id,permission_key,enabled) values(target,key,enabled) on conflict (admin_id,permission_key) do update set enabled=excluded.enabled;
    insert into admin_activity_logs(admin_user_id,action,target_type,target_id,metadata) values(auth.uid(),'permission_changed','admin',target::text,jsonb_build_object('permission_key',key,'enabled',enabled)); return jsonb_build_object('ok',true);
  elsif p_action='toggle_admin' then
    if not public.filehub_admin_has_permission('manage_admins') then raise exception 'Missing manage_admins permission'; end if;
    target=(p_payload->>'admin_id')::uuid; if exists(select 1 from admin_accounts where id=target and is_owner=true) then raise exception 'Owner cannot be deactivated'; end if;
    update admin_accounts set is_active=(p_payload->>'is_active')::boolean,updated_at=now() where id=target;
    insert into admin_activity_logs(admin_user_id,action,target_type,target_id,metadata) values(auth.uid(),'admin_status_changed','admin',target::text,p_payload); return jsonb_build_object('ok',true);
  elsif p_action='add_admin' then
    if not public.filehub_admin_has_permission('manage_admins') then raise exception 'Missing manage_admins permission'; end if;
    -- Only users who already have a FileHub Auth account can be promoted; the frontend never handles service-role credentials.
    select id into target from auth.users where lower(email)=lower(p_payload->>'email') limit 1; if target is null then raise exception 'User must create a normal FileHub account first'; end if;
    if exists(select 1 from admin_accounts where user_id=target) then raise exception 'Already an admin'; end if;
    insert into admin_accounts(user_id,email,display_name,is_active,is_owner,created_by) values(target,lower(p_payload->>'email'),coalesce(nullif(trim(p_payload->>'display_name'),''),(select coalesce(raw_user_meta_data->>'full_name',email) from auth.users where id=target)),true,false,auth.uid()) returning id into aid;
    insert into admin_permissions(admin_id,permission_key,enabled) select aid,x,false from unnest(array['manage_users','manage_files','view_private_files','delete_files','rename_files','upload_files','manage_storage','manage_shares','view_activity_logs','manage_admins'])x;
    insert into admin_activity_logs(admin_user_id,action,target_type,target_id,metadata) values(auth.uid(),'admin_added','admin',aid::text,jsonb_build_object('email',lower(p_payload->>'email'))); return jsonb_build_object('ok',true);
  else raise exception 'Unknown action'; end if;
end $$;
revoke all on function public.filehub_admin_action(text,jsonb) from public;
grant execute on function public.filehub_admin_action(text,jsonb) to authenticated;
