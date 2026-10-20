package cn.suike.timetable;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/** Mirrors teaching-collector.js v1. Raw course text only; local parser validates it again. */
public final class PortalCaptureContract {
    public static final String SOURCE = "just-jwglxt-table";
    public static final int MAX_CAPTURE_BYTES = 512 * 1024;
    public static final int MAX_CALLBACK_CHARS = 1024 * 1024;
    private static final Set<String> ERRORS = set("UNSUPPORTED_PAGE", "TABLE_MISSING", "TABLE_INVALID",
            "TERM_MISSING", "TERM_INVALID", "TERM_MISMATCH", "DAY_HEADERS_INVALID", "PERIOD_HEADERS_INVALID",
            "NO_COURSES", "TOO_MANY_COURSES", "COURSE_FIELDS_INVALID", "SELECTION_UNKNOWN",
            "CAPTURE_TOO_LARGE", "COLLECTOR_FAILED");
    private static final Set<String> ROW_KEYS = set("cell", "name", "lines", "selected");

    private PortalCaptureContract() { }

    /** evaluateJavascript serializes the string returned by JSON.stringify: decode exactly twice. */
    public static JSONObject decodeEvaluation(String callback) throws JSONException {
        if (callback == null || callback.length() > MAX_CALLBACK_CHARS) throw invalid();
        JSONTokener outer = new JSONTokener(callback);
        Object decoded = outer.nextValue();
        if (!(decoded instanceof String) || outer.nextClean() != 0) throw invalid();
        return parse((String) decoded);
    }

    public static JSONObject parse(String raw) throws JSONException {
        if (raw == null || raw.length() > MAX_CAPTURE_BYTES ||
                raw.getBytes(StandardCharsets.UTF_8).length > MAX_CAPTURE_BYTES) throw invalid();
        JSONTokener tokener = new JSONTokener(raw);
        Object value = tokener.nextValue();
        if (!(value instanceof JSONObject) || tokener.nextClean() != 0) throw invalid();
        JSONObject object = (JSONObject) value;
        SchoolAdapterRegistry.Profile profile=SchoolAdapterRegistry.byCaptureSource(object.optString("source"));
        if(profile==null)throw invalid();
        if("jsxsd".equals(profile.protocol))return JsxsdCaptureContract.validate(object,profile);
        Object version = object.get("adapterVersion");
        if (!SOURCE.equals(exactString(object, "source", 32, true)) ||
                !(version instanceof Integer) || ((Integer) version) != 1) throw invalid();
        if (object.has("error")) {
            exactKeys(object, set("source", "adapterVersion", "error"));
            if (!ERRORS.contains(exactString(object, "error", 40, true))) throw invalid();
            return object;
        }
        Set<String> captureKeys=set("source", "adapterVersion", "term", "rows", "unscheduledPresent");
        if(object.has("periods"))captureKeys.add("periods");
        if(object.has("periodCount")){captureKeys.add("periodCount");Object count=object.get("periodCount");if(!(count instanceof Integer)||(Integer)count<1||(Integer)count>24)throw invalid();}
        exactKeys(object,captureKeys);
        if(object.has("periods")) {
            Object timingValue=object.get("periods");
            if(!(timingValue instanceof JSONArray))throw invalid();
            JSONArray timing=(JSONArray)timingValue;
            if(timing.length()<1||timing.length()>24)throw invalid();
            Set<Integer> seen=new HashSet<>();int previousPeriod=0;String previousEnd="";
            for(int i=0;i<timing.length();i++){
                if(!(timing.get(i) instanceof JSONObject))throw invalid();
                JSONObject row=timing.getJSONObject(i);exactKeys(row,set("period","start","end"));
                Object number=row.get("period");
                if(!(number instanceof Integer))throw invalid();
                int period=(Integer)number;
                String start=exactString(row,"start",5,true),end=exactString(row,"end",5,true);
                if(period<1||period>24||object.has("periodCount")&&period>object.getInt("periodCount")||!seen.add(period)||period<=previousPeriod||
                        !start.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")||!end.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")||
                        start.compareTo(end)>=0||previousEnd.compareTo(start)>0)throw invalid();
                previousPeriod=period;previousEnd=end;
            }
        }
        Object termValue = object.get("term");
        if (!(termValue instanceof JSONObject)) throw invalid();
        JSONObject term = (JSONObject) termValue;
        exactKeys(term, set("year", "semester"));
        String year = exactString(term, "year", 9, true);
        String semester = exactString(term, "semester", 1, true);
        if (!year.matches("[0-9]{4}-[0-9]{4}") || !("1".equals(semester) || "2".equals(semester))) throw invalid();
        if (!(object.get("unscheduledPresent") instanceof Boolean)) throw invalid();
        Object rowsValue = object.get("rows");
        if (!(rowsValue instanceof JSONArray)) throw invalid();
        JSONArray rows = (JSONArray) rowsValue;
        if (rows.length() == 0 || rows.length() > 500) throw invalid();
        for (int i = 0; i < rows.length(); i++) {
            Object rowValue = rows.get(i);
            if (!(rowValue instanceof JSONObject)) throw invalid();
            JSONObject row = (JSONObject) rowValue;
            exactKeys(row, ROW_KEYS);
            exactString(row, "name", 80, true);
            if (!exactString(row, "cell", 40, true).matches("[1-7]-(?:1[01]|[1-9])")) throw invalid();
            if (!(row.get("selected") instanceof Boolean)) throw invalid();
            Object linesValue = row.get("lines");
            if (!(linesValue instanceof JSONArray) || ((JSONArray) linesValue).length() != 4) throw invalid();
            JSONArray lines = (JSONArray) linesValue;
            for (int j = 0; j < 4; j++) boundedString(lines.get(j), 200, false);
        }
        return object;
    }

    private static String exactString(JSONObject object, String key, int limit, boolean required) throws JSONException {
        return boundedString(object.get(key), limit, required);
    }

    private static String boundedString(Object value, int limit, boolean required) throws JSONException {
        if (!(value instanceof String)) throw invalid();
        String text = (String) value;
        if (text.length() > limit || (required && text.trim().length() == 0)) throw invalid();
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c < 0x20 || c == 0x7f) throw invalid();
        }
        return text;
    }

    private static void exactKeys(JSONObject object, Set<String> expected) throws JSONException {
        if (object.length() != expected.size()) throw invalid();
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) if (!expected.contains(keys.next())) throw invalid();
    }

    private static Set<String> set(String... values) { return new HashSet<>(Arrays.asList(values)); }
    private static JSONException invalid() { return new JSONException("invalid-portal-capture"); }
}
