#!/usr/bin/env python3
"""Export the approved logo without redrawing, recoloring, cropping or sharpening.

Requires Pillow. Run from any directory. Source is bundled in ../source/.
This script produces image assets only; it does not build or modify an app.
"""
from pathlib import Path
from PIL import Image
import hashlib
import json
import math
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'source/logo-original.png'
BLACK = '#060609'

def save(im, relative):
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path)

def export():
    original = Image.open(SOURCE).convert('RGBA')
    if original.size != (3762, 3762):
        raise ValueError('Expected the approved 3762 x 3762 original')
    def resized(size):
        return original.resize((size, size), Image.Resampling.LANCZOS)
    # Scaling and alpha compositing only. Complete original canvas retained.
    # Use the alpha bounding rectangle as a conservative radial bound so even
    # the faintest original edge lies inside a platform's safe circle.
    x0, y0, x1, y1 = original.getchannel('A').getbbox()
    center = original.width / 2
    radius = max(math.hypot(x-center, y-center)
                 for x in (x0, x1) for y in (y0, y1))
    def placed(size, safe_radius=None, fraction=1.0, opaque=False):
        side = round(size*fraction)
        if safe_radius is not None:
            side = math.floor((safe_radius*size-3)*original.width/radius)
        tile = Image.new('RGBA', (size,size), BLACK if opaque else (0,0,0,0))
        tile.alpha_composite(resized(side), ((size-side)//2, (size-side)//2))
        return tile.convert('RGB') if opaque else tile

    for size in [16,20,24,32,40,48,64,96,128,192,256,384,512,1024,2048]:
        save(resized(size), f'png/logo-{size}.png')
    for size in [16,32,48]:
        save(resized(size), f'web/favicon-{size}.png')
    save(resized(192), 'web/icon-192.png')
    save(resized(512), 'web/icon-512.png')
    save(placed(180, fraction=.9, opaque=True), 'web/apple-touch-icon.png')
    for size in [192,512]:
        save(placed(size, safe_radius=.4, opaque=True), f'web/icon-maskable-{size}.png')
    resized(256).save(ROOT/'web/favicon.ico', sizes=[(s,s) for s in [16,32,48]])
    save(resized(1024), 'desktop/icon.png')
    resized(1024).save(ROOT/'desktop/icon.icns', format='ICNS')
    resized(256).save(ROOT/'desktop/icon.ico', sizes=[(s,s) for s in [16,24,32,48,64,128,256]])
    for size in [16,24,32,48,64,128,256,512,1024]:
        save(resized(size), f'desktop/linux/{size}x{size}.png')
    for points in [16,32,128,256,512]:
        for scale in [1,2]:
            suffix = '@2x' if scale==2 else ''
            save(resized(points*scale), f'desktop/icon.iconset/icon_{points}x{points}{suffix}.png')
    for density,scale in [('mdpi',1),('hdpi',1.5),('xhdpi',2),('xxhdpi',3),('xxxhdpi',4)]:
        save(placed(round(48*scale), safe_radius=.46, opaque=True), f'android/res/mipmap-{density}/ic_launcher.png')
        save(placed(round(108*scale), safe_radius=33/108), f'android/res/drawable-{density}/ic_launcher_foreground.png')
    save(placed(512, fraction=.82, opaque=True), 'android/play-store-512.png')
    values=ROOT/'android/res/values';values.mkdir(parents=True,exist_ok=True)
    (values/'colors.xml').write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">#060609</color>\n</resources>\n')
    adaptive=ROOT/'android/res/mipmap-anydpi-v26';adaptive.mkdir(parents=True,exist_ok=True)
    (adaptive/'ic_launcher.xml').write_text('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/ic_launcher_background" />\n  <foreground android:drawable="@drawable/ic_launcher_foreground" />\n</adaptive-icon>\n')
    manifest={
        'name':'Haunt','short_name':'Haunt',
        'description':'Self-hosted community messaging and calls.',
        'start_url':'./','scope':'./','display':'standalone',
        'background_color':BLACK,'theme_color':BLACK,
        'icons':[
            {'src':f'icon-{s}.png','sizes':f'{s}x{s}','type':'image/png','purpose':'any'} for s in [192,512]
        ]+[
            {'src':f'icon-maskable-{s}.png','sizes':f'{s}x{s}','type':'image/png','purpose':'maskable'} for s in [192,512]
        ]}
    (ROOT/'web/site.webmanifest').write_text(json.dumps(manifest,indent=2)+'\n')
    rows=[]
    for path in sorted(ROOT.rglob('*')):
        if path.is_file() and path.suffix.lower() in {'.png','.ico','.icns'}:
            with Image.open(path) as im:
                row={'path':str(path.relative_to(ROOT)), 'width':im.width,'height':im.height,'mode':im.mode,
                     'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
                if path.suffix=='.ico': row['embedded_sizes']=sorted([list(s) for s in im.ico.sizes()])
                if path.suffix=='.icns': row['embedded_sizes']=[list(s) for s in im.info.get('sizes',[])]
                rows.append(row)
    (ROOT/'asset-manifest.json').write_text(json.dumps({'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'method':'Original canvas, Lanczos downsampling, format conversion; black backing/padding only for platform tiles. No artwork edits.',
        'assets':rows},indent=2)+'\n')
    print(f'Exported {len(rows)} image files to {ROOT}')

if __name__=='__main__':
    export()
