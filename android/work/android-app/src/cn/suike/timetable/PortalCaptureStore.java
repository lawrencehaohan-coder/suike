package cn.suike.timetable;

import android.content.Context;
import android.content.Intent;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Pattern;

/** Internal cache only. The result Intent contains a random basename, never timetable JSON. */
public final class PortalCaptureStore {
    public static final String EXTRA_TOKEN = "cn.suike.timetable.PORTAL_CAPTURE_TOKEN";
    private static final String DIRECTORY = "portal-import";
    private static final long MAX_AGE_MS = 15 * 60 * 1000;
    private static final Pattern TOKEN = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.json");
    private PortalCaptureStore() { }

    public static String save(Context context, JSONObject capture) throws IOException, JSONException {
        JSONObject checked = PortalCaptureContract.parse(capture.toString());
        if (checked.has("error")) throw new IOException("capture-not-complete");
        File directory = directory(context);
        purge(directory);
        String token = UUID.randomUUID().toString() + ".json";
        File complete = new File(directory, token);
        File pending = new File(directory, token + ".tmp");
        boolean written = false;
        try {
            byte[] data = checked.toString().getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream stream = new FileOutputStream(pending)) {
                stream.write(data);
                stream.getFD().sync();
            }
            if (!pending.renameTo(complete)) throw new IOException("capture-store-unavailable");
            written = true;
            return token;
        } finally {
            if (!written) { pending.delete(); complete.delete(); }
        }
    }

    /** Call once in the local Activity, then parse and show a merge preview before committing. */
    public static JSONObject consume(Context context, Intent result) throws IOException, JSONException {
        String token = result == null ? null : result.getStringExtra(EXTRA_TOKEN);
        if (token == null || !TOKEN.matcher(token).matches()) throw new IOException("invalid-capture-token");
        File directory = directory(context);
        File file = new File(directory, token);
        if (!file.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile()) || !file.isFile() ||
                file.length() > PortalCaptureContract.MAX_CAPTURE_BYTES || isExpired(file)) {
            file.delete();
            throw new IOException("capture-expired-or-unavailable");
        }
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (FileInputStream stream = new FileInputStream(file)) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = stream.read(buffer)) != -1) {
                    if (bytes.size() + count > PortalCaptureContract.MAX_CAPTURE_BYTES) throw new IOException("capture-too-large");
                    bytes.write(buffer, 0, count);
                }
            }
            JSONObject capture = PortalCaptureContract.parse(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            if (capture.has("error")) throw new IOException("capture-not-complete");
            return capture;
        } finally { file.delete(); }
    }

    private static File directory(Context context) throws IOException {
        File directory = new File(context.getCacheDir(), DIRECTORY);
        if ((!directory.isDirectory() && !directory.mkdirs()) || !directory.isDirectory())
            throw new IOException("capture-store-unavailable");
        return directory;
    }

    private static boolean isExpired(File file) {
        long age = System.currentTimeMillis() - file.lastModified();
        return age < 0 || age > MAX_AGE_MS;
    }

    private static void purge(File directory) {
        File[] files = directory.listFiles();
        if (files == null) return;
        for (File file : files) {
            // Only files owned by this store, never any directory or unrelated file.
            String name = file.getName();
            boolean owned = TOKEN.matcher(name).matches() ||
                    (name.endsWith(".tmp") && TOKEN.matcher(name.substring(0, name.length() - 4)).matches());
            if (file.isFile() && owned && isExpired(file)) file.delete();
        }
    }
}
