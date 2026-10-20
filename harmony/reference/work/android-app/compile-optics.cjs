const fs=require('node:fs');
const path=require('node:path');
const esbuild=require('./tools/node_modules/esbuild');
const result=esbuild.buildSync({entryPoints:[path.join(__dirname,'vendor/liquid-glass-optics/src/maps.ts')],
  bundle:true,write:false,format:'iife',globalName:'SuikeGlassOpticsBundle',target:'chrome58',charset:'utf8'});
const notice='/*! Shape-matched optics from LeonardSEO/liquid-glass-react, Copyright (c) 2026 Leonard van Hemert, MIT. Full license and pinned source in vendor/liquid-glass-optics/. */\n';
fs.writeFileSync(path.join(__dirname,'liquid-optics.js'),notice+result.outputFiles[0].text+'\nwindow.SuikeGlassOptics=SuikeGlassOpticsBundle;\n','utf8');
