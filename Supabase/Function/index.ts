import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const ALL_PERMS=['manage_users','manage_files','view_private_files','delete_files','rename_files','upload_files','manage_storage','manage_shares','view_activity_logs','manage_admins'];

async function authz(req:Request){
  const auth=req.headers.get('Authorization'); if(!auth) return {error:json({error:'Authentication required'},401)};
  const url=Deno.env.get('SUPABASE_URL')!;
  const publishable=Deno.env.get('SUPABASE_ANON_KEY') || JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default;
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
  const userClient=createClient(url,publishable,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await userClient.auth.getUser(); if(!user) return {error:json({error:'Invalid session'},401)};
  const admin=createClient(url,service);
  const {data:account}=await admin.from('admin_accounts').select('*').eq('user_id',user.id).eq('is_active',true).maybeSingle();
  if(!account) return {error:json({error:'Not authorized for admin'},403)};
  const {data:perms}=await admin.from('admin_permissions').select('permission_key,enabled').eq('admin_id',account.id).eq('enabled',true);
  return {user,account,admin,permissions:new Set((perms||[]).map((p:any)=>p.permission_key))};
}
function need(ctx:any,p:string){return ctx.permissions.has(p)||ctx.account.is_owner;}
async function audit(ctx:any,action:string,target_type:string,target_id:string|null,metadata:any={}){await ctx.admin.from('admin_activity_logs').insert({admin_user_id:ctx.user.id,action,target_type,target_id,metadata});await ctx.admin.from('activity_logs').insert({actor_id:ctx.user.id,action:`admin_${action}`,entity_type:target_type,entity_id:(target_id&&/^[0-9a-f-]{36}$/i.test(target_id))?target_id:null,metadata});}

async function dashboard(ctx:any){
  const a=ctx.admin;
  const [{count:users},{count:files},{count:downloads},{count:shares},{count:adminCount}]=await Promise.all([
    a.from('profiles').select('id',{count:'exact',head:true}),a.from('files').select('id',{count:'exact',head:true}),a.from('file_downloads').select('id',{count:'exact',head:true}),a.from('share_links').select('id',{count:'exact',head:true}),a.from('admin_accounts').select('id',{count:'exact',head:true}).eq('is_active',true)
  ]);
  const {data:rows}=await a.from('files').select('size_bytes').eq('is_trashed',false).limit(20000);
  const storage_bytes=(rows||[]).reduce((n:number,r:any)=>n+Number(r.size_bytes||0),0);
  const {data:recent}=await a.from('activity_logs').select('id,action,entity_type,entity_id,metadata,created_at').order('created_at',{ascending:false}).limit(50);
  const {data:admins}=await a.from('admin_accounts').select('id,email,display_name,is_active,is_owner,created_at').order('created_at',{ascending:true});
  return {users:users||0,files:files||0,downloads:downloads||0,shares:shares||0,admin_count:adminCount||0,storage_bytes,recent_activity:recent||[],admins:admins||[],permissions:[...ctx.permissions]};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  const ctx=await authz(req); if(ctx.error) return ctx.error;
  if(!need(ctx,'view_activity_logs')) return json({error:'Missing view_activity_logs permission'},403);
  try{
    if(req.method==='GET'){
      const url=new URL(req.url); const section=url.searchParams.get('section')||'dashboard';
      if(section==='dashboard') return json({dashboard:await dashboard(ctx)});
      if(section==='users'){
        if(!need(ctx,'manage_users')) return json({error:'Missing manage_users permission'},403);
        const {data}=await ctx.admin.from('profiles').select('id,full_name,email,avatar_url,role,is_blocked,storage_quota_bytes,created_at,updated_at').order('created_at',{ascending:false}).limit(500);
        return json({users:data||[]});
      }
      if(section==='files'){
        if(!need(ctx,'manage_files')) return json({error:'Missing manage_files permission'},403);
        const {data}=await ctx.admin.from('files').select('id,owner_id,original_name,display_name,storage_path,mime_type,extension,size_bytes,visibility,is_favorite,is_trashed,deleted_at,file_code,created_at,updated_at,profiles:owner_id(full_name,email)').order('updated_at',{ascending:false}).limit(500);
        return json({files:data||[]});
      }
      if(section==='shares'){
        if(!need(ctx,'manage_shares')) return json({error:'Missing manage_shares permission'},403);
        const {data}=await ctx.admin.from('share_links').select('id,file_id,owner_id,token,mode,expires_at,disabled,created_at,files:files(display_name,original_name),profiles:owner_id(full_name,email)').order('created_at',{ascending:false}).limit(500);
        return json({shares:data||[]});
      }
      if(section==='activity'){
        if(!need(ctx,'view_activity_logs')) return json({error:'Missing view_activity_logs permission'},403);
        const {data}=await ctx.admin.from('admin_activity_logs').select('*').order('created_at',{ascending:false}).limit(300);
        return json({activity:data||[]});
      }
      return json({error:'Unknown section'},400);
    }
    if(req.method==='POST'){
      const body=await req.json(); const action=String(body.action||'');
      if(action==='update_user'){
        if(!need(ctx,'manage_users')) return json({error:'Missing manage_users permission'},403);
        const id=String(body.user_id); const patch:any={};
        if(typeof body.full_name==='string') patch.full_name=body.full_name.trim().slice(0,120);
        if(typeof body.is_blocked==='boolean') patch.is_blocked=body.is_blocked;
        if(Number.isFinite(Number(body.storage_quota_bytes)) && need(ctx,'manage_storage')) patch.storage_quota_bytes=Math.max(0,Math.floor(Number(body.storage_quota_bytes)));
        if(!Object.keys(patch).length) return json({error:'No editable fields supplied'},400);
        const {error}=await ctx.admin.from('profiles').update(patch).eq('id',id); if(error) return json({error:error.message},400); await audit(ctx,'user_updated','user',id,patch); return json({ok:true});
      }
      if(action==='update_file'){
        if(!need(ctx,'manage_files')) return json({error:'Missing manage_files permission'},403);
        const id=String(body.file_id); const patch:any={};
        if(typeof body.display_name==='string' && body.display_name.trim()) patch.display_name=body.display_name.trim().slice(0,255);
        if(typeof body.visibility==='string' && ['private','public'].includes(body.visibility)) patch.visibility=body.visibility;
        if(typeof body.is_favorite==='boolean') patch.is_favorite=body.is_favorite;
        if(typeof body.is_trashed==='boolean') { patch.is_trashed=body.is_trashed; patch.deleted_at=body.is_trashed?new Date().toISOString():null; }
        if(!Object.keys(patch).length) return json({error:'No editable fields supplied'},400);
        const {error}=await ctx.admin.from('files').update(patch).eq('id',id); if(error) return json({error:error.message},400); await audit(ctx,'file_updated','file',id,patch); return json({ok:true});
      }
      if(action==='delete_file'){
        if(!need(ctx,'delete_files')) return json({error:'Missing delete_files permission'},403);
        const id=String(body.file_id); const {data:f,error:fe}=await ctx.admin.from('files').select('id,storage_path,display_name').eq('id',id).maybeSingle(); if(fe||!f) return json({error:fe?.message||'File not found'},404);
        const sr=await ctx.admin.storage.from('filehub-files').remove([f.storage_path]); if(sr.error) return json({error:sr.error.message},400);
        const {error}=await ctx.admin.from('files').delete().eq('id',id); if(error) return json({error:error.message},400); await audit(ctx,'file_deleted','file',id,{name:f.display_name}); return json({ok:true});
      }
      if(action==='revoke_share'){
        if(!need(ctx,'manage_shares')) return json({error:'Missing manage_shares permission'},403);
        const id=String(body.share_id); const {error}=await ctx.admin.from('share_links').update({disabled:true}).eq('id',id); if(error) return json({error:error.message},400); await audit(ctx,'share_revoked','share',id); return json({ok:true});
      }
      if(action==='set_permission'){
        if(!need(ctx,'manage_admins')) return json({error:'Missing manage_admins permission'},403);
        const key=String(body.permission_key); if(!ALL_PERMS.includes(key)) return json({error:'Unknown permission'},400);
        const adminId=String(body.admin_id); const enabled=Boolean(body.enabled);
        if(adminId===ctx.account.id && ctx.account.is_owner && !enabled) return json({error:'Owner permissions cannot be disabled'},400);
        const {error}=await ctx.admin.from('admin_permissions').upsert({admin_id:adminId,permission_key:key,enabled},{onConflict:'admin_id,permission_key'}); if(error) return json({error:error.message},400); await audit(ctx,'permission_changed','admin',adminId,{permission_key:key,enabled}); return json({ok:true});
      }
      if(action==='add_admin'){
        if(!need(ctx,'manage_admins')) return json({error:'Missing manage_admins permission'},403);
        const email=String(body.email||'').trim().toLowerCase(); if(!email) return json({error:'Email required'},400);
        const {data:users,error:ue}=await ctx.admin.auth.admin.listUsers({page:1,perPage:1000}); if(ue) return json({error:ue.message},400);
        const target=(users.users||[]).find((u:any)=>(u.email||'').toLowerCase()===email); if(!target) return json({error:'User must create a normal FileHub account first'},404);
        const {data:existing}=await ctx.admin.from('admin_accounts').select('id').eq('user_id',target.id).maybeSingle(); if(existing) return json({error:'Already an admin'},400);
        const {data:aa,error}=await ctx.admin.from('admin_accounts').insert({user_id:target.id,email,display_name:String(body.display_name||target.user_metadata?.full_name||email),is_active:true,is_owner:false,created_by:ctx.user.id}).select('*').single(); if(error) return json({error:error.message},400);
        await ctx.admin.from('admin_permissions').insert(ALL_PERMS.map(permission_key=>({admin_id:aa.id,permission_key,enabled:false}))); await audit(ctx,'admin_added','admin',aa.id,{email}); return json({ok:true});
      }
      if(action==='toggle_admin'){
        if(!need(ctx,'manage_admins')) return json({error:'Missing manage_admins permission'},403);
        const id=String(body.admin_id); const {data:target}=await ctx.admin.from('admin_accounts').select('is_owner').eq('id',id).maybeSingle(); if(target?.is_owner) return json({error:'Owner cannot be deactivated'},400);
        const {error}=await ctx.admin.from('admin_accounts').update({is_active:Boolean(body.is_active),updated_at:new Date().toISOString()}).eq('id',id); if(error) return json({error:error.message},400); await audit(ctx,'admin_status_changed','admin',id,{is_active:Boolean(body.is_active)}); return json({ok:true});
      }
      return json({error:'Unknown action'},400);
    }
    return json({error:'Method not allowed'},405);
  }catch(e){return json({error:e instanceof Error?e.message:'Server error'},500)}
});
