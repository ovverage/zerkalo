"""Original, silent exercise demonstrations. Requires rsvg-convert and ffmpeg.
Generated MP4/poster files are committed assets; not required for normal builds.
"""
from pathlib import Path
import math, subprocess, sys

OUT = Path('public/exercises')
OUT.mkdir(parents=True, exist_ok=True)
FPS, SECONDS = 20, 8
NAMES = {
 'squat':'Приседания', 'jumping-jack':'Jumping jacks', 'overhead-press':'Жим над головой',
 'lateral-raise':'Разведение рук', 'lunge':'Выпады', 'high-knees':'Подъём колен',
 'side-bend':'Наклоны в сторону', 'knee-to-elbow':'Колено к локтю',
 'overhead-squat':'Присед с руками вверху', 'push-up':'Отжимания', 'plank':'Планка',
}
SIDE = {'squat','lunge','push-up','plank'}

def ease(t): return (1-math.cos(math.pi*max(0,min(1,t))))/2

def motion(t):
 if t < 1.2: return 0, '01  ИСХОДНАЯ ПОЗА'
 if t < 3.2: return ease((t-1.2)/2), '02  ДВИЖЕНИЕ'
 if t < 4.2: return 1, '02  ДВИЖЕНИЕ'
 if t < 6.2: return 1-ease((t-4.2)/2), '03  ВОЗВРАТ'
 return 0, '01  ИСХОДНАЯ ПОЗА'

def interpolate(a,b,t): return tuple(x+(y-x)*t for x,y in zip(a,b))
def add(p,x,y): return p[0]+x,p[1]+y

def base():
 return dict(head=(400,109), ls=(363,155),rs=(437,155),lh=(376,269),rh=(424,269),
  le=(350,216),re=(450,216),lw=(346,276),rw=(454,276),
  lk=(367,342),rk=(433,342),la=(365,419),ra=(435,419))

def arm(p,side,elevation,bend=0):
 sign=-1 if side=='l' else 1
 s=p[side+'s']; a=math.radians(elevation)
 e=(s[0]+sign*61*math.sin(a),s[1]+61*math.cos(a))
 w=(e[0]+sign*59*math.sin(a+math.radians(bend)),e[1]+59*math.cos(a+math.radians(bend)))
 p[side+'e']=e; p[side+'w']=w

def elbow_between(a,b,length=69):
 dx,dy=b[0]-a[0],b[1]-a[1]; d=math.hypot(dx,dy)
 h=math.sqrt(max(0,length*length-d*d/4))
 return ((a[0]+b[0])/2+dy/max(d,1)*h,(a[1]+b[1])/2-dx/max(d,1)*h)

