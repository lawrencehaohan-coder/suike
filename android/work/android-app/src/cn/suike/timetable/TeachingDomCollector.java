package cn.suike.timetable;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Fixed bundled collector only. Never obtain JavaScript from a page, Intent, settings or network. */
public final class TeachingDomCollector {
    // The real DOM adapter and local merge preview are wired; release still requires device checks.
    public static final boolean ADAPTER_READY = true;
    private TeachingDomCollector() { }

    public static String readBundledScript(Context context) throws IOException { return readBundledScript(context, SchoolAdapterRegistry.defaultProfile()); }
    public static String readBundledScript(Context context, SchoolAdapterRegistry.Profile school) throws IOException {
        if(school==null||SchoolAdapterRegistry.find(school.id)!=school)throw new IOException("collector-profile-invalid");
        try (InputStream input = context.getAssets().open(school.collectorAsset)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (bytes.size() + count > 128 * 1024) throw new IOException("collector-too-large");
                bytes.write(buffer, 0, count);
            }
            if (bytes.size() == 0) throw new IOException("collector-unavailable");
            return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
