import {PatientProfileSchema} from "@/lib/contracts/patientProfile";
import {extractPatientProfile} from "@/lib/studies/profileExtraction";
import {isLoopbackRequest} from "@/lib/corpus/loopback";
import {rateLimit,clientKey} from "@/lib/security/rateLimit";
export async function handleProfileRequest(req:Request,deps:{extractPatientProfile?:typeof extractPatientProfile}={}){
 if(!isLoopbackRequest(req))return Response.json({error:"Profile assistance is only available from this computer."},{status:403});
 if(!rateLimit(`profile:${clientKey(req)}`,{limit:20,windowMs:60000}).ok)return Response.json({error:"Please wait a moment before trying again."},{status:429});
 if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return Response.json({error:"Send a JSON request."},{status:415});
 let body:any;try{const text=await req.text();if(text.length>40000)return Response.json({error:"Description is too long."},{status:413});body=JSON.parse(text);}catch{return Response.json({error:"Invalid request"},{status:400});}
 const parsed=PatientProfileSchema.safeParse(body.profile);if(!parsed.success)return Response.json({error:"Complete your age, location, and symptoms first."},{status:400});
 if(!["none","local","openai"].includes(body.provider))return Response.json({error:"Unsupported provider"},{status:400});
 if(body.provider==="openai"&&body.cloudConsent!==true)return Response.json({error:"OpenAI consent is required"},{status:403});
 try{return Response.json({profile:await (deps.extractPatientProfile||extractPatientProfile)(parsed.data,body.provider,req.signal)},{headers:{"Cache-Control":"no-store"}});}catch{return Response.json({profile:parsed.data,notice:"The model was unavailable. Your answers were kept."},{headers:{"Cache-Control":"no-store"}});}
}
