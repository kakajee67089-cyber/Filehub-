import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Content-Type":"application/json"};
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const url=new URL(req.url); const token=String(req.method==='GET'?url.searchParams.get('token'):'');
    let body:any={}; if(req.method==='POST') body=await req.json().catch(()=>({}));
    const t=String(body.token||token||'').trim(); if(!t)return new Response(JSON.stringify({error:'token is required'}),{status:400,headers:cors});
    const supabaseUrl=Deno.env.get('SUPABASE_URL')!; const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; const admin=createClient(supabaseUrl,service);
    const {data:share,error:shareError}=await admin.from('share_links').select('id,file_id,mode,expires_at,disabled').eq('token',t).eq('disabled',false).maybeSingle(); if(shareError)throw shareError;
    if(!share)return new Response(JSON.stringify({error:'Share link not found or disabled'}),{status:404,headers:cors});
    if(share.expires_at && new Date(share.expires_at).getTime()<Date.now())return new Response(JSON.stringify({error:'Share link expired'}),{status:410,headers:cors});
    const {data:file,error:fileError}=await admin.from('files').select('id,owner_id,original_name,display_name,storage_path,mime_type,extension,size_bytes,visibility,is_trashed,created_at,file_code').eq('id',share.file_id).maybeSingle(); if(fileError)throw fileError;
    if(!file || file.is_trashed)return new Response(JSON.stringify({error:'File not found'}),{status:404,headers:cors});
    const download=share.mode==='download'; const {data:signed,error:signedError}=await admin.storage.from('filehub-files').createSignedUrl(file.storage_path,300,download?{download:file.display_name||file.original_name}:{}); if(signedError)throw signedError;
    if(download){
      await admin.from('file_downloads').insert({file_id:file.id,user_id:null,user_agent:req.headers.get('user-agent')||null});
      await admin.from('activity_logs').insert({actor_id:null,action:'share_downloaded',entity_type:'file',entity_id:file.id,metadata:{share_link_id:share.id}});
    }
    return new Response(JSON.stringify({share:{mode:share.mode,expires_at:share.expires_at},file,signed_url:signed.signedUrl}),{status:200,headers:cors});
  }catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:'Server error'}),{status:500,headers:cors});}
});
