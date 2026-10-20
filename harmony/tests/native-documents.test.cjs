// Behavior mocks for native resource ownership and bounds. Device OCR/PDF
// accuracy and native SDK compilation are verified separately.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.env.HARMONY_TYPESCRIPT || path.resolve(__dirname, '../../../harmony-tools/hvigor-6.0.6/node_modules/@ohos/hvigor/node_modules/typescript'));
const source = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/services/NativeDocuments.ets'), 'utf8').replace(/^import[^\n]*;\s*$/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const MB = 1024 * 1024;
const pdfBytes = () => new Uint8Array(Buffer.from('%PDF-1.7\nsynthetic fixture'));
function fixture(options = {}) {
  const calls = [], files = new Map(), handles = new Map(); let serial = 0, cancelled = false;
  function mark(stage) { calls.push(stage); if (options.cancelAt === stage) cancelled = true; if (options.failAt === stage) throw new Error('provider detail must not escape'); }
  const size = options.imageSize || { width: 1800, height: 2400 };
  let desired;
  const pixels = label => ({ async getImageInfo() { mark(label + '.info'); return { size: options.decodedSize || desired || { width: 1000, height: 1400 } }; }, async release() { mark(label + '.release'); } });
  const image = {
    PixelMapFormat: { RGBA_8888: 3 },
    createImageSource() { mark('source.create'); return { async getImageInfo() { mark('source.info'); return { size }; }, async createPixelMap(opts) { mark('source.decode'); desired = opts.desiredSize; return pixels('ocr-pixels'); }, async release() { mark('source.release'); } }; },
    createImagePacker() { mark('packer.create'); return { async packing(_pixels, opts) { mark('packer.packing'); assert.equal(opts.format, 'image/jpeg'); assert.equal(opts.bufferSize, 2 * MB); return new ArrayBuffer(options.jpegSize === undefined ? 1024 : options.jpegSize); }, async release() { mark('packer.release'); } }; }
  };
  const textRecognition = {
    async init() { mark('ocr.init'); if (options.initGate) await options.initGate; return options.ready !== false; },
    async recognizeText() { mark('ocr.recognize'); return { value: options.text === undefined ? '  合成实验通知\n第 9 周  ' : options.text }; },
    async release() { mark('ocr.release'); }
  };
  const nativeFs = {
    OpenMode: { CREATE: 1, READ_WRITE: 2, TRUNC: 4 },
    accessSync(p) { mark('file.access'); return files.has(p); },
    openSync(p) { mark('file.open'); files.set(p, Buffer.alloc(0)); handles.set(++serial, p); return { fd: serial }; },
    writeSync(fd, value) { mark('file.write'); const buffer = Buffer.from(value), n = options.zeroWrite ? 0 : Math.min(options.shortWrite || buffer.length, buffer.length); files.set(handles.get(fd), Buffer.concat([files.get(handles.get(fd)), buffer.subarray(0, n)])); return n; },
    fsyncSync() { mark('file.sync'); },
    statSync(fd) { mark('file.stat'); return { size: files.get(handles.get(fd)).length + (options.badFileSize ? 1 : 0) }; },
    closeSync(file) { mark('file.close'); handles.delete(typeof file === 'number' ? file : file.fd); },
    unlinkSync(p) { mark('file.unlink'); files.delete(p); }
  };
  const pdfService = {
    ParseResult: { PARSE_SUCCESS: 0, PARSE_ERROR_PASSWORD: 1 },
    PdfMatrix: class {},
    PdfDocument: class {
      constructor() { mark('pdf.create'); }
      loadDocument(p, _password, progress) { mark('pdf.load'); assert.deepEqual(files.get(p), Buffer.from(pdfBytes())); if (options.cancelDuringLoad) cancelled = true; assert.equal(progress(10), cancelled ? 1 : 0); return options.parseResult || 0; }
      getPageCount() { mark('pdf.count'); return options.pages === undefined ? 2 : options.pages; }
      getPage(index) { mark('pdf.page'); return { getWidth: () => (options.pageSize || { width: 600, height: 840 }).width, getHeight: () => (options.pageSize || { width: 600, height: 840 }).height, getAreaPixelMap(_matrix, width, height) { mark('pdf.render'); assert.ok(width <= 1440 && height <= 2000 && width * height <= 3000000); desired = { width, height }; return pixels('pdf-pixels-' + index); } }; }
      releaseDocument() { mark('pdf.release'); }
    }
  };
  const util = { generateRandomUUID: () => 'synthetic-id', Base64Helper: class { encodeToStringSync(bytes) { return Buffer.from(bytes).toString('base64'); } }, TextEncoder: class { encodeInto(text) { return new TextEncoder().encode(text); } } };
  const context = { exports: {}, image, textRecognition, pdfService, fs: nativeFs, util, canIUse: () => options.supported !== false };
  vm.runInNewContext(compiled, context, { filename: 'NativeDocuments.ets' });
  const service = new context.exports.NativeDocuments();
  return { service, NewService: context.exports.NativeDocuments, calls, files, handles, cancelled: () => cancelled, cancel: () => { cancelled = true; }, desired: () => desired };
}
function noLeaks(f) { assert.equal(f.files.size, 0, 'temporary files removed'); assert.equal(f.handles.size, 0, 'file handles closed'); }
test('OCR reads text locally, bounds decoded pixels, trims output, and releases all native resources', async () => {
  const f = fixture(); assert.equal(await f.service.recognizeImage(new Uint8Array([1]), f.cancelled), '合成实验通知\n第 9 周');
  const size = f.desired(); assert.ok(size.width * size.height <= 4000000); assert.ok(Math.max(size.width, size.height) <= 4096);
  assert.deepEqual(f.calls.slice(-3), ['ocr.release', 'ocr-pixels.release', 'source.release']);
});
test('OCR refuses missing/oversized files, unsupported systems, extreme dimensions, and unusable images before allocation', async () => {
  for (const bytes of [new Uint8Array(), new Uint8Array(4 * MB + 1)]) { const f = fixture(); await assert.rejects(f.service.recognizeImage(bytes, f.cancelled), /DOCUMENT_SIZE/); assert.equal(f.calls.length, 0); }
  const unsupported = fixture({ supported: false }); await assert.rejects(unsupported.service.recognizeImage(new Uint8Array([1]), unsupported.cancelled), /OCR_UNSUPPORTED/); assert.equal(unsupported.calls.length, 0);
  for (const [size, code] of [[{ width: 0, height: 200 }, 'OCR_IMAGE_INVALID'], [{ width: Infinity, height: 200 }, 'OCR_IMAGE_INVALID'], [{ width: 30001, height: 200 }, 'OCR_IMAGE_TOO_LARGE'], [{ width: 10001, height: 10001 }, 'OCR_IMAGE_TOO_LARGE'], [{ width: 99, height: 200 }, 'OCR_IMAGE_TOO_SMALL']]) {
    const f = fixture({ imageSize: size }); await assert.rejects(f.service.recognizeImage(new Uint8Array([1]), f.cancelled), new RegExp(code)); assert.ok(!f.calls.includes('source.decode')); assert.equal(f.calls.at(-1), 'source.release');
  }
});
test('OCR rejects provider text failures and oversized decoded output, with cleanup and a reusable busy lock', async () => {
  for (const [options, code] of [[{ ready: false }, 'OCR_UNAVAILABLE'], [{ text: '' }, 'NO_TEXT'], [{ text: 'x'.repeat(20001) }, 'OCR_TEXT_TOO_LONG'], [{ text: 7 }, 'OCR_FAILED'], [{ failAt: 'ocr.recognize' }, 'OCR_FAILED'], [{ decodedSize: { width: 3000, height: 3000 } }, 'OCR_IMAGE_TOO_LARGE'], [{ decodedSize: { width: 40000, height: 100 } }, 'OCR_IMAGE_TOO_LARGE'], [{ decodedSize: { width: 99, height: 200 } }, 'OCR_IMAGE_TOO_SMALL']]) {
    const f = fixture(options); await assert.rejects(f.service.recognizeImage(new Uint8Array([1]), f.cancelled), new RegExp(code)); assert.ok(f.calls.includes('ocr-pixels.release')); assert.equal(f.calls.at(-1), 'source.release');
    await assert.rejects(new f.NewService().recognizeImage(new Uint8Array([1]), f.cancelled), error => !/OCR_BUSY/.test(error.message));
  }
});
test('OCR cancellation at every awaited stage releases resources and never returns stale text', async () => {
  for (const stage of ['source.info', 'source.decode', 'ocr-pixels.info', 'ocr.init', 'ocr.recognize', 'ocr.release']) {
    const f = fixture({ cancelAt: stage }); await assert.rejects(f.service.recognizeImage(new Uint8Array([1]), f.cancelled), /CANCELLED/); assert.equal(f.calls.at(-1), 'source.release');
    if (f.calls.includes('ocr.init')) assert.ok(f.calls.includes('ocr.release'));
  }
  const early = fixture(); early.cancel(); await assert.rejects(early.service.recognizeImage(new Uint8Array([1]), early.cancelled), /CANCELLED/); assert.equal(early.calls.length, 0);
});
test('OCR serializes the global service across instances until the first request releases it', async () => {
  let finish; const f = fixture({ initGate: new Promise(resolve => { finish = resolve; }) });
  const first = f.service.recognizeImage(new Uint8Array([1]), f.cancelled);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await assert.rejects(new f.NewService().recognizeImage(new Uint8Array([1]), f.cancelled), /OCR_BUSY/);
  finish(); await first; assert.equal(await new f.NewService().recognizeImage(new Uint8Array([1]), f.cancelled), '合成实验通知\n第 9 周');
});
test('OCR cleanup failure does not claim success and still releases the remaining resources', async () => {
  for (const stage of ['ocr.release', 'ocr-pixels.release', 'source.release']) { const f = fixture({ failAt: stage }); await assert.rejects(f.service.recognizeImage(new Uint8Array([1]), f.cancelled), /OCR_CLEANUP_FAILED/); assert.ok(f.calls.includes('source.release')); }
});
test('PDF conversion handles short writes, bounded page images, ordered page labels, and complete cleanup', async () => {
  const f = fixture({ shortWrite: 3 }); const parts = await f.service.pdfParts(pdfBytes(), '/cache', f.cancelled);
  assert.equal(parts.length, 4); assert.equal(parts[0].text, 'PDF 第 1 / 2 页'); assert.equal(parts[2].text, 'PDF 第 2 / 2 页');
  assert.match(parts[1].image_url.url, /^data:image\/jpeg;base64,/); assert.ok(f.calls.filter(s => s === 'file.write').length > 1);
  for (const stage of ['pdf-pixels-0.release', 'pdf-pixels-1.release', 'packer.release', 'pdf.release', 'file.unlink']) assert.ok(f.calls.includes(stage)); noLeaks(f);
});
test('PDF refuses unsupported systems, invalid input/signature/cache path before creating a file', async () => {
  const unsupported = fixture({ supported: false }); await assert.rejects(unsupported.service.pdfParts(pdfBytes(), '/cache', unsupported.cancelled), /PDF_UNSUPPORTED/); assert.equal(unsupported.calls.length, 0);
  for (const bytes of [new Uint8Array(), new Uint8Array(4 * MB + 1)]) { const f = fixture(); await assert.rejects(f.service.pdfParts(bytes, '/cache', f.cancelled), /DOCUMENT_SIZE/); assert.equal(f.calls.length, 0); }
  const invalid = fixture(); await assert.rejects(invalid.service.pdfParts(new Uint8Array([1,2,3,4,5]), '/cache', invalid.cancelled), /PDF_INVALID/); assert.equal(invalid.calls.length, 0);
  for (const cache of ['relative', '/cache/../outside', '/cache\u0000']) { const f = fixture(); await assert.rejects(f.service.pdfParts(pdfBytes(), cache, f.cancelled), /PDF_CACHE_INVALID/); assert.equal(f.calls.length, 0); }
});
test('PDF write failures and truncation never reach the parser, remove partial files, and close handles', async () => {
  for (const options of [{ zeroWrite: true }, { badFileSize: true }, { failAt: 'file.write' }, { failAt: 'file.sync' }, { failAt: 'file.stat' }]) { const f = fixture(options); await assert.rejects(f.service.pdfParts(pdfBytes(), '/cache', f.cancelled), /PDF_TEMP_WRITE_FAILED/); assert.ok(!f.calls.includes('pdf.load')); noLeaks(f); }
});
test('PDF never overwrites a colliding native temporary name', async () => {
  const f = fixture(), existing = Buffer.from('keep existing file'); f.files.set('/cache/suike-pdf-synthetic-id.pdf', existing);
  await assert.rejects(f.service.pdfParts(pdfBytes(), '/cache', f.cancelled), /PDF_TEMP_WRITE_FAILED/);
  assert.deepEqual(f.files.get('/cache/suike-pdf-synthetic-id.pdf'), existing); assert.ok(!f.calls.includes('file.open')); assert.ok(!f.calls.includes('file.unlink'));
});
test('PDF checks password/parse failures and page count before rendering or packing', async () => {
  for (const [options, code] of [[{ parseResult: 1 }, 'PDF_PASSWORD_REQUIRED'], [{ parseResult: 2 }, 'PDF_INVALID'], [{ pages: 13 }, 'PDF_TOO_MANY_PAGES'], [{ pages: 0 }, 'PDF_INVALID'], [{ pages: 1.5 }, 'PDF_INVALID']]) { const f = fixture(options); await assert.rejects(f.service.pdfParts(pdfBytes(), '/cache', f.cancelled), new RegExp(code)); assert.ok(!f.calls.includes('pdf.render')); assert.ok(!f.calls.includes('packer.create')); assert.ok(f.calls.includes('pdf.release')); noLeaks(f); }
});
test('PDF rejects invalid page geometry, provider oversized pixelmaps/JPEGs and cumulative JSON transfer size', async () => {
  for (const [options, code] of [[{ pageSize: { width: NaN, height: 10 } }, 'PDF_PAGE_INVALID'], [{ pageSize: { width: 10, height: -1 } }, 'PDF_PAGE_INVALID'], [{ pageSize: { width: 1e308, height: 1e308 } }, 'PDF_PAGE_INVALID'], [{ decodedSize: { width: 1441, height: 100 } }, 'PDF_PAGE_TOO_LARGE'], [{ jpegSize: 0 }, 'PDF_IMAGE_TOO_LARGE'], [{ jpegSize: 2 * MB + 1 }, 'PDF_IMAGE_TOO_LARGE'], [{ pages: 12, jpegSize: 2 * MB }, 'PDF_PARTS_TOO_LARGE']]) {
    const f = fixture(options); await assert.rejects(f.service.pdfParts(pdfBytes(), '/cache', f.cancelled), new RegExp(code)); assert.ok(f.calls.includes('packer.release')); assert.ok(f.calls.includes('pdf.release')); noLeaks(f);
  }
});
test('PDF cancellation during load, render, packing, or cleanup cannot return partial attachments', async () => {
  for (const options of [{ cancelDuringLoad: true }, { cancelAt: 'file.write' }, { cancelAt: 'pdf.render' }, { cancelAt: 'pdf-pixels-0.info' }, { cancelAt: 'packer.packing' }, { cancelAt: 'pdf-pixels-0.release' }, { cancelAt: 'pdf.release' }]) {
    const f = fixture(options); await assert.rejects(f.service.pdfParts(pdfBytes(), '/cache', f.cancelled), /CANCELLED/); noLeaks(f);
    if (f.calls.includes('pdf.create')) assert.ok(f.calls.includes('pdf.release'));
  }
});
test('PDF cleanup errors fail closed while all later cleanup actions still run', async () => {
  for (const stage of ['packer.release', 'pdf.release']) { const f = fixture({ failAt: stage }); await assert.rejects(f.service.pdfParts(pdfBytes(), '/cache', f.cancelled), /PDF_CLEANUP_FAILED/); assert.ok(f.calls.includes('file.unlink')); noLeaks(f); }
  const pixel = fixture({ failAt: 'pdf-pixels-0.release' }); await assert.rejects(pixel.service.pdfParts(pdfBytes(), '/cache', pixel.cancelled), /PDF_FAILED/); assert.ok(pixel.calls.includes('packer.release')); assert.ok(pixel.calls.includes('pdf.release')); noLeaks(pixel);
  const unlink = fixture({ failAt: 'file.unlink' }); await assert.rejects(unlink.service.pdfParts(pdfBytes(), '/cache', unlink.cancelled), /PDF_CLEANUP_FAILED/); assert.ok(unlink.calls.includes('pdf.release')); assert.equal(unlink.handles.size, 0);
});
