import { http } from '@kit.NetworkKit';
import { KeyVault } from './KeyVault';
import { COURSE_PROMPT, PROGRAM_CONTRACT } from './DeepSeekPrompt';

export interface ContentPart { type: string; text?: string; image_url?: ImageUrl; }
interface ImageUrl { url: string; }
interface Context { startMonday: string; totalWeeks: number; periods: Object[]; }
interface Input { protocol: number; stage: string; text: string; attachmentId: string; context: Context; answers: Object[]; scope: Object | null; target: Object | null; }
interface Message { role: string; content: string | ContentPart[]; }
interface RequestBody { model: string; messages: Message[]; stream: boolean; temperature: number; max_tokens: number; thinking: Thinking; response_format: Format; }
interface Thinking { type: string; }
interface Format { type: string; }
interface ResponseMessage { content: string; }
interface Choice { finish_reason: string; message: ResponseMessage; }
interface Model { id: string; }
interface Reply { data?: Model[]; choices?: Choice[]; }
export class DeepSeekService {
  private vault: KeyVault;
  private generation: number=0;
  private busy: boolean=false;
  private connection: http.HttpRequest | null=null;
  private attachments: Map<string,ContentPart[]>=new Map();
  constructor(vault: KeyVault) { this.vault = vault; }
  clearAttachments(): void { this.attachments.clear(); }
  keep(id: string, parts: ContentPart[]): void {
    if(!/^[A-Za-z0-9-]{1,64}$/.test(id)||!parts.length||parts.length>50||JSON.stringify(parts).length>24*1024*1024)throw new Error('ATTACHMENT_INVALID');
    parts.forEach((p: ContentPart)=>{
      if(p.type==='text'&&typeof p.text==='string'&&p.text.length<1048576)return;
      if(p.type==='image_url'&&p.image_url&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p.image_url.url))return;
      throw new Error('ATTACHMENT_INVALID');
    });
    this.attachments.clear();this.attachments.set(id,parts);
  }
  cancel(): void { this.generation++;if(this.connection)this.connection.destroy();this.connection=null; }
  async start(id: string, action: string, payload: string, reply: (id: string,json: string)=>void): Promise<void> {
    if(this.busy){reply(id,JSON.stringify({ok:false,code:'BUSY'}));return;}
    this.busy=true;const generation=this.generation;
    try {
      const key=this.vault.key(),model=this.vault.model();
      let body: RequestBody | undefined=undefined;
      if(action==='parse')body=this.body(payload,model);
      const response=await this.send(action==='test'?'/models':'/chat/completions',key,body);
      let result: string;
      if(action==='test') {
        if(!response.data)throw new Error('RESPONSE_INVALID');
        if(!response.data.some((m: Model)=>m.id===model))throw new Error('MODEL_UNAVAILABLE');
        result=JSON.stringify({ok:true,action:'test'});
      } else {
        if(!response.choices||!response.choices.length)throw new Error('RESPONSE_INVALID');
        const choice=response.choices[0];if(choice.finish_reason!=='stop')throw new Error('OUTPUT_TRUNCATED');
        if(!choice.message.content||choice.message.content.length>100000)throw new Error('RESPONSE_INVALID');
        result=JSON.stringify({ok:true,action:'parse',result:JSON.parse(choice.message.content)});
      }
      if(generation===this.generation)reply(id,result);
    }catch(error){
      const code=(error as Error).message;
      if(generation===this.generation)reply(id,JSON.stringify({ok:false,code:/^[A-Z_]{3,40}$/.test(code)?code:'NETWORK'}));
    }finally{this.busy=false;}
  }
  private body(payload: string, model: string): RequestBody {
    const p=JSON.parse(payload) as Input;
    if(p.protocol!==2||!['inspect','extract'].includes(p.stage)||typeof p.text!=='string'||p.text.length>12000||(!p.text.trim()&&!p.attachmentId)||!p.context||!/^\d{4}-\d{2}-\d{2}$/.test(p.context.startMonday)||p.context.totalWeeks<1||p.context.totalWeeks>60||!Array.isArray(p.context.periods)||p.context.periods.length>30||!Array.isArray(p.answers)||p.answers.length>40)throw new Error('TEXT_INVALID');
    const parts=p.attachmentId?this.attachments.get(p.attachmentId):undefined;
    if(p.attachmentId&&!parts)throw new Error('ATTACHMENT_EXPIRED');
    const clean=JSON.stringify({protocol:2,stage:p.stage,text:p.text,context:p.context,answers:p.answers,scope:p.scope,target:p.target});
    let content: string | ContentPart[]=clean;
    if(parts){const list: ContentPart[]=[{type:'text',text:clean}];parts.forEach((v: ContentPart)=>list.push(v));content=list;}
    return {model:parts&&parts.some((v: ContentPart)=>v.type==='image_url')?'deepseek-flash':model,messages:[{role:'system',content:COURSE_PROMPT+PROGRAM_CONTRACT},{role:'user',content:content}],stream:false,temperature:0,max_tokens:16384,thinking:{type:'enabled'},response_format:{type:'json_object'}};
  }
  private async send(path: string,key: string,body?: RequestBody): Promise<Reply> {
    const connection=http.createHttp();this.connection=connection;
    try {
      const response=await connection.request('https://api.deepseek.com'+path,{method:body?http.RequestMethod.POST:http.RequestMethod.GET,header:{'Authorization':'Bearer '+key,'Content-Type':'application/json','Accept':'application/json'},extraData:body?JSON.stringify(body):'',connectTimeout:15000,readTimeout:70000,usingCache:false,expectDataType:http.HttpDataType.STRING,maxLimit:262144});
      const status=response.responseCode;
      if(status!==200)throw new Error(status===401?'AUTH':status===402?'BALANCE':status===429?'RATE_LIMIT':status>=500?'SERVER':'REQUEST_FAILED');
      if(typeof response.result!=='string'||response.result.length>262144)throw new Error('RESPONSE_INVALID');
      return JSON.parse(response.result) as Reply;
    }finally{connection.destroy();if(this.connection===connection)this.connection=null;}
  }
}
