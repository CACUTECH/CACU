from pathlib import Path
import json,os,subprocess,shutil,wave
r=Path(__file__).resolve().parent;p=r/'composition';scenes=json.loads((r/'scenes.json').read_text(encoding='utf-8'));env={**os.environ,'HYPERFRAMES_PYTHON':str(r.parent/'brag-output-2026-11-02-brand-suite/.venv/Scripts/python.exe')}
for i,s in enumerate(scenes):
 script=r/(s['id']+'.txt');script.write_text(s['voice'],encoding='utf-8');output=p/'assets'/('voice-'+s['id']+'.wav')
 if not output.exists():
  result=subprocess.run([shutil.which('npx.cmd'),'--yes','hyperframes@0.9.0','tts',str(script),'--voice','af_heart','--speed','1','--output',str(output)],cwd=p,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace')
  (r/('tts-'+s['id']+'.log')).write_text(result.stdout,encoding='utf-8')
  if result.returncode:raise RuntimeError('Narration failed for '+s['id']+'; see chapter log')
 with wave.open(str(output)) as w:s['voice_duration']=round(w.getnframes()/w.getframerate(),3)
 s['duration']=max(11,round(s['voice_duration']+1.4,2))
 print(str(i+1)+'/'+str(len(scenes))+' '+s['id']+': '+str(s['voice_duration'])+'s',flush=True)
 (r/'timed-scenes.json').write_text(json.dumps(scenes,ensure_ascii=False,indent=2),encoding='utf-8')
print('TOTAL',round(sum(s['duration'] for s in scenes),2),'seconds',flush=True)
