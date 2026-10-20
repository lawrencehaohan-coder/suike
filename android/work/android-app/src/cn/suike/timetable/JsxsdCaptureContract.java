package cn.suike.timetable;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/** Bundled JSXSD protocol: bounded course text only, never identity/login fields. */
public final class JsxsdCaptureContract {
    private static final Set<String> ERRORS = set("UNSUPPORTED_PAGE", "TABLE_MISSING", "TABLE_INVALID",
            "TERM_INVALID", "WEEK_FILTER_ACTIVE", "DAY_HEADERS_INVALID", "PERIOD_HEADERS_INVALID",
            "COURSE_FIELDS_INVALID", "TOO_MANY_COURSES", "NO_COURSES", "CAPTURE_TOO_LARGE", "COLLECTOR_FAILED");
    private JsxsdCaptureContract() { }
    public static JSONObject validate(JSONObject object, SchoolAdapterRegistry.Profile profile) throws JSONException {
        if (!profile.captureSource.equals(string(object, "source", 40, true)) || !(object.get("adapterVersion") instanceof Integer) || object.getInt("adapterVersion") != profile.adapterVersion) throw invalid();
        if (object.has("error")) {
            keys(object, "source", "adapterVersion", "error");
            if (!ERRORS.contains(string(object, "error", 40, true))) throw invalid();
            return object;
        }
        keys(object, "source", "adapterVersion", "term", "rows", "periodGroups", "unscheduledPresent");
        if (!(object.get("unscheduledPresent") instanceof Boolean) || !(object.get("term") instanceof JSONObject) || !(object.get("rows") instanceof JSONArray) || !(object.get("periodGroups") instanceof JSONArray)) throw invalid();
        JSONObject term = object.getJSONObject("term"); keys(term, "year", "semester");
        String year = string(term, "year", 9, true), semester = string(term, "semester", 1, true);
        if (!year.matches("[0-9]{4}-[0-9]{4}") || !semester.matches("[123]")) throw invalid();
        int first = Integer.parseInt(year.substring(0, 4)), last = Integer.parseInt(year.substring(5));
        if (first < 1900 || last > 2200 || last != first + 1) throw invalid();
        JSONArray groups = object.getJSONArray("periodGroups");
        if ((groups.length() < 2 && !(groups.length() == 0 && "jsxsd-grid".equals(profile.collectorLayout))) || groups.length() > 12) throw invalid();
        int previousPeriod = 0; String previousEnd = "";
        for (int i = 0; i < groups.length(); i++) {
            if (!(groups.get(i) instanceof JSONObject)) throw invalid();
            JSONObject group = groups.getJSONObject(i); keys(group, "group", "first", "last", "start", "end");
            int groupNumber = integer(group, "group"), startPeriod = integer(group, "first"), endPeriod = integer(group, "last");
            String start = string(group, "start", 5, true), end = string(group, "end", 5, true);
            if (groupNumber != i + 1 || startPeriod != previousPeriod + 1 || endPeriod < startPeriod || endPeriod > profile.maxSections || !clock(start) || !clock(end) || start.compareTo(end) >= 0 || previousEnd.compareTo(start) > 0) throw invalid();
            previousPeriod = endPeriod; previousEnd = end;
        }
        if (groups.length() > 0 && previousPeriod < 8) throw invalid();
        JSONArray rows = object.getJSONArray("rows");
        if (rows.length() < 1 || rows.length() > 500) throw invalid();
        for (int i = 0; i < rows.length(); i++) {
            if (!(rows.get(i) instanceof JSONObject)) throw invalid();
            JSONObject row = rows.getJSONObject(i); keys(row, "cell", "name", "weekText", "teacher", "room");
            if (!string(row, "cell", 10, true).matches("[1-7]-(?:[1-9]|1[0-2])")) throw invalid();
            string(row, "name", 80, true); string(row, "weekText", 200, true);
            string(row, "teacher", 120, false); string(row, "room", 120, false);
        }
        return object;
    }
    private static boolean clock(String value) { return value.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]"); }
    private static int integer(JSONObject value, String key) throws JSONException { if (!(value.get(key) instanceof Integer)) throw invalid(); return value.getInt(key); }
    private static String string(JSONObject value, String key, int max, boolean required) throws JSONException {
        if (!(value.get(key) instanceof String)) throw invalid(); String text = value.getString(key);
        if (text.length() > max || required && text.trim().isEmpty()) throw invalid();
        for (int i = 0; i < text.length(); i++) if (text.charAt(i) < 0x20 || text.charAt(i) == 0x7f) throw invalid();
        return text;
    }
    private static void keys(JSONObject value, String... names) throws JSONException {
        Set<String> allowed = set(names); if (value.length() != allowed.size()) throw invalid();
        Iterator<String> iterator = value.keys(); while (iterator.hasNext()) if (!allowed.contains(iterator.next())) throw invalid();
    }
    private static Set<String> set(String... values) { return new HashSet<>(Arrays.asList(values)); }
    private static JSONException invalid() { return new JSONException("invalid-jsxsd-capture"); }
}
