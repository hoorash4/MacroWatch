import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const headers={"Access-Control-Allow-Origin":"https://hoorash4.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers});
 try{
  const jwt=(req.headers.get("Authorization")||"").replace(/^Bearer\\s+/i,"");
  if(!jwt) return out({error:"로그인이 필요합니다."},401);
  const url=Deno.env.get("SUPABASE_URL")!, key=Deno.env.get("SUPABASE_ANON_KEY")!;
  const auth=createClient(url,key); const {data,error}=await auth.auth.getUser(jwt);
  if(error||!data.user) return out({error:"로그인이 필요합니다."},401);
  const id=String((await req.json()).target_id||""); if(!id) return out({error:"지표 ID가 필요합니다."},400);
  const db=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:target}=await db.from("targets").select("id").eq("id",id).eq("user_id",data.user.id).maybeSingle();
  if(!target) return out({error:"해당 지표를 찾을 수 없습니다."},404);
  const token=Deno.env.get("GITHUB_ADMIN_TOKEN"); if(!token) return out({error:"GitHub 관리자 토큰이 없습니다."},500);
  const response=await fetch("https://api.github.com/repos/hoorash4/macrowatch/actions/workflows/check-targets.yml/dispatches",{method:"POST",headers:{"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"},body:JSON.stringify({ref:"main",inputs:{target_id:id}})});
  if(!response.ok) return out({error:"개별 지표 확인 작업을 시작하지 못했습니다."},502);
  return out({accepted:true,target_id:id},202);
 }catch(e){return out({error:e instanceof Error?e.message:"요청 처리에 실패했습니다."},500);}
});