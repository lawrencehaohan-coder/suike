package cn.suike.timetable;

import android.content.Context;
import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Stores only the validated local timetable projection; never school HTML or login data. */
final class FeatureDataStore {
    static final class Invalid extends Exception {
        final String code;
        Invalid(String code) { this.code = code; }
    }

    static final class CourseOverride {
        final Boolean enabled;
        final Integer leadMinutes;
        CourseOverride(Boolean enabled, Integer leadMinutes) {
            this.enabled = enabled;
            this.leadMinutes = leadMinutes;
        }
    }

    static final class Occurrence {
        final String id, courseId, date, name, room;
        final long startMillis, endMillis;
        Occurrence(String id, String courseId, String date, String name, String room, long start, long end) {
            this.id = id; this.courseId = courseId; this.date = date;
            this.name = name; this.room = room; startMillis = start; endMillis = end;
        }
        String deliveryKey() { return id + "\u001f" + startMillis; }
    }

    static final class Snapshot {
        final String theme;
        final boolean enabled;
        final int leadMinutes;
        final Set<String> muted;
        final Map<String, CourseOverride> overrides;
        final List<Occurrence> occurrences;
        Snapshot(boolean enabled, int lead, Set<String> muted, Map<String, CourseOverride> overrides,
                 List<Occurrence> occurrences) {
            this(enabled,lead,muted,overrides,occurrences,"auto");
        }
        Snapshot(boolean enabled, int lead, Set<String> muted, Map<String, CourseOverride> overrides,
                 List<Occurrence> occurrences,String theme) {
            this.theme=theme;
            this.enabled = enabled; leadMinutes = lead; this.muted = muted;
            this.overrides = overrides; this.occurrences = occurrences;
        }
        boolean shouldRemind(Occurrence occurrence) {
            if (!enabled || muted.contains(occurrence.courseId)) return false;
            CourseOverride override = overrides.get(occurrence.courseId);
            return override == null || override.enabled == null || override.enabled;
        }
        int leadFor(Occurrence occurrence) {
            CourseOverride override = overrides.get(occurrence.courseId);
            return override != null && override.leadMinutes != null ? override.leadMinutes : leadMinutes;
        }
        Snapshot withEnabled(boolean value) {
            return new Snapshot(value, leadMinutes, muted, overrides, occurrences,theme);
        }
    }

    private FeatureDataStore() { }

    static Snapshot empty() {
        return new Snapshot(false, 10, new HashSet<String>(), new HashMap<String, CourseOverride>(),
                new ArrayList<Occurrence>());
    }

    static Snapshot parse(String payload) throws Invalid {
        if (payload == null || payload.length() > FeatureRules.MAX_BYTES
                || payload.getBytes(StandardCharsets.UTF_8).length > FeatureRules.MAX_BYTES) throw new Invalid("payload_too_large");
        checkDepth(payload);
        try {
            JSONTokener tokener = new JSONTokener(payload);
            Object parsed = tokener.nextValue();
            if (!(parsed instanceof JSONObject) || tokener.nextClean() != 0) throw new Invalid("invalid_json");
            JSONObject root = (JSONObject) parsed;
            if (millis(root.get("schemaVersion")) != 1) throw new Invalid("unsupported_schema");
            Object enabled = root.get("enabled");
            if (!(enabled instanceof Boolean)) throw new Invalid("invalid_settings");
            int lead = root.has("leadMinutes") ? integer(root.get("leadMinutes"), 0, FeatureRules.MAX_LEAD_MINUTES) : 10;
            Set<String> muted = new HashSet<>();
            if (root.has("mutedCourseIds")) {
                JSONArray array = root.getJSONArray("mutedCourseIds");
                if (array.length() > FeatureRules.MAX_OCCURRENCES) throw new Invalid("invalid_settings");
                for (int i = 0; i < array.length(); i++) muted.add(string(array.get(i), 128, false));
            }
            Map<String, CourseOverride> overrides = new HashMap<>();
            if (root.has("courseOverrides")) {
                JSONObject object = root.getJSONObject("courseOverrides");
                if (object.length() > FeatureRules.MAX_OCCURRENCES) throw new Invalid("invalid_settings");
                Iterator<String> keys = object.keys();
                while (keys.hasNext()) {
                    String rawKey = keys.next();
                    String key = string(rawKey, 128, false);
                    if (overrides.containsKey(key)) throw new Invalid("invalid_settings");
                    JSONObject entry = object.getJSONObject(rawKey);
                    Boolean on = null;
                    if (entry.has("enabled")) {
                        Object value = entry.get("enabled");
                        if (!(value instanceof Boolean)) throw new Invalid("invalid_settings");
                        on = (Boolean) value;
                    }
                    Integer minutes = entry.has("leadMinutes")
                            ? integer(entry.get("leadMinutes"), 0, FeatureRules.MAX_LEAD_MINUTES) : null;
                    overrides.put(key, new CourseOverride(on, minutes));
                }
            }
            JSONArray entries = root.getJSONArray("occurrences");
            if (entries.length() > FeatureRules.MAX_OCCURRENCES) throw new Invalid("too_many_occurrences");
            List<Occurrence> occurrences = new ArrayList<>(entries.length());
            Set<String> ids = new HashSet<>();
            for (int i = 0; i < entries.length(); i++) {
                JSONObject entry = entries.getJSONObject(i);
                String id = string(entry.get("id"), 128, false);
                if (!ids.add(id)) throw new Invalid("duplicate_occurrence");
                String courseId = string(entry.get("courseId"), 128, false);
                String date = string(entry.get("date"), 10, false);
                String name = string(entry.get("name"), 120, false);
                String room = entry.has("room") ? string(entry.get("room"), 160, true) : "";
                long start = millis(entry.get("startMillis"));
                long end = millis(entry.get("endMillis"));
                if (!FeatureRules.validDateAndTimes(date, start, end)) throw new Invalid("invalid_occurrence_time");
                occurrences.add(new Occurrence(id, courseId, date, name, room, start, end));
            }
            Collections.sort(occurrences, Comparator.comparingLong((Occurrence o) -> o.startMillis).thenComparing(o -> o.id));
            String theme=root.optString("theme","auto");
            if(!("auto".equals(theme)||"light".equals(theme)||"dark".equals(theme)))throw new Invalid("invalid_settings");
            return new Snapshot((Boolean) enabled, lead, muted, overrides, occurrences,theme);
        } catch (JSONException | ClassCastException error) { throw new Invalid("invalid_payload"); }
    }

