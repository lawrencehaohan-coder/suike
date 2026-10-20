"""Build the offline numeric-only face from the pinned OFL source (requires fontTools)."""
from pathlib import Path
import hashlib
import shutil
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'vendor/comfortaa/Comfortaa-Light.ttf'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == 'ecdc9d45e17fd24b66def307d139efe48a317ebb6dc929b5e7f697423610d062'
font = TTFont(SOURCE, recalcTimestamp=False)
cmap = font.getBestCmap()
width = max(font['hmtx'][cmap[ord(c)]][0] for c in '0123456789')
for c in '0123456789':
    name = cmap[ord(c)]
    advance, bearing = font['hmtx'][name]
    offset = (width - advance) // 2
    glyph = font['glyf'][name]
    assert not glyph.isComposite()
    glyph.coordinates.translate((offset, 0))
    glyph.recalcBounds(font['glyf'])
    font['hmtx'][name] = (width, bearing + offset)

options = subset.Options()
options.layout_features = []
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
builder = subset.Subsetter(options=options)
builder.populate(text='0123456789:.,/-%+\u2013\u2014\u2212')
builder.subset(font)
# Rename the derivative as required by the source's Reserved Font Name.
names = {1: 'Suike Numbers', 2: 'Regular', 3: 'Suike-Numbers-1.0',
         4: 'Suike Numbers', 6: 'SuikeNumbers-Regular', 16: 'Suike Numbers',
         17: 'Regular', 18: 'Suike Numbers'}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font['OS/2'].usWeightClass = 400
font['OS/2'].fsSelection = (font['OS/2'].fsSelection & ~0x21) | 0x40
font['head'].macStyle &= ~3
font['hhea'].ascent = font['OS/2'].sTypoAscender = 928
font['hhea'].descent = font['OS/2'].sTypoDescender = -244
font['hhea'].lineGap = font['OS/2'].sTypoLineGap = 0
font['OS/2'].usWinAscent = 1000
font['OS/2'].usWinDescent = 250
destination = ROOT / 'res/font/suike_numbers_regular.ttf'
destination.parent.mkdir(parents=True, exist_ok=True)
font.save(destination)
check = TTFont(destination)
assert set(check.getBestCmap()) == set(map(ord, '0123456789:.,/-%+\u2013\u2014\u2212'))
assert len({check['hmtx'][check.getBestCmap()[ord(c)]][0] for c in '0123456789'}) == 1
license_dir = ROOT / 'assets/licenses/fonts'
license_dir.mkdir(parents=True, exist_ok=True)
shutil.copyfile(ROOT / 'vendor/comfortaa/OFL.txt', license_dir / 'Suike-Numbers-OFL.txt')
print('Offline Suike Numbers built; source Light outlines retained; equal-width digits.')
