package cn.suike.timetable;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import com.googlecode.tesseract.android.TessBaseAPI;
import java.io.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Explicitly selected screenshot only. Bundled offline OCR, no network calls. */
public final class NoticeOcr {
    public interface Result { void completed(String text, String error); }
    private static final AtomicBoolean BUSY = new AtomicBoolean();
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor();
    private NoticeOcr() {}
    /** Shared local recognizer for PDF pages. Caller owns and recycles the bitmap. */
    public static String recognizeBitmap(Context context, Bitmap bitmap) throws Exception {
        File base = new File(context.getFilesDir(), "notice-ocr");
        ensureModel(context, base);
        TessBaseAPI tess = new TessBaseAPI();
        try {
            tess.setDebug(false);
            if (!tess.init(base.getAbsolutePath(), "chi_sim", TessBaseAPI.OEM_LSTM_ONLY)) throw new IOException();
            tess.setPageSegMode(3); tess.setImage(bitmap);
            return tess.getUTF8Text();
        } finally { tess.recycle(); }
    }
    private static synchronized void ensureModel(Context context, File base) throws Exception {
        File data = new File(base, "tessdata");
        if (!data.isDirectory() && !data.mkdirs()) throw new IOException();
        File model = new File(data, "chi_sim.traineddata");
        if (model.exists() && model.length() == 2469156) return;
        File stage = new File(data, "chi_sim.tmp");
        try (InputStream in = context.getAssets().open("ocr/chi_sim.traineddata"); OutputStream out = new FileOutputStream(stage)) {
            byte[] block = new byte[8192]; int size;
            while ((size = in.read(block)) != -1) out.write(block, 0, size);
        }
        if (stage.length() != 2469156 || !stage.renameTo(model)) throw new IOException();
    }
    public static boolean recognize(Context context, Uri uri, Result result) {
        if (!BUSY.compareAndSet(false, true)) return false;
        Context app = context.getApplicationContext();
        WORKER.execute(() -> {
            Bitmap bitmap = null; TessBaseAPI tess = null;
            String text = "", error = "none";
            try {
                if (uri == null || !"content".equals(uri.getScheme())) throw new IOException();
                byte[] bytes;
                try (InputStream in = app.getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    if (in == null) throw new IOException();
                    byte[] block = new byte[8192]; int size;
                    while ((size = in.read(block)) >= 0) { if (out.size() + size > 24 * 1024 * 1024) throw new IOException(); out.write(block, 0, size); }
                    bytes = out.toByteArray();
                }
                BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth > 16000 || bounds.outHeight > 16000) throw new IOException();
                BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1; options.inPreferredConfig = Bitmap.Config.ARGB_8888;
                while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > 4000) options.inSampleSize *= 2;
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                if (bitmap == null) throw new IOException();
                File base = new File(app.getFilesDir(), "notice-ocr"), data = new File(base, "tessdata");
                if (!data.isDirectory() && !data.mkdirs()) throw new IOException();
                File model = new File(data, "chi_sim.traineddata");
                if (!model.exists() || model.length() != 2469156) {
                    File stage = new File(data, "chi_sim.tmp");
                    try (InputStream in = app.getAssets().open("ocr/chi_sim.traineddata"); OutputStream out = new FileOutputStream(stage)) {
                        byte[] block = new byte[8192]; int size; while ((size = in.read(block)) >= 0) out.write(block, 0, size);
                    }
                    if (stage.length() != 2469156 || !stage.renameTo(model)) throw new IOException();
                }
                tess = new TessBaseAPI(); tess.setDebug(false);
                if (!tess.init(base.getAbsolutePath(), "chi_sim", TessBaseAPI.OEM_LSTM_ONLY)) throw new IOException();
                tess.setPageSegMode(3); tess.setImage(bitmap); text = tess.getUTF8Text();
                if (text == null || text.trim().isEmpty()) { text = ""; error = "NO_TEXT"; }
                else if (text.length() > 20000) { text = ""; error = "TEXT_TOO_LONG"; }
            } catch (Exception | LinkageError | OutOfMemoryError failure) { text = ""; error = "OCR_FAILED"; }
            finally {
                if (tess != null) try { tess.recycle(); } catch (RuntimeException ignored) {}
                if (bitmap != null) bitmap.recycle(); BUSY.set(false);
            }
            result.completed(text, error);
        });
        return true;
    }
}
