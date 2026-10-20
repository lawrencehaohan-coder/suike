"""Validate the one bundled catalog and generate the native registry. No network."""
from pathlib import Path
import json, re
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
CATALOG = json.loads((ROOT / 'schools.json').read_text(encoding='utf-8'))
FIELDS = {'id','name','status','protocol','entryUrl','vpnUrl','allowedHosts','capturePages','collectorAsset','captureSource','adapterVersion','system','maxSections','help','collectorLayout'}
assert set(CATALOG) == {'version','defaultSchool','schools'} and CATALOG['version'] == 1
assert 1 <= len(CATALOG['schools']) <= 500
ids, sources, systems = set(), set(), set()
for p in CATALOG['schools']:
    assert set(p) == FIELDS
    for key, seen in (('id',ids),('captureSource',sources),('system',systems)):
        assert re.fullmatch(r'[a-z][a-z0-9-]{0,39}', p[key]) and p[key] not in seen
        seen.add(p[key])
    assert p['collectorLayout'] in ('jwglxt','hhu-groups','jsxsd-grid')
    assert p['status'] in ('verified','trial') and p['protocol'] in ('jwglxt','jsxsd')
    assert p['adapterVersion'] == 1 and 8 <= p['maxSections'] <= 12
    assert 1 <= len(p['allowedHosts']) <= 20 and len(set(p['allowedHosts'])) == len(p['allowedHosts'])
    assert all(re.fullmatch(r'[a-z0-9.-]+\.edu\.cn', h) for h in p['allowedHosts'])
    for key in ('entryUrl','vpnUrl'):
        if p[key] is None:
            assert key == 'vpnUrl'
            continue
        u = urlparse(p[key]); assert u.scheme == 'https' and u.hostname in p['allowedHosts'] and not u.username and not u.password and u.port in (None,443)
    assert re.fullmatch(r'[a-z0-9-]+\.js',p['collectorAsset'])
    assert 1 <= len(p['capturePages']) <= 10
    for page in p['capturePages']:
        assert set(page) == {'host','path','webVpn'} and page['host'] in p['allowedHosts'] and type(page['webVpn']) is bool
        assert re.fullmatch(r'/[A-Za-z0-9/_-]+\.(?:html|do)',page['path'])
assert CATALOG['defaultSchool'] in ids

def q(value): return 'null' if value is None else json.dumps(value,ensure_ascii=False)
profiles=[]
for p in CATALOG['schools']:
    hosts=', '.join(q(h) for h in p['allowedHosts'])
    pages=', '.join('new CapturePage('+q(v['host'])+', '+q(v['path'])+', '+str(v['webVpn']).lower()+')' for v in p['capturePages'])
    profiles.append('        register(new Profile('+', '.join(q(p[k]) for k in ('id','name','protocol','entryUrl','vpnUrl','collectorAsset','captureSource','system','collectorLayout'))+', '+str(p['adapterVersion'])+', '+str(p['maxSections'])+', '+str(p['status']=='trial').lower()+', new String[]{'+hosts+'}, new CapturePage[]{'+pages+'}));')
code='''package cn.suike.timetable;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Generated from work/portal-import/schools.json. Never populated from Intents or the network. */
public final class SchoolAdapterRegistry {
    public static final String DEFAULT_SCHOOL = %s;
    private static final Map<String, Profile> PROFILES = new LinkedHashMap<>();
    static {
%s
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
''' % (q(CATALOG['defaultSchool']),'\n'.join(profiles))
target=ROOT.parent/'android-app/src/cn/suike/timetable/SchoolAdapterRegistry.java'
target.write_text(code,encoding='utf-8',newline='\n')
print(json.dumps({'schoolProfiles':len(profiles),'defaultSchool':CATALOG['defaultSchool'],'generated':target.name}))
