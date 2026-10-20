package cn.suike.timetable;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;

/** Platform-independent bounds shared by the native feature contract. */
final class FeatureRules {
    static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    static final int MAX_BYTES = 1024 * 1024;
    static final int MAX_OCCURRENCES = 50000;
    static final int MAX_LEAD_MINUTES = 120;
    static final long MIN_TIME = 946656000000L; // 2000-01-01 in Shanghai
    static final long MAX_TIME = 4133952000000L; // 2101-01-01 in Shanghai

    private FeatureRules() { }

    static boolean validDateAndTimes(String date, long start, long end) {
        if (date == null || !date.matches("\\d{4}-\\d{2}-\\d{2}")) return false;
        if (start < MIN_TIME || end >= MAX_TIME || end <= start || end - start > 86400000L) return false;
        try {
            LocalDate day = LocalDate.parse(date);
            return day.equals(Instant.ofEpochMilli(start).atZone(ZONE).toLocalDate())
                    && day.equals(Instant.ofEpochMilli(end - 1).atZone(ZONE).toLocalDate());
        } catch (DateTimeParseException error) { return false; }
    }

    static boolean safeText(String value, int maximum, boolean allowEmpty) {
        if (value == null || value.length() > maximum || (!allowEmpty && value.trim().isEmpty())) return false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            // Do not allow invisible controls or bidi overrides into notifications.
            if (Character.isISOControl(c) || (c >= 0x202a && c <= 0x202e)
                    || (c >= 0x2066 && c <= 0x2069) || c == 0x200e || c == 0x200f) return false;
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= value.length() || !Character.isLowSurrogate(value.charAt(++i))) return false;
            } else if (Character.isLowSurrogate(c)) return false;
        }
        return true;
    }

    static long reminderTime(long start, int leadMinutes) {
        return start - leadMinutes * 60000L;
    }
}
