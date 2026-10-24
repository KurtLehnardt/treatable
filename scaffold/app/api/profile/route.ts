import {handleProfileRequest} from "./handler";
export const runtime="nodejs";
export async function POST(req:Request){return handleProfileRequest(req);}
