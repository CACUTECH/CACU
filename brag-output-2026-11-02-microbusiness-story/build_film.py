from pathlib import Path
import json,re,subprocess
r=Path(__file__).resolve().parent;p=r/'composition';d=p/'compositions';d.mkdir(exist_ok=True);timed=json.loads((r/'timed-scenes.json').read_text(encoding='utf-8'));visuals={s['id']:s for s in json.loads((r/'visual-scenes.json').read_text(encoding='utf-8'))};css=(r/'scene-style.css').read_text(encoding='utf-8');start=0;hosts=[];audio=[];sfx=[]
assert len(timed)==19 and all('duration' in x for x in timed),'Wait for every chapter narration to finish'
energy=json.loads((p/'assets/music-energy.json').read_text(encoding='utf-8'))
for i,t in enumerate(timed):
 s={**t,**visuals[t['id']]};ident=s['id'];dur=s['duration'];head=s['head'].replace('\n','<br>');sub=s['sub'];chapter=f'{i+1:02d} / 19';intro=s['id']=='evening'
 body=f'''<div class="brandbar"><img src="assets/mark.png"> CACU</div><div class="chapter">{chapter}</div><div class="left"><div class="label">{s['label']}</div><h1>{head}</h1><p class="sub">{sub}</p></div>{s['visual']}<div class="footer">{s['foot']}</div>'''
 motion=f"const tl=gsap.timeline({{paused:true}});tl.fromTo('#{ident}-content',{{opacity:{1 if intro else 0},y:{0 if intro else 12}}},{{opacity:1,y:0,duration:0.4,ease:'power2.out'}},0);"
 count=body.count('reveal');spacing=min(1.8,max(0.75,(dur-4)/max(count,1)))
 motion+=f"tl.fromTo('#{ident}-content .reveal',{{opacity:0,x:15}},{{opacity:1,x:0,duration:0.45,stagger:{spacing:.2f},ease:'power2.out'}},0.8);"
 if ident=='sale':motion+="tl.fromTo('#sale-button',{scale:1},{scale:0.98,duration:0.15,yoyo:true,repeat:1},5.2);"
 if s['kind']=='brand':motion+=f"tl.fromTo('#{ident}-content .hero-logo',{{scale:0.98}},{{scale:1,duration:1.4,ease:'power2.out'}},0.1);"
 if s['kind']=='brand':
  for tick in range(8,int(dur*5)):
   local=tick/5;frame=energy['frames'][int(((start+local)*energy['fps'])%len(energy['frames']))];amp=max(frame['bands'][:2]);motion+=f"tl.to('#{ident}-content .hero-logo',{{scale:{1+amp*0.008:.5f},duration:0.2,ease:'none'}},{local});"
 motion+=f"window.__timelines['{ident}']=tl;"
 html=f'<template><style>{css}</style><div id="root" data-composition-id="{ident}" data-width="1920" data-height="1080"><div class="content" id="{ident}-content" data-hold>{body}</div></div><script>{motion}</script></template>'
 (d/(ident+'.html')).write_text(html,encoding='utf-8');s['start']=round(start,2)
 hosts.append(f'<div id="{ident}" class="clip" data-composition-id="{ident}" data-composition-src="compositions/{ident}.html" data-start="{start:.2f}" data-duration="{dur}" data-width="1920" data-height="1080" data-track-index="1" data-track-kind="graphics"></div>')
 audio.append(f'<audio id="voice-{ident}" data-start="{start+0.35:.2f}" data-duration="{s["voice_duration"]}" data-track-index="11" data-volume="1" src="assets/voice-{ident}.wav"></audio>')
 if ident in ['brand','ledger','finish']:sfx.append(f'<audio id="sfx-{ident}" data-start="{start:.2f}" data-duration="0.11" data-track-index="12" data-volume="0.3" src="assets/drop.ogg"></audio>')
 if ident=='sale':sfx.append(f'<audio id="click-sale" data-start="{start+5.2:.2f}" data-duration="0.06" data-track-index="12" data-volume="0.4" src="assets/click.ogg"></audio>')
 timed[i]={**s,'visual':None};start=round(start+dur,2)
assert start>=180
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-stream_loop','-1','-i',str(p/'assets/music.mp3'),'-t',str(start),'-c:a','pcm_s16le',str(p/'assets/music-bed.wav')],check=True)
vars=[{'id':'color-ground','type':'color','label':'Background','default':'#F7F7F7'},{'id':'color-ink','type':'color','label':'Text','default':'#09006C'},{'id':'color-accent','type':'color','label':'Accent','default':'#5C40FF'}]
root='''<!doctype html><html lang="en" data-resolution="landscape" data-composition-variables='''+"'"+json.dumps(vars)+"'"+'''><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>*{margin:0;box-sizing:border-box}html,body{width:1920px;height:1080px;overflow:hidden;background:#F7F7F7}.clip{position:absolute;inset:0}#root{position:relative;width:1920px;height:1080px}</style></head><body>'''+f'<div id="root" data-composition-id="main" data-start="0" data-duration="{start}" data-width="1920" data-height="1080">'+''.join(hosts)+''.join(audio)+''.join(sfx)+f'<audio id="music" data-start="0" data-duration="{start}" data-track-index="10" data-volume="0.12" data-fade-in="0.7" data-fade-out="2" src="assets/music-bed.wav"></audio>'+'''</div><script>window.__timelines=window.__timelines||{};window.__timelines.main=gsap.timeline({paused:true});</script></body></html>'''
(p/'index.html').write_text(root,encoding='utf-8');(r/'timeline.json').write_text(json.dumps(timed,indent=2,ensure_ascii=False),encoding='utf-8')
(r/'share-copy.txt').write_text('A busy day should leave a clearer record. Follow an illustrative Nigerian shop owner from notebook uncertainty to connected sales, stock, invoices, bills and financial reports. CACU — Grow With Ease.',encoding='utf-8')
(r/'voiceover-script.md').write_text('# CACU — Grow With Ease\n\n'+'\n\n'.join(f"## {i+1}. {s['id']} — {s['start']:.2f}s\n{s['voice']}" for i,s in enumerate(timed)),encoding='utf-8')
print('Built',len(timed),'chapters; duration',start,'seconds.',flush=True)
