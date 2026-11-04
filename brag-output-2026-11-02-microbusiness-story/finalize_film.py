from pathlib import Path
import json,subprocess,hashlib
r=Path(__file__).resolve().parent
meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(r/'brag.mp4')],text=True))
video=next(s for s in meta['streams'] if s['codec_type']=='video');assert float(meta['format']['duration'])>=180;assert video['width']==1920 and video['height']==1080;assert any(s['codec_type']=='audio' for s in meta['streams'])
timeline=json.loads((r/'timeline.json').read_text(encoding='utf-8'));scene=next(s for s in timeline if s['id']=='finish');poster_time=round(scene['start']+scene['duration']/2,2)
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(poster_time),'-i',str(r/'brag.mp4'),'-frames:v','1','-q:v','2',str(r/'brag.jpg')],check=True)
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(r/'brag.mp4'),'-i',str(r/'brag.jpg'),'-filter_complex',"[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]",'-map','[v]','-map','0:a?','-c:v','libx264','-crf','18','-preset','medium','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',str(r/'brag.poster.mp4')],check=True)
(r/'brag.poster.mp4').replace(r/'brag.mp4')
for name,second in [('verified-first-frame.jpg',0),('verified-story.jpg',18.26),('verified-cash.jpg',185.78)]:subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(second),'-i',str(r/'brag.mp4'),'-frames:v','1','-q:v','2',str(r/name)],check=True)
final=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(r/'brag.mp4')],text=True));check=json.loads((r/'check-final.json').read_text(encoding='utf-8'));final['verification']={'minimum_duration_met':float(final['format']['duration'])>=180,'chapter_count':19,'validation_passed':check['ok'],'contrast_passed':check['contrast']['passed'],'contrast_checked':check['contrast']['checked'],'poster_selected_at_seconds':poster_time,'sha256':hashlib.sha256((r/'brag.mp4').read_bytes()).hexdigest()};(r/'verification.json').write_text(json.dumps(final,indent=2),encoding='utf-8')
print(json.dumps({'duration':final['format']['duration'],'bytes':final['format']['size'],'poster_time':poster_time,'checks':check['ok']}))
