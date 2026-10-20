package cn.suike.timetable;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Generated from work/portal-import/schools.json. Never populated from Intents or the network. */
public final class SchoolAdapterRegistry {
    public static final String DEFAULT_SCHOOL = "just";
    private static final Map<String, Profile> PROFILES = new LinkedHashMap<>();
    static {
        register(new Profile("just", "江苏科技大学", "jwglxt", "https://ids.v.just.edu.cn/", "https://ids.v.just.edu.cn/", "teaching-collector.js", "just-jwglxt-table", "just-jwglxt", "jwglxt", 1, 10, false, new String[]{"my.just.edu.cn", "ids2.just.edu.cn", "ids.v.just.edu.cn", "client.v.just.edu.cn", "jwxt.just.edu.cn"}, new CapturePage[]{new CapturePage("jwxt.just.edu.cn", "/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html", false), new CapturePage("client.v.just.edu.cn", "/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html", true)}));
        register(new Profile("hhu", "河海大学", "jsxsd", "https://my.hhu.edu.cn/portal-web/", null, "hhu-teaching-collector.js", "hhu-jsxsd-table", "hhu-jsxsd", "hhu-groups", 1, 12, true, new String[]{"my.hhu.edu.cn", "authserver.hhu.edu.cn", "jwxt.hhu.edu.cn"}, new CapturePage[]{new CapturePage("jwxt.hhu.edu.cn", "/jsxsd/xskb/xskb_list.do", false)}));
        register(new Profile("njust", "南京理工大学（本科）", "jsxsd", "https://webvpn.njust.edu.cn/", null, "njust-teaching-collector.js", "njust-jsxsd-table", "njust-jsxsd", "jsxsd-grid", 1, 12, true, new String[]{"webvpn.njust.edu.cn", "ids.njust.edu.cn", "portal.njust.edu.cn"}, new CapturePage[]{new CapturePage("webvpn.njust.edu.cn", "/njlgdx/xskb/xskb_list.do", true)}));
    }
    private SchoolAdapterRegistry() { }
    private static void register(Profile profile) { PROFILES.put(profile.id, profile); }
    public static Profile find(String id) { return PROFILES.get(id); }
    public static Profile defaultProfile() { return find(DEFAULT_SCHOOL); }
    public static Profile byCaptureSource(String source) {
        for (Profile profile : PROFILES.values()) if (profile.captureSource.equals(source)) return profile;
        return null;
    }
    public static final class Profile {
        public final String id, name, protocol, entryUrl, vpnUrl, collectorAsset, captureSource, system, collectorLayout;
        public final int adapterVersion, maxSections;
        public final boolean trial;
        public final List<String> allowedHosts;
        public final List<CapturePage> capturePages;
        private Profile(String id, String name, String protocol, String entryUrl, String vpnUrl, String collectorAsset, String captureSource, String system, String collectorLayout, int adapterVersion, int maxSections, boolean trial, String[] hosts, CapturePage[] pages) {
            this.id=id; this.name=name; this.protocol=protocol; this.entryUrl=entryUrl; this.vpnUrl=vpnUrl;
            this.collectorAsset=collectorAsset; this.captureSource=captureSource; this.system=system; this.collectorLayout=collectorLayout;
            this.adapterVersion=adapterVersion; this.maxSections=maxSections; this.trial=trial;
            allowedHosts=Collections.unmodifiableList(Arrays.asList(hosts));
            capturePages=Collections.unmodifiableList(Arrays.asList(pages));
        }
    }
    public static final class CapturePage {
        public final String host, path;
        public final boolean webVpn;
        private CapturePage(String host, String path, boolean webVpn) { this.host=host; this.path=path; this.webVpn=webVpn; }
    }
}
