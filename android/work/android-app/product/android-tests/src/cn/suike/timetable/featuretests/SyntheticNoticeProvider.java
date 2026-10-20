package cn.suike.timetable.featuretests;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;

/** Exposes one generated course-only PNG. No user images, arbitrary filenames or network access. */
public final class SyntheticNoticeProvider extends ContentProvider {
    public static final String AUTHORITY = "cn.suike.timetable.featuretests.notice";
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "image/png"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String order) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String where, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String where, String[] args) { throw new UnsupportedOperationException(); }

    @Override public synchronized ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!AUTHORITY.equals(uri.getAuthority()) || !"/notice.png".equals(uri.getPath()) || !"r".equals(mode))
            throw new FileNotFoundException("SYNTHETIC_IMAGE_ONLY");
        File image = new File(getContext().getCacheDir(), "synthetic-notice.png");
        try {
            if (!image.isFile()) {
                Bitmap bitmap = Bitmap.createBitmap(2000, 1050, Bitmap.Config.ARGB_8888);
                try {
                    Canvas canvas = new Canvas(bitmap); canvas.drawColor(Color.WHITE);
                    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG); paint.setColor(Color.BLACK);
                    paint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL)); paint.setTextSize(88);
                    String[] lines = {"课程调整通知", "高等数学课程教室调整", "第七周星期三第一二节", "上课地点改为教学楼 A301", "请同学们按时到新教室上课"};
                    for (int row = 0; row < lines.length; row++) canvas.drawText(lines[row], 100, 160 + row * 170, paint);
                    try (FileOutputStream out = new FileOutputStream(image)) {
                        if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) throw new IOException();
                    }
                } finally { bitmap.recycle(); }
            }
            return ParcelFileDescriptor.open(image, ParcelFileDescriptor.MODE_READ_ONLY);
        } catch (IOException | RuntimeException error) { throw new FileNotFoundException("SYNTHETIC_IMAGE_FAILED"); }
    }
}
