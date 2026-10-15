"""Trace the owner's supplied owl into a monochrome SVG; build-time tools not required.
Requires ImageMagick only when deliberately regenerating this checked-in vector.
"""
from pathlib import Path
import subprocess
import math

root = Path(__file__).resolve().parent.parent
raw = subprocess.check_output(['convert', str(root/'branding/haunt/source/logo-original.png'),
    '-resize', '256x256!', '-background', 'black', '-alpha', 'remove', '-colorspace', 'Gray',
    '-threshold', '25%', '-morphology', 'Dilate', 'Disk:0.6', '-depth', '8', 'gray:-'])
w = 256
assert len(raw) == w*w
edges = {}
def add(a,b): edges.setdefault(a,[]).append(b)
for y in range(w):
    for x in range(w):
        if raw[y*w+x] < 128: continue
        if y == 0 or raw[(y-1)*w+x] < 128: add((x,y),(x+1,y))
        if x == w-1 or raw[y*w+x+1] < 128: add((x+1,y),(x+1,y+1))
        if y == w-1 or raw[(y+1)*w+x] < 128: add((x+1,y+1),(x,y+1))
        if x == 0 or raw[y*w+x-1] < 128: add((x,y+1),(x,y))
def simplify(points, tolerance=.65):
    if len(points)<3: return points
    a,b=points[0],points[-1]
    dx,dy=b[0]-a[0],b[1]-a[1]
    norm=math.hypot(dx,dy)
    distances=[abs(dx*(a[1]-p[1])-(a[0]-p[0])*dy)/norm if norm else math.dist(a,p) for p in points]
    furthest=max(range(len(points)), key=lambda i:distances[i])
    if distances[furthest]<=tolerance: return [a,b]
    return simplify(points[:furthest+1],tolerance)[:-1]+simplify(points[furthest:],tolerance)
paths=[]
while edges:
    first=next(iter(edges)); points=[first]; at=first
    while True:
        next_point=edges[at].pop()
        if not edges[at]: del edges[at]
        at=next_point; points.append(at)
        if at==first: break
    area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:])))/2
    if area<5: continue
    points=simplify(points)
    paths.append('M'+'L'.join(f'{x} {y}' for x,y in points[:-1])+'Z')
svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="#fff" fill-rule="evenodd" d="'+' '.join(paths)+'"/></svg>\n'
for destination in [root/'static/notification-mark.svg',root/'apps/web/public/brand/notification-mark.svg']:
    destination.write_text(svg)
print(f'Traced {len(paths)} contours; {len(svg)} bytes, white paths and transparent negative space.')
