package cn.suike.timetable;

import android.content.Context;
import android.util.AtomicFile;

import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Synchronous durable boundary for the trusted local workspace adapter. No inner JSON is parsed. */
public final class WorkspaceCheckpoint {
    public static final int MAX_BYTES = 16 * 1024 * 1024;
    private static final Object LOCK = new Object();
    private static final String NAME = "workspace-checkpoint-v1.json";
    private static final String READ_FAILURE = "WORKSPACE_CHECKPOINT_UNAVAILABLE";
    private static final Set<String> KEYS = new HashSet<>(Arrays.asList("suike.timetable.v1", "suike.history.v1",
            "suike.semesters.v1", "suike.workspace.transaction.v1"));

    private WorkspaceCheckpoint() { }

    /** Null means no checkpoint exists. A damaged or unreadable checkpoint is never treated as absent. */
    public static String read(Context context) {
        synchronized (LOCK) {
            try {
                AtomicFile file = file(context);
                File base = file.getBaseFile();
                if (!base.exists() && !new File(base.getPath() + ".bak").exists()
                        && !new File(base.getPath() + ".new").exists()) return null;
                byte[] bytes;
                try (FileInputStream input = file.openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (output.size() + count > MAX_BYTES) throw new IOException();
                        output.write(buffer, 0, count);
                    }
                    bytes = output.toByteArray();
                }
                String payload = decode(bytes);
                validate(payload);
                return payload;
            } catch (IOException | JSONException | RuntimeException | OutOfMemoryError error) {
                // Do not expose file paths, nested JSON, exception causes, or any workspace values.
                throw new IllegalStateException(READ_FAILURE);
            }
        }
    }

    /** Returns true only after the complete validated file is written, fsynced and atomically committed. */
    public static boolean persist(Context context, String payload) {
        synchronized (LOCK) {
            AtomicFile file = null; FileOutputStream output = null;
            try {
                if (payload == null || payload.length() > MAX_BYTES) return false;
                validate(payload);
                byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > MAX_BYTES) return false;
                file = file(context); output = file.startWrite();
                output.write(bytes);
                output.getFD().sync(); // Explicit failure propagation before AtomicFile's commit/rename.
                file.finishWrite(output); output = null;
                // AtomicFile.finishWrite has no result; confirm its final rename actually published these bytes.
                return payload.equals(read(context));
            } catch (IOException | JSONException | RuntimeException | OutOfMemoryError error) {
                if (file != null && output != null) {
                    try { file.failWrite(output); } catch (RuntimeException ignored) { }
                }
                return false;
            }
        }
    }

    private static AtomicFile file(Context context) {
        return new AtomicFile(new File(context.getApplicationContext().getFilesDir(), NAME));
    }

    private static String decode(byte[] bytes) throws CharacterCodingException {
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
    }

    private static void validate(String payload) throws JSONException {
        if (payload == null || payload.length() > MAX_BYTES) throw new JSONException("INVALID_CHECKPOINT");
        lexicalGuard(payload);
        JSONTokener input = new JSONTokener(payload);
        if (input.nextClean() != '{') throw new JSONException("INVALID_CHECKPOINT");
        Set<String> rootKeys = new HashSet<>();
        for (;;) {
            Object key = input.nextValue();
            if (!(key instanceof String) || !rootKeys.add((String) key) || input.nextClean() != ':')
                throw new JSONException("INVALID_CHECKPOINT");
            if ("version".equals(key)) {
                Object version = input.nextValue();
                if (!(version instanceof Number) || ((Number) version).doubleValue() != 1D)
                    throw new JSONException("INVALID_CHECKPOINT");
            } else if ("values".equals(key)) validateValues(input);
            else throw new JSONException("INVALID_CHECKPOINT");
            char separator = input.nextClean();
            if (separator == '}') break;
            if (separator != ',') throw new JSONException("INVALID_CHECKPOINT");
        }
        if (rootKeys.size() != 2 || input.nextClean() != 0) throw new JSONException("INVALID_CHECKPOINT");
    }

    private static void validateValues(JSONTokener input) throws JSONException {
        if (input.nextClean() != '{') throw new JSONException("INVALID_CHECKPOINT");
        Set<String> seen = new HashSet<>();
        for (;;) {
            Object key = input.nextValue();
            if (!(key instanceof String) || !KEYS.contains(key) || !seen.add((String) key) || input.nextClean() != ':')
                throw new JSONException("INVALID_CHECKPOINT");
            Object value = input.nextValue();
            if (!(value instanceof String) && value != JSONObject.NULL) throw new JSONException("INVALID_CHECKPOINT");
            char separator = input.nextClean();
            if (separator == '}') break;
            if (separator != ',') throw new JSONException("INVALID_CHECKPOINT");
        }
        if (seen.size() != KEYS.size()) throw new JSONException("INVALID_CHECKPOINT");
    }

    /** Reject JSONTokener's non-JSON extensions, malformed strings and nesting before it can recurse. */
    private static void lexicalGuard(String json) throws JSONException {
        int depth = 0; boolean quoted = false;
        for (int i = 0; i < json.length(); i++) {
            char c = json.charAt(i);
            if (quoted) {
                if (c == '\\') {
                    if (++i >= json.length()) throw new JSONException("INVALID_CHECKPOINT");
                    char escape = json.charAt(i);
                    if (escape == 'u') {
                        for (int digit = 0; digit < 4; digit++) {
                            if (++i >= json.length() || "0123456789abcdefABCDEF".indexOf(json.charAt(i)) < 0)
                                throw new JSONException("INVALID_CHECKPOINT");
                        }
                    } else if ("\"\\/bfnrt".indexOf(escape) < 0) throw new JSONException("INVALID_CHECKPOINT");
                } else if (c == '"') quoted = false;
                else if (c < 0x20) throw new JSONException("INVALID_CHECKPOINT");
                else if (Character.isHighSurrogate(c)) {
                    if (i + 1 >= json.length() || !Character.isLowSurrogate(json.charAt(++i))) throw new JSONException("INVALID_CHECKPOINT");
                } else if (Character.isLowSurrogate(c)) throw new JSONException("INVALID_CHECKPOINT");
            } else if (c == '"') quoted = true;
            else if (c == '{') { if (++depth > 2) throw new JSONException("INVALID_CHECKPOINT"); }
            else if (c == '}') { if (--depth < 0) throw new JSONException("INVALID_CHECKPOINT"); }
            else if (c != ':' && c != ',' && c != ' ' && c != '\r' && c != '\n' && c != '\t') {
                int end = i;
                while (end < json.length() && "{}[]:, \r\n\t".indexOf(json.charAt(end)) < 0) end++;
                String token = json.substring(i, end);
                if (!token.equals("null") && !token.matches("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?"))
                    throw new JSONException("INVALID_CHECKPOINT");
                i = end - 1;
            }
        }
        if (quoted || depth != 0) throw new JSONException("INVALID_CHECKPOINT");
    }
}
