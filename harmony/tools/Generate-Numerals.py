"""Generate card SVG glyphs from the bundled numeric face, without font registration."""
from pathlib import Path
import json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
root=Path(__file__).resolve().parents[1]
font=TTFont(root/'entry/src/main/resources/rawfile/fonts/suike_numbers_regular.ttf')
glyphs=font.getGlyphSet();cmap=font.getBestCmap();units=font['head'].unitsPerEm
folder=root/'entry/src/main/resources/rawfile/numerals';folder.mkdir(exist_ok=True)
assets=[];widths=[]
for char in '0123456789:.-–/%+':
 name=cmap[ord(char)];pen=SVGPathPen(glyphs);glyphs[name].draw(pen);advance=font['hmtx'][name][0]
 filename='glyph_'+str(ord(char))+'.svg'
 svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+str(advance)+' 1172"><path transform="translate(0 928) scale(1 -1)" fill="#202020" d="'+pen.getCommands()+'"/></svg>\n'
 (folder/filename).write_text(svg,encoding='utf-8')
 assets.append(json.dumps(char,ensure_ascii=False)+": $rawfile('numerals/"+filename+"')")
 widths.append(json.dumps(char,ensure_ascii=False)+': '+str(round(advance/units,6)))
(root/'entry/src/main/ets/cards/NumeralAssets.ets').write_text("// Glyph outlines from the bundled Suike Numbers face; retain its OFL license.\nexport const NUMERAL_ASSETS: Record<string, Resource> = {"+','.join(assets)+"};\nexport const NUMERAL_WIDTHS: Record<string, number> = {"+','.join(widths)+"};\n",encoding='utf-8')
print('Generated',len(assets),'SVG glyphs. License: rawfile/licenses/fonts/Suike-Numbers-OFL.txt')