def figure(kind,q,t):
 p=base()
 if kind in {'squat','lunge'}:
  if kind=='squat':
   hip=(413-57*q,270+73*q); shoulder=add(hip,14+31*q,-114+9*q)
   knee=(444+32*q,345); ankle=(443,419)
  else:
   hip=(400,270+65*q); shoulder=add(hip,5,-112)
   knee=(442+39*q,344); ankle=(443+60*q,419)
  p.update(head=add(shoulder,1,-46),ls=shoulder,rs=add(shoulder,-12,-4),lh=hip,rh=add(hip,-12,-3),
    lk=knee,la=ankle,rk=add(knee,-12,-3),ra=add(ankle,-12,-3))
  if kind=='lunge':
   p['rk']=(365-26*q,343+59*q);p['ra']=(368-77*q,419)
  for s in ['l','r']:
   shoulder=p[s+'s']
   p[s+'e']=add(shoulder,35+34*q,39-27*q)
   p[s+'w']=add(p[s+'e'],35+19*q,35-33*q)
 elif kind in {'push-up','plank'}:
  shoulder=(307+7*q,284+67*q) if kind=='push-up' else (312,324)
  ankle=(656,419); hip=interpolate(shoulder,ankle,.48); knee=interpolate(shoulder,ankle,.77)
  p.update(head=add(shoulder,-42,-21),ls=shoulder,rs=add(shoulder,0,-10),lh=hip,rh=add(hip,0,-10),
    lk=knee,rk=add(knee,0,-10),la=ankle,ra=add(ankle,0,-10))
  if kind=='push-up':
   p['lw']=(306,419);p['le']=elbow_between(shoulder,p['lw'])
  else:
   p['le']=(308,419);p['lw']=(244,419)
  p['re']=add(p['le'],0,-10);p['rw']=add(p['lw'],0,-10)
 elif kind=='jumping-jack':
  for s in ['l','r']:
   arm(p,s,166*q)
   sign=-1 if s=='l' else 1
   p[s+'a']=(400+sign*(24+92*q),419)
   p[s+'k']=(400+sign*(23+63*q),343)
 elif kind=='overhead-press':
  for s in ['l','r']:
   sign=-1 if s=='l' else 1
   p[s+'e']=interpolate((400+sign*100,184),(400+sign*55,98),q)
   p[s+'w']=interpolate((400+sign*105,124),(400+sign*57,39),q)
 elif kind=='lateral-raise':
  for s in ['l','r']: arm(p,s,90*q)
 elif kind=='overhead-squat':
  for k in ['head','ls','rs','lh','rh']: p[k]=add(p[k],0,65*q)
  p['lk']=(367-26*q,342);p['rk']=(433+26*q,342)
  p['la']=(345,419);p['ra']=(455,419)
  for s in ['l','r']: arm(p,s,165)
 elif kind=='side-bend':
  sign=1 if t<4 else -1
  q=math.sin(math.pi*(t%4)/4)**2
  a=math.radians(26*q*sign)
  for k in ['head','ls','rs','le','re','lw','rw']:
   x,y=p[k][0]-400,p[k][1]-270
   p[k]=(400+x*math.cos(a)-y*math.sin(a),270+x*math.sin(a)+y*math.cos(a))
 elif kind in {'high-knees','knee-to-elbow'}:
  sign=-1 if t<4 else 1
  q=math.sin(math.pi*(t%4)/4)**2
  s='l' if sign<0 else 'r'; other='r' if sign<0 else 'l'
  p[s+'k']=interpolate(p[s+'k'],(400+sign*50,253),q)
  p[s+'a']=interpolate(p[s+'a'],(400+sign*72,329),q)
  if kind=='high-knees':
   for a in ['l','r']:
    sg=-1 if a=='l' else 1
    p[a+'e']=(400+sg*67,222);p[a+'w']=(400+sg*70,168+40*q*(1 if a==s else -1))
  else:
   p['le']=(304,182);p['re']=(496,182);p['lw']=(362,122);p['rw']=(438,122)
   p[other+'e']=interpolate(p[other+'e'],(400+sign*42,242),q)
   p[other+'w']=interpolate(p[other+'w'],(400+sign*3,156),q)
   for k in ['head','ls','rs']:p[k]=add(p[k],sign*16*q,18*q)
 return p

