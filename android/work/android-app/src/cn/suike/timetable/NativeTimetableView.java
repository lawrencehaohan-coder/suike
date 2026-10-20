package cn.suike.timetable;

import android.app.Activity;
import android.app.DatePickerDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.widget.Button;
import android.widget.DatePicker;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Read-only platform UI for the timetable bundled in this installation. */
public final class NativeTimetableView {
    private static final int INK = Color.rgb(24, 55, 50);
    private static final int MUTED = Color.rgb(102, 123, 117);
    private static final int ACCENT = Color.rgb(8, 127, 117);
    private static final int BACKGROUND = Color.rgb(243, 246, 245);
    private static final String[] DAYS = {"一", "二", "三", "四", "五", "六", "日"};
    private final Activity activity;
    private final List<Course> courses = new ArrayList<Course>();
    private final JSONArray periods;
    private final JSONObject settings;
    private final LinearLayout root;
    private final LinearLayout list;
    private final LinearLayout dayControls;
    private final ScrollView scroll;
    private final TextView weekLabel;
    private final TextView viewLabel;
    private final Button dayButton;
    private final Button weekButton;
    private LocalDate selected = today();
    private boolean weekView;
    private int meetingCount;

    public static View create(Activity activity) throws Exception {
        return new NativeTimetableView(activity).root;
    }

    private NativeTimetableView(Activity owner) throws Exception {
        activity = owner;
        JSONObject data = readData();
        if (data.optInt("schemaVersion", -1) != 1) throw new Exception("课表数据版本不受支持");
        settings = data.getJSONObject("settings");
        periods = data.getJSONArray("periods");
        JSONArray records = data.getJSONArray("courses");
        for (int i = 0; i < records.length(); i++) {
            Course course = new Course(records.getJSONObject(i));
            courses.add(course);
            meetingCount += course.dates.size();
        }
        root = column();
        root.setLayoutParams(new LinearLayout.LayoutParams(-1, -1));
        root.setPadding(dp(16), dp(16), dp(16), dp(8));
        root.setBackgroundColor(BACKGROUND);
        root.addView(text("随课 · 简洁课表", 22, INK, true));
        TextView notice = text("使用安装包初始课表，共 " + meetingCount + " 次安排。\n不包含完整版中保存的个人编辑。", 12, MUTED, false);
        notice.setPadding(0, dp(6), 0, dp(12));
        root.addView(notice);
        weekLabel = text("", 17, INK, true);
        root.addView(weekLabel);

        LinearLayout navigation = row();
        addButton(navigation, "上周", "查看上一周课表", new View.OnClickListener() {
            @Override public void onClick(View view) { selected = selected.minusWeeks(1); render(); }
        });
        addButton(navigation, "本周", "回到中国时间当前周和今天", new View.OnClickListener() {
            @Override public void onClick(View view) { selected = today(); render(); }
        });
        addButton(navigation, "下周", "查看下一周课表", new View.OnClickListener() {
            @Override public void onClick(View view) { selected = selected.plusWeeks(1); render(); }
        });
        root.addView(navigation);

        LinearLayout modes = row();
        dayButton = addButton(modes, "日视图", "查看所选日期的安排", new View.OnClickListener() {
            @Override public void onClick(View view) { weekView = false; render(); }
        });
        weekButton = addButton(modes, "周视图", "查看所选日期所在整周的安排", new View.OnClickListener() {
            @Override public void onClick(View view) { weekView = true; render(); }
        });
        addButton(modes, "选日期", "选择任意上课日期", new View.OnClickListener() {
            @Override public void onClick(View view) { chooseDate(); }
        });
        root.addView(modes);

        dayControls = row();
        addButton(dayControls, "上一天", "查看前一天的安排", new View.OnClickListener() {
            @Override public void onClick(View view) { selected = selected.minusDays(1); render(); }
        });
        addButton(dayControls, "今天", "回到中国时间今天的安排", new View.OnClickListener() {
            @Override public void onClick(View view) { selected = today(); render(); }
        });
        addButton(dayControls, "下一天", "查看后一天的安排", new View.OnClickListener() {
            @Override public void onClick(View view) { selected = selected.plusDays(1); render(); }
        });
        root.addView(dayControls);
        viewLabel = text("", 16, INK, true);
        viewLabel.setPadding(0, dp(8), 0, dp(8));
        root.addView(viewLabel);
        scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        list = column();
        list.setPadding(0, 0, 0, dp(12));
        scroll.addView(list, new ScrollView.LayoutParams(-1, -2));
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        render();
    }

