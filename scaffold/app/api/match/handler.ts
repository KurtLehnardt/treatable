import {isLoopbackRequest} from "@/lib/corpus/loopback";
import {PatientProfileSchema} from "@/lib/contracts/patientProfile";import {searchStudies} from "@/lib/studies/match";import {rateLimit,clientKey} from "@/lib/security/rateLimit";import type {StudyProvider} from "@/lib/scoring/studyTwoPass";
export type MatchDeps={searchStudies:typeof searchStudies};
export async function handleMatchRequest(req:Request,deps:Partial<MatchDeps>={}):Promise<Response>{
 if(!isLoopbackRequest(req))return Response.json({error:"Search is only available from this computer."},{status:403});
 if(!rateLimit(clientKey(req),{limit:20,windowMs:60000}).ok)return Response.json({error:"Please wait a moment before searching again."},{status:429});
 if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return Response.json({error:"Send a JSON request."},{status:415});
 let body:any;try{const text=await req.text();if(text.length>40000)return Response.json({error:"Description is too long."},{status:413});body=JSON.parse(text);}catch{return Response.json({error:"Invalid search request."},{status:400});}
 const parsed=PatientProfileSchema.safeParse(body.profile);if(!parsed.success)return Response.json({error:"Check your age, location, and diagnosis or symptom.",issues:parsed.error.issues.map(i=>({path:i.path,message:i.message}))},{status:400});
 const provider:StudyProvider=body.provider??"none";if(!["none","local","openai"].includes(provider))return Response.json({error:"Choose keyword search, Local, or OpenAI."},{status:400});if(provider==="openai"&&body.cloudConsent!==true)return Response.json({error:"Confirm that your description may be sent to OpenAI."},{status:403});
 const encoder=new TextEncoder();let cancelled=false;const stream=new ReadableStream({async start(controller){const send=(event:unknown)=>{if(!cancelled)controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));};try{await (deps.searchStudies||searchStudies)(parsed.data,{provider,signal:req.signal,onEvent:send});}catch{send({type:"error",message:"The search could not finish. Keep any results already shown and try again."});}finally{if(!cancelled)controller.close();}},cancel(){cancelled=true;}});
 return new Response(stream,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-store, no-cache, must-revalidate","Connection":"keep-alive","X-Accel-Buffering":"no"}});
}