    private static String string(Object value, int limit, boolean allowEmpty) throws Invalid {
        if (!(value instanceof String)) throw new Invalid("invalid_text");
        String text = (String) value;
        if (!FeatureRules.safeText(text, limit, allowEmpty)) throw new Invalid("invalid_text");
        return text.trim();
    }

    private static void checkDepth(String json) throws Invalid {
        int depth = 0;
        boolean quoted = false, escaped = false;
        for (int i = 0; i < json.length(); i++) {
            char c = json.charAt(i);
            if (quoted) {
                if (escaped) escaped = false;
                else if (c == '\\') escaped = true;
                else if (c == '"') quoted = false;
            } else if (c == '"') quoted = true;
            else if (c == '{' || c == '[') {
                if (++depth > 8) throw new Invalid("invalid_json");
            } else if (c == '}' || c == ']') {
                if (--depth < 0) throw new Invalid("invalid_json");
            } else if (c != ':' && c != ',' && c != ' ' && c != '\n' && c != '\r' && c != '\t') {
                // Android JSONTokener is lenient (single quotes, comments, bare keys). Reject those
                // extensions before parsing so they cannot hide excessive nesting from this scan.
                int end = i;
                while (end < json.length() && "{}[]:, \n\r\t".indexOf(json.charAt(end)) < 0) end++;
                String token = json.substring(i, end);
                if (!token.equals("true") && !token.equals("false") && !token.equals("null")
                        && !token.matches("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?"))
                    throw new Invalid("invalid_json");
                i = end - 1;
            }
        }
        if (quoted || depth != 0) throw new Invalid("invalid_json");
    }

    private static int integer(Object value, int minimum, int maximum) throws Invalid {
        long number = millis(value);
        if (number < minimum || number > maximum) throw new Invalid("invalid_settings");
        return (int) number;
    }

    private static long millis(Object value) throws Invalid {
        if (!(value instanceof Number)) throw new Invalid("invalid_number");
        double number = ((Number) value).doubleValue();
        if (Double.isNaN(number) || Double.isInfinite(number) || number != Math.rint(number)
                || number < -9007199254740991D || number > 9007199254740991D) throw new Invalid("invalid_number");
        return ((Number) value).longValue();
    }

    static Snapshot read(Context context) throws IOException, Invalid {
        AtomicFile file = file(context);
        if (!file.getBaseFile().exists() && !new File(file.getBaseFile().getPath() + ".bak").exists()) return empty();
        try (FileInputStream stream = file.openRead(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) != -1) {
                if (bytes.size() + count > FeatureRules.MAX_BYTES) throw new IOException("feature_store_limit");
                bytes.write(buffer, 0, count);
            }
            return parse(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        }
    }

    static void write(Context context, Snapshot snapshot) throws IOException {
        byte[] encoded = encode(snapshot).getBytes(StandardCharsets.UTF_8);
        if (encoded.length > FeatureRules.MAX_BYTES) throw new IOException("feature_store_limit");
        AtomicFile file = file(context);
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(encoded);
            file.finishWrite(output);
        } catch (IOException error) {
            if (output != null) file.failWrite(output);
            throw error;
        }
    }

    private static AtomicFile file(Context context) {
        return new AtomicFile(new File(context.getFilesDir(), "native-features-v1.json"));
    }

    private static String encode(Snapshot snapshot) throws IOException {
        try {
            JSONObject result = new JSONObject();
            result.put("schemaVersion", 1).put("theme",snapshot.theme).put("enabled", snapshot.enabled).put("leadMinutes", snapshot.leadMinutes);
            JSONArray muted = new JSONArray();
            for (String id : snapshot.muted) muted.put(id);
            result.put("mutedCourseIds", muted);
            JSONObject overrides = new JSONObject();
            for (Map.Entry<String, CourseOverride> entry : snapshot.overrides.entrySet()) {
                JSONObject value = new JSONObject();
                if (entry.getValue().enabled != null) value.put("enabled", entry.getValue().enabled);
                if (entry.getValue().leadMinutes != null) value.put("leadMinutes", entry.getValue().leadMinutes);
                overrides.put(entry.getKey(), value);
            }
            result.put("courseOverrides", overrides);
            JSONArray occurrences = new JSONArray();
            for (Occurrence item : snapshot.occurrences) {
                occurrences.put(new JSONObject().put("id", item.id).put("courseId", item.courseId)
                        .put("date", item.date).put("name", item.name).put("room", item.room)
                        .put("startMillis", item.startMillis).put("endMillis", item.endMillis));
            }
            return result.put("occurrences", occurrences).toString();
        } catch (JSONException error) { throw new IOException("feature_encode_failed"); }
    }
}