    private JSONObject readData() throws Exception {
        try (InputStream input = activity.getAssets().open("timetable.json");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            int total = 0;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > 8 * 1024 * 1024) throw new Exception("初始课表文件过大");
                output.write(buffer, 0, count);
            }
            return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
        }
    }

    private static LocalDate today() {
        return LocalDate.now(ZoneId.of("Asia/Shanghai"));
    }

    private static LocalDate monday(LocalDate date) {
        return date.minusDays(date.getDayOfWeek().getValue() - 1);
    }

    private static String dateLabel(LocalDate date) {
        return date.getYear() + "年" + date.getMonthValue() + "月" + date.getDayOfMonth() + "日 周" + DAYS[date.getDayOfWeek().getValue() - 1];
    }

    private String teachingWeek(LocalDate date) {
        String start = settings.optString("startMonday", "");
        if (start.length() == 0 || "null".equals(start)) return "";
        try {
            LocalDate first = LocalDate.parse(start);
            if (first.getDayOfWeek().getValue() != 1) return "";
            long week = Math.floorDiv(ChronoUnit.DAYS.between(first, date), 7L) + 1;
            if (week < 1 || week > settings.optInt("totalWeeks", 26)) return "";
            return "第 " + week + " 周 · ";
        } catch (Exception ignored) { return ""; }
    }

    private void render() {
        LocalDate first = monday(selected);
        LocalDate last = first.plusDays(6);
        weekLabel.setText(teachingWeek(first) + first.getMonthValue() + "月" + first.getDayOfMonth() + "日—" + last.getMonthValue() + "月" + last.getDayOfMonth() + "日");
        dayButton.setEnabled(weekView);
        weekButton.setEnabled(!weekView);
        dayControls.setVisibility(weekView ? View.GONE : View.VISIBLE);
        list.removeAllViews();
        if (weekView) {
            viewLabel.setText("整周安排");
            for (int i = 0; i < 7; i++) appendDay(first.plusDays(i), true);
        } else {
            viewLabel.setText(dateLabel(selected));
            appendDay(selected, false);
        }
        scroll.post(new Runnable() {
            @Override public void run() { scroll.scrollTo(0, 0); }
        });
    }

    private void appendDay(LocalDate date, boolean heading) {
        if (heading) {
            TextView title = text(dateLabel(date), 16, INK, true);
            title.setPadding(0, dp(12), 0, dp(8));
            list.addView(title);
        }
        List<Course> matches = new ArrayList<Course>();
        String key = date.toString();
        for (Course course : courses) if (course.dates.contains(key)) matches.add(course);
        Collections.sort(matches, new Comparator<Course>() {
            @Override public int compare(Course a, Course b) {
                if (a.pending != b.pending) return a.pending ? 1 : -1;
                int order = Integer.compare(a.start, b.start);
                if (order != 0) return order;
                order = Integer.compare(a.end, b.end);
                return order != 0 ? order : a.name.compareTo(b.name);
            }
        });
        if (matches.isEmpty()) {
            String start = settings.optString("coverageStart", "");
            String end = settings.optString("coverageEnd", "");
            boolean outside = (start.length() > 0 && key.compareTo(start) < 0) || (end.length() > 0 && key.compareTo(end) > 0);
            TextView empty = text(outside ? "这一天不在安装包课表范围内" : "这一天没有课程安排", 14, MUTED, false);
            empty.setPadding(0, dp(8), 0, dp(16));
            list.addView(empty);
        } else {
            for (Course course : matches) list.addView(card(course, date));
        }
    }

    private View card(Course course, LocalDate date) {
        LinearLayout card = column();
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE);
        background.setCornerRadius(dp(8));
        background.setStroke(dp(1), Color.rgb(220, 229, 225));
        card.setBackground(background);
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2);
        layout.bottomMargin = dp(10);
        card.setLayoutParams(layout);
        card.addView(text(course.name, 17, INK, true));
        card.addView(text(dateLabel(date), 12, MUTED, false));
        String time = course.pending ? "时间待确认 · " + course.timeNote : periodLabel(course) + " · " + timeLabel(course);
        TextView timeView = text(time, 14, ACCENT, true);
        timeView.setPadding(0, dp(6), 0, dp(4));
        card.addView(timeView);
        card.addView(text("地点：" + (course.room.length() == 0 ? "待补充" : course.room), 13, MUTED, false));
        card.addView(text("教师：" + (course.teacher.length() == 0 ? "未提供" : course.teacher), 13, MUTED, false));
        return card;
    }

    private String periodLabel(Course course) {
        return "第 " + course.start + (course.start == course.end ? "" : "–" + course.end) + " 节";
    }

    private String timeLabel(Course course) {
        if ((course.clock || course.end > 8) && course.sourceTime.length() > 0) return course.sourceTime.replace('-', '–');
        if (course.start >= 1 && course.end <= periods.length()) {
            JSONObject first = periods.optJSONObject(course.start - 1);
            JSONObject last = periods.optJSONObject(course.end - 1);
            if (first != null && last != null) return first.optString("start", "") + "–" + last.optString("end", "");
        }
        if (course.sourceTime.length() > 0) return course.sourceTime.replace('-', '–');
        return "上课时间待确认";
    }

    private void chooseDate() {
        DatePickerDialog picker = new DatePickerDialog(activity, new DatePickerDialog.OnDateSetListener() {
            @Override public void onDateSet(DatePicker view, int year, int month, int day) {
                selected = LocalDate.of(year, month + 1, day);
                render();
            }
        }, selected.getYear(), selected.getMonthValue() - 1, selected.getDayOfMonth());
        picker.setTitle("选择课表日期");
        picker.show();
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(activity);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
        return layout;
    }

    private LinearLayout row() {
        LinearLayout layout = new LinearLayout(activity);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
        return layout;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(activity);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private Button addButton(LinearLayout row, String title, String description, View.OnClickListener listener) {
        Button button = new Button(activity);
        button.setText(title);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setMinHeight(dp(48));
        button.setPadding(dp(4), 0, dp(4), 0);
        button.setContentDescription(description);
        button.setOnClickListener(listener);
        row.addView(button, new LinearLayout.LayoutParams(0, -2, 1));
        return button;
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    private static final class Course {
        final String name;
        final String room;
        final String teacher;
        final String sourceTime;
        final String timeNote;
        final boolean pending;
        final boolean clock;
        final int start;
        final int end;
        final Set<String> dates = new HashSet<String>();
        Course(JSONObject source) throws Exception {
            name = source.getString("name");
            room = source.optString("room", "");
            teacher = source.optString("teacher", "");
            sourceTime = source.optString("sourceTime", "");
            pending = "pending".equals(source.optString("timeMode", ""));
            clock = "clock".equals(source.optString("timeMode", ""));
            timeNote = source.optString("timeNote", "时间待确认");
            start = pending ? Integer.MAX_VALUE : source.getInt("start");
            end = pending ? Integer.MAX_VALUE : source.getInt("end");
            JSONArray records = source.getJSONArray("dates");
            for (int i = 0; i < records.length(); i++) {
                String date = records.getString(i);
                LocalDate.parse(date);
                dates.add(date);
            }
        }
    }
}
