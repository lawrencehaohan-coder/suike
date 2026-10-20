import { image } from '@kit.ImageKit';
import { textRecognition } from '@kit.CoreVisionKit';
import { pdfService } from '@kit.PDFKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { ContentPart } from './DeepSeekService';

const INPUT_LIMIT: number = 4 * 1024 * 1024;
const OCR_PIXELS: number = 4000000;
const PAGE_PIXELS: number = 3000000;
const JPEG_LIMIT: number = 2 * 1024 * 1024;
const PARTS_LIMIT: number = 24 * 1024 * 1024;

// API 12 implementations only. These methods read user-selected local data;
// they neither send network requests nor commit course records.
export class NativeDocuments {
  private static ocrBusy: boolean = false;

  async recognizeImage(bytes: Uint8Array, cancelled: () => boolean): Promise<string> {
    this.checkCancelled(cancelled);
    this.checkInput(bytes);
    if (!canIUse('SystemCapability.AI.OCR.TextRecognition')) throw new Error('OCR_UNSUPPORTED');
    if (NativeDocuments.ocrBusy) throw new Error('OCR_BUSY');
    NativeDocuments.ocrBusy = true;
    let source: image.ImageSource | undefined = undefined;
    let pixels: image.PixelMap | undefined = undefined;
    let initialized = false;
    let text = '';
    let failure: Error | undefined = undefined;
    let cleanupFailed = false;
    try {
      source = image.createImageSource(bytes.slice().buffer);
      const info = await source.getImageInfo(0);
      this.checkCancelled(cancelled);
      const width = info.size.width, height = info.size.height;
      if (!this.validDimension(width) || !this.validDimension(height)) throw new Error('OCR_IMAGE_INVALID');
      // Project bounds, checked before allocating decoded image memory.
      if (width > 30000 || height > 30000 || width * height > 100000000) throw new Error('OCR_IMAGE_TOO_LARGE');
      const scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(OCR_PIXELS / (width * height)));
      const targetWidth = Math.max(1, Math.floor(width * scale));
      const targetHeight = Math.max(1, Math.floor(height * scale));
      if (targetWidth < 100 || targetHeight < 100) throw new Error('OCR_IMAGE_TOO_SMALL');
      pixels = await source.createPixelMap({
        desiredSize: { width: targetWidth, height: targetHeight },
        desiredPixelFormat: image.PixelMapFormat.RGBA_8888
      });
      this.checkCancelled(cancelled);
      const decoded = await pixels.getImageInfo();
      this.checkCancelled(cancelled);
      if (!this.validDimension(decoded.size.width) || !this.validDimension(decoded.size.height) ||
        decoded.size.width > 4096 || decoded.size.height > 4096 ||
        decoded.size.width * decoded.size.height > OCR_PIXELS) throw new Error('OCR_IMAGE_TOO_LARGE');
      if (decoded.size.width < 100 || decoded.size.height < 100) throw new Error('OCR_IMAGE_TOO_SMALL');
      initialized = true;
      const ready = await textRecognition.init();
      this.checkCancelled(cancelled);
      if (!ready) throw new Error('OCR_UNAVAILABLE');
      const result = await textRecognition.recognizeText({ pixelMap: pixels }, { isDirectionDetectionSupported: true });
      this.checkCancelled(cancelled);
      if (typeof result.value !== 'string') throw new Error('OCR_FAILED');
      text = result.value.trim();
      if (text.length === 0) throw new Error('NO_TEXT');
      if (text.length > 20000) throw new Error('OCR_TEXT_TOO_LONG');
    } catch (error) {
      failure = this.normalized(error as Error, 'OCR_FAILED');
      text = '';
    } finally {
      if (initialized) { try { await textRecognition.release(); } catch (_) { cleanupFailed = true; } }
      if (pixels) { try { await pixels.release(); } catch (_) { cleanupFailed = true; } }
      if (source) { try { await source.release(); } catch (_) { cleanupFailed = true; } }
      NativeDocuments.ocrBusy = false;
    }
    this.checkCancelled(cancelled);
    if (failure) throw failure;
    if (cleanupFailed) throw new Error('OCR_CLEANUP_FAILED');
    return text;
  }

  async pdfParts(bytes: Uint8Array, cacheDir: string, cancelled: () => boolean): Promise<ContentPart[]> {
    this.checkCancelled(cancelled);
    this.checkInput(bytes);
    if (!canIUse('SystemCapability.OfficeService.PDFService.Core')) throw new Error('PDF_UNSUPPORTED');
    if (bytes.length < 5 || bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70 || bytes[4] !== 45) {
      throw new Error('PDF_INVALID');
    }
    // Only pass UIAbilityContext.cacheDir here. The bridge must never accept a
    // cache path supplied by web content. The basename is generated natively.
    if (!cacheDir.startsWith('/') || cacheDir.includes('\u0000') || cacheDir.split('/').includes('..')) {
      throw new Error('PDF_CACHE_INVALID');
    }
    const filename = cacheDir.replace(/\/+$/, '') + '/suike-pdf-' + util.generateRandomUUID(true) + '.pdf';
    let file: fs.File | undefined = undefined;
    let created = false;
    let document: pdfService.PdfDocument | undefined = undefined;
    let packer: image.ImagePacker | undefined = undefined;
    let pixels: image.PixelMap | undefined = undefined;
    let failure: Error | undefined = undefined;
    let cleanupFailed = false;
    const parts: ContentPart[] = [];
    try {
      this.checkCancelled(cancelled);
      try {
        if (fs.accessSync(filename)) throw new Error('PDF_TEMP_WRITE_FAILED');
        file = fs.openSync(filename, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
        created = true;
        let offset = 0;
        while (offset < bytes.byteLength) {
          this.checkCancelled(cancelled);
          const wrote = fs.writeSync(file.fd, bytes.slice(offset).buffer);
          if (wrote <= 0 || wrote > bytes.byteLength - offset) throw new Error('PDF_TEMP_WRITE_FAILED');
          offset += wrote;
        }
        fs.fsyncSync(file.fd);
        if (fs.statSync(file.fd).size !== bytes.byteLength) throw new Error('PDF_TEMP_WRITE_FAILED');
        fs.closeSync(file); file = undefined;
      } catch (error) {
        this.checkCancelled(cancelled);
        throw new Error('PDF_TEMP_WRITE_FAILED');
      }
      this.checkCancelled(cancelled);
      document = new pdfService.PdfDocument();
      const loaded = document.loadDocument(filename, undefined, (_progress: number): number => cancelled() ? 1 : 0);
      this.checkCancelled(cancelled);
      if (loaded === pdfService.ParseResult.PARSE_ERROR_PASSWORD) throw new Error('PDF_PASSWORD_REQUIRED');
      if (loaded !== pdfService.ParseResult.PARSE_SUCCESS) throw new Error('PDF_INVALID');
      const count = document.getPageCount();
      if (!Number.isInteger(count) || count < 1) throw new Error('PDF_INVALID');
      if (count > 12) throw new Error('PDF_TOO_MANY_PAGES');
      packer = image.createImagePacker();
      const base64 = new util.Base64Helper();
      const encoder = new util.TextEncoder();
      let jsonBytes = 2; // UTF-8 bytes of the surrounding JSON array brackets.
      for (let index = 0; index < count; index++) {
        this.checkCancelled(cancelled);
        const page = document.getPage(index);
        const width = page.getWidth(), height = page.getHeight();
        if (!this.validDimension(width) || !this.validDimension(height) ||
          !Number.isFinite(width * height)) throw new Error('PDF_PAGE_INVALID');
        const scale = Math.min(1440 / width, 2000 / height, Math.sqrt(PAGE_PIXELS / (width * height)));
        const outputWidth = Math.max(1, Math.floor(width * scale));
        const outputHeight = Math.max(1, Math.floor(height * scale));
        const matrix = new pdfService.PdfMatrix();
        matrix.x = 0; matrix.y = 0; matrix.width = width; matrix.height = height; matrix.rotate = 0;
        pixels = page.getAreaPixelMap(matrix, outputWidth, outputHeight, false, true);
        this.checkCancelled(cancelled);
        const info = await pixels.getImageInfo();
        this.checkCancelled(cancelled);
        if (!this.validDimension(info.size.width) || !this.validDimension(info.size.height) ||
          info.size.width > 1440 || info.size.height > 2000 || info.size.width * info.size.height > PAGE_PIXELS) {
          throw new Error('PDF_PAGE_TOO_LARGE');
        }
        // packing() is retained intentionally: it exists on API 12, whereas
        // its replacement packToData() starts at API 13.
        const jpeg = await packer.packing(pixels, { format: 'image/jpeg', quality: 85, bufferSize: JPEG_LIMIT });
        this.checkCancelled(cancelled);
        if (jpeg.byteLength === 0 || jpeg.byteLength > JPEG_LIMIT) throw new Error('PDF_IMAGE_TOO_LARGE');
        const textPart: ContentPart = { type: 'text', text: 'PDF 第 ' + (index + 1) + ' / ' + count + ' 页' };
        const imagePart: ContentPart = {
          type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + base64.encodeToStringSync(new Uint8Array(jpeg)) }
        };
        // imagePart's JSON is ASCII, so string length equals UTF-8 byte length.
        jsonBytes += encoder.encodeInto(JSON.stringify(textPart)).byteLength + JSON.stringify(imagePart).length +
          (parts.length > 0 ? 2 : 1);
        if (jsonBytes >= PARTS_LIMIT) throw new Error('PDF_PARTS_TOO_LARGE');
        this.checkCancelled(cancelled);
        parts.push(textPart, imagePart);
        await pixels.release(); pixels = undefined;
        this.checkCancelled(cancelled);
      }
    } catch (error) {
      failure = this.normalized(error as Error, 'PDF_FAILED');
      parts.length = 0;
    } finally {
      if (pixels) { try { await pixels.release(); } catch (_) { cleanupFailed = true; } }
      if (packer) { try { await packer.release(); } catch (_) { cleanupFailed = true; } }
      if (document) { try { document.releaseDocument(); } catch (_) { cleanupFailed = true; } }
      if (file) { try { fs.closeSync(file); } catch (_) { cleanupFailed = true; } }
      if (created) { try { fs.unlinkSync(filename); } catch (_) { cleanupFailed = true; } }
    }
    this.checkCancelled(cancelled);
    if (failure) throw failure;
    if (cleanupFailed) throw new Error('PDF_CLEANUP_FAILED');
    return parts;
  }

  private checkInput(bytes: Uint8Array): void {
    if (bytes.byteLength === 0 || bytes.byteLength > INPUT_LIMIT) throw new Error('DOCUMENT_SIZE');
  }
  private checkCancelled(cancelled: () => boolean): void { if (cancelled()) throw new Error('CANCELLED'); }
  private validDimension(value: number): boolean { return Number.isFinite(value) && value > 0; }
  private normalized(error: Error, fallback: string): Error {
    if (error && typeof error.message === 'string' &&
      (error.message === 'CANCELLED' || error.message === 'NO_TEXT' || /^OCR_[A-Z_]+$/.test(error.message) ||
      /^PDF_[A-Z_]+$/.test(error.message))) return new Error(error.message);
    return new Error(fallback);
  }
}
