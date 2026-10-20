import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
interface Secret { key: string; model: string; }
export class KeyVault {
  private alias: Uint8Array = new util.TextEncoder().encodeInto('cn.suike.deepseek.harmony.v1');
  private query(): asset.AssetMap { const q: asset.AssetMap = new Map(); q.set(asset.Tag.ALIAS,this.alias); return q; }
  private load(): Secret | null {
    const q = this.query(); q.set(asset.Tag.RETURN_TYPE,asset.ReturnType.ALL);
    try {
      const rows = asset.querySync(q);
      if (rows.length !== 1) throw new Error('KEY_UNREADABLE');
      const bytes = rows[0].get(asset.Tag.SECRET) as Uint8Array;
      return JSON.parse(util.TextDecoder.create('utf-8').decodeWithStream(bytes)) as Secret;
    } catch (error) {
      if ((error as BusinessError).code === 24000002) return null;
      throw new Error('KEY_UNREADABLE');
    }
  }
  config(): string {
    try { const s=this.load(); return JSON.stringify({ ok:true, configured:s!==null, model:s?s.model:'deepseek-flash' }); }
    catch (_) { return JSON.stringify({ok:false,code:'KEY_UNREADABLE'}); }
  }
  key(): string { const s=this.load();if(!s)throw new Error('KEY_MISSING');return s.key; }
  model(): string { const s=this.load();return s?s.model:'deepseek-flash'; }
  save(key: string, model: string): string {
    try {
      key=key.trim();model=model.trim();
      if(!/^[A-Za-z0-9._-]{1,80}$/.test(model))return JSON.stringify({ok:false,code:'MODEL_INVALID'});
      const old=this.load();
      if(!key)key=old?old.key:'';
      if(!/^[A-Za-z0-9._-]{12,256}$/.test(key))return JSON.stringify({ok:false,code:key?'KEY_INVALID':'KEY_MISSING'});
      const bytes=new util.TextEncoder().encodeInto(JSON.stringify({key:key,model:model}));
      const attrs: asset.AssetMap=new Map();attrs.set(asset.Tag.SECRET,bytes);
      if(old)asset.updateSync(this.query(),attrs);
      else {attrs.set(asset.Tag.ALIAS,this.alias);attrs.set(asset.Tag.ACCESSIBILITY,asset.Accessibility.DEVICE_FIRST_UNLOCKED);asset.addSync(attrs);}
      return this.config();
    }catch(_){return JSON.stringify({ok:false,code:'SETTINGS_FAILED'});}
  }
  clear(): string {
    try { if(this.load())asset.removeSync(this.query());return this.config(); }
    catch(_){return JSON.stringify({ok:false,code:'SETTINGS_FAILED'});}
  }
}
