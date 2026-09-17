import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const body=await req.json(); const id=String(body.file_id||''); const code=String(body.file_code||'');
    if(!id&&!code)return new Response(JSON.stringify({error:'file_id or file_code required'}),{status:400,headers:cors});
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; const url=Deno.env.get('SUPABASE_URL')!; const admin=createClient(url,service);
    let q=admin.from('files').select('id,owner_id,original_name,display_name,storage_path,mime_type,extension,size_bytes,visibility,is_trashed,created_at,file_code');
    if(id)q=q.eq('id',id); else q=q.eq('file_code',code);
    const {data:file,error}=await q.eq('visibility','public').eq('is_trashed',false).maybeSingle(); if(error)throw error;
    if(!file)return new Response(JSON.stringify({error:'Public file not found'}),{status:404,headers:cors});
    const {data:signed,error:signedError}=await admin.storage.from('filehub-files').createSignedUrl(file.storage_path,300); if(signedError)throw signedError;
    return new Response(JSON.stringify({file,signed_url:signed.signedUrl}),{status:200,headers:cors});
  }catch(e){return new Response(JSON.stringify({error:e instanceof Error?e.message:'Server error'}),{status:500,headers:cors});}
});
