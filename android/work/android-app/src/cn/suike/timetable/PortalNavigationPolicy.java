package cn.suike.timetable;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Pure Java policy. No suffix matching, guessed WebVPN hosts or cleartext fallback. */
public final class PortalNavigationPolicy {
    public static final String ENTRY_URL = SchoolAdapterRegistry.defaultProfile().entryUrl;
    public static final String VPN_ENTRY_URL = SchoolAdapterRegistry.defaultProfile().vpnUrl;

    private PortalNavigationPolicy() { }

    // Legacy callers retain only the original school, never a union of all hosts.
    public static boolean isAllowedHttps(String value) { return isAllowedHttps(SchoolAdapterRegistry.defaultProfile(), value); }
    public static String origin(String value) { return origin(SchoolAdapterRegistry.defaultProfile(), value); }
    public static boolean isCaptureOrigin(String value) { return isCaptureOrigin(SchoolAdapterRegistry.defaultProfile(), value); }
    public static boolean isCapturePage(String value) { return isCapturePage(SchoolAdapterRegistry.defaultProfile(), value); }
    public static boolean sameAllowedOrigin(String first, String second) { return sameAllowedOrigin(SchoolAdapterRegistry.defaultProfile(), first, second); }
    public static boolean isAllowedHttps(SchoolAdapterRegistry.Profile school, String value) { return origin(school, value) != null; }

    /** Returns a canonical origin only for an explicitly observed HTTPS host. */
    public static String origin(SchoolAdapterRegistry.Profile school, String value) {
        if (school == null || SchoolAdapterRegistry.find(school.id) != school || value == null || value.length() > 8192 || value.indexOf('\\') >= 0) return null;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c <= 0x20 || c == 0x7f) return null;
        }
        try {
            URI uri = new URI(value);
            if (uri.isOpaque() || !"https".equalsIgnoreCase(uri.getScheme()) ||
                    uri.getRawUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return null;
            String host = uri.getHost();
            if (host == null) return null;
            host = host.toLowerCase(Locale.ROOT);
            return school.allowedHosts.contains(host) ? "https://" + host : null;
        } catch (URISyntaxException error) { return null; }
    }

    public static boolean isCaptureOrigin(SchoolAdapterRegistry.Profile school, String value) {
        String origin = origin(school, value);
        if (origin == null) return false;
        for (SchoolAdapterRegistry.CapturePage page : school.capturePages)
            if (origin.equals("https://" + page.host)) return true;
        return false;
    }

    /** Observed personal timetable suffix; WebVPN's mapping prefix must not be hardcoded. */
    public static boolean isCapturePage(SchoolAdapterRegistry.Profile school, String value) {
        String current = origin(school, value);
        if (current == null) return false;
        try {
            URI uri = new URI(value);
            String path = uri.getRawPath();
            if (path == null) return false;
            for (SchoolAdapterRegistry.CapturePage page : school.capturePages) {
                if (!current.equals("https://" + page.host)) continue;
                if (!page.webVpn && page.path.equals(path)) return true;
                if (page.webVpn && path.startsWith("/http/") && path.endsWith(page.path) &&
                        path.length() > 6 + page.path.length() &&
                        path.substring(6, path.length() - page.path.length()).matches("[A-Za-z0-9_-]{1,256}")) return true;
            }
            return false;
        } catch (URISyntaxException error) { return false; }
    }

    public static boolean sameAllowedOrigin(SchoolAdapterRegistry.Profile school, String first, String second) {
        String firstOrigin = origin(school, first);
        return firstOrigin != null && firstOrigin.equals(origin(school, second));
    }
}