def svg(kind,t):
 q,label=motion(t)
 if kind=='plank': label='ДЕРЖИ ПОЗУ  •  ДЫШИ РОВНО'
 if kind in {'side-bend','high-knees','knee-to-elbow'}: label='ЧЕРЕДУЙ СТОРОНЫ  •  БЕЗ РЫВКОВ'
 p=figure(kind,q,t)
 parts=[]
 def line(a,b,color,width):
  parts.append(f'<path d="M {a[0]:.2f} {a[1]:.2f} L {b[0]:.2f} {b[1]:.2f}" stroke="{color}" stroke-width="{width}" stroke-linecap="round" fill="none"/>')
 def circle(v,r,color): parts.append(f'<circle cx="{v[0]:.2f}" cy="{v[1]:.2f}" r="{r}" fill="{color}"/>')
 # Far limbs first, then the torso and near limbs.
 for s in ['r','l']:
  color='#547c8e' if s=='r' else '#9cb7ce'
  line(p[s+'h'],p[s+'k'],color,24);line(p[s+'k'],p[s+'a'],color,21)
  footdir=1 if kind in SIDE else (-1 if s=='l' else 1)
  line(add(p[s+'a'],-5,2),add(p[s+'a'],footdir*20,2),'#e9f2f5',12)
  if s=='r':
   line(p['rs'],p['re'],'#288e95',21);line(p['re'],p['rw'],'#b89a87',17)
 points=' '.join(f'{p[k][0]:.2f},{p[k][1]:.2f}' for k in ['ls','rs','rh','lh'])
 if kind in SIDE:
  line(interpolate(p['ls'],p['rs'],.5),interpolate(p['lh'],p['rh'],.5),'#53d4c7',40)
 else:parts.append(f'<polygon points="{points}" fill="#53d4c7" stroke="#53d4c7" stroke-width="15" stroke-linejoin="round"/>')
 shoulder=interpolate(p['ls'],p['rs'],.5)
 line(shoulder,p['head'],'#f3c6a5',14)
 circle(p['head'],22,'#f3c6a5')
 hx,hy=p['head'];parts.append(f'<path d="M {hx-21:.2f} {hy-4:.2f} Q {hx-18:.2f} {hy-31:.2f} {hx+11:.2f} {hy-22:.2f} Q {hx+24:.2f} {hy-15:.2f} {hx+21:.2f} {hy-3:.2f} Q {hx+4:.2f} {hy-20:.2f} {hx-21:.2f} {hy-4:.2f}" fill="#263442"/>')
 for s in ['l'] if kind in SIDE else ['r','l']:
  line(p[s+'s'],p[s+'e'],'#64e1d0',21);line(p[s+'e'],p[s+'w'],'#f3c6a5',17);circle(p[s+'w'],10,'#f3c6a5')
 for k in (['le','lk'] if kind in SIDE else ['le','re','lk','rk']):circle(p[k],4,'#e9ffff')
 view='ВИД СБОКУ' if kind in SIDE else 'ВИД СПЕРЕДИ'
 return f'''<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
 <defs><radialGradient id="bg"><stop stop-color="#21354a"/><stop offset="1" stop-color="#101d2d"/></radialGradient></defs>
 <rect width="800" height="500" fill="url(#bg)"/><circle cx="402" cy="273" r="169" fill="none" stroke="#263d50"/>
 <path d="M80 433H720 M130 453H670" stroke="#314758"/>
 <ellipse cx="425" cy="431" rx="{'260' if kind in SIDE else '164'}" ry="15" fill="#0a1724"/>
 <rect x="32" y="29" width="292" height="32" rx="16" fill="#173d46"/>
 <text x="48" y="50" fill="#8ff5df" font-family="DejaVu Sans" font-size="13" font-weight="bold">{label}</text>
 <text x="763" y="49" text-anchor="end" fill="#c1d2e2" font-family="DejaVu Sans" font-size="12" letter-spacing="1">{view}</text>
 {''.join(parts)}
 <text x="32" y="475" fill="#b1c5d7" font-family="DejaVu Sans" font-size="13">Плавно · без рывков</text>
 <rect x="570" y="468" width="193" height="3" rx="2" fill="#30475b"/>
 <rect x="570" y="468" width="{max(1,t/SECONDS*193):.1f}" height="3" rx="2" fill="#69dfd0"/>
 </svg>'''

def build(kind):
 poster=svg(kind,0).encode()
 (OUT/f'{kind}.svg').write_bytes(poster)
 cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',str(FPS),'-i','pipe:0',
      '-an','-c:v','libx264','-preset','fast','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/f'{kind}.mp4')]
 proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
 try:
  for frame in range(FPS*SECONDS):
   png=subprocess.run(['rsvg-convert','-w','800','-h','500'],input=svg(kind,frame/FPS).encode(),stdout=subprocess.PIPE,check=True).stdout
   proc.stdin.write(png)
 finally: proc.stdin.close()
 if proc.wait(): raise RuntimeError(f'ffmpeg failed: {kind}')
 print(f'{kind}: {(OUT/f"{kind}.mp4").stat().st_size//1024} KB',flush=True)

if __name__=='__main__':
 for kind in (sys.argv[1:] or NAMES):build(kind)
