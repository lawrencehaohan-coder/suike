import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { validCheckpoint } from '../domain/Rules';

export class AtomicStore {
  private dir: string;
  constructor(dir: string) { this.dir = dir; }
  read(name: string): string | null {
    const path = this.path(name);
    if (!fs.accessSync(path)) return null;
    if (fs.statSync(path).size > 12 * 1024 * 1024) throw new Error('STORE_TOO_LARGE');
    return fs.readTextSync(path);
  }
  write(name: string, value: string): boolean {
    const data = new util.TextEncoder().encodeInto(value);
    if (data.byteLength > 12 * 1024 * 1024) return false;
    const final = this.path(name), temp = final+'.pending';
    let file: fs.File | undefined = undefined;
    try {
      file = fs.openSync(temp,fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      let offset = 0;
      while (offset < data.byteLength) {
        const part = data.slice(offset);
        const wrote = fs.writeSync(file.fd,part.buffer);
        if (wrote <= 0) throw new Error('STORE_SHORT_WRITE');
        offset += wrote;
      }
      fs.fsyncSync(file.fd); fs.closeSync(file); file = undefined;
      fs.renameSync(temp,final);
      return this.read(name) === value;
    } catch (_) {
      if (file) { try { fs.closeSync(file); } catch (_) {} }
      try { if (fs.accessSync(temp)) fs.unlinkSync(temp); } catch (_) {}
      return false;
    }
  }
  checkpoint(): string {
    const value = this.read('workspace.json');
    if (value !== null && !validCheckpoint(value)) throw new Error('CHECKPOINT_INVALID');
    return value === null ? 'null' : value;
  }
  persistCheckpoint(value: string): boolean { return validCheckpoint(value) && this.write('workspace.json',value); }
  private path(name: string): string {
    if (!/^[a-z0-9-]+\.json$/.test(name)) throw new Error('STORE_NAME_INVALID');
    return this.dir+'/'+name;
  }
}
