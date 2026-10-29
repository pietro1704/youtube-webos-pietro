const { waitForDevToolsPort } = require('./chromium-ready.cjs');
// Generated tone fixture: ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000:duration=1
// -c:a libopus -b:a 32k timeline-tone.webm
// Generated black 64x64 H.264 fixture; no external network or TV required.
// ffmpeg -f lavfi -i color=c=black:s=64x64:r=30 -t 4 -an -c:v libx264
// -profile:v baseline -pix_fmt yuv420p -movflags +frag_keyframe+empty_moov+default_base_moof -g 30 fixture.mp4
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
const chrome = [process.env.CHROME_BIN, '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => p && fs.existsSync(p));
assert.ok(chrome, 'An installed Chromium/Chrome binary is required');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ytaf-native-track-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, socket;
const fixture = `<!doctype html><video id="video" muted></video><script type="module">
import { installMseHook } from '/src/speed/mse-hook.js';
import { silentAacBase64 } from '/src/speed/silent-aac.js';
import { AudioEngine } from '/src/speed/audio-engine.js';
import { audioConfigFromWebmInit, demuxClusters, findTimecodeScale } from '/src/speed/containers.js';
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const once=(target,name)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(name+' timeout')),8000);target.addEventListener(name,e=>{clearTimeout(timer);resolve(e)},{once:true})});
async function audioTimelineGaps(){
 const bytes=new Uint8Array(await(await fetch('/bench/fixtures/timeline-tone.webm')).arrayBuffer());
 const cfg=audioConfigFromWebmInit(bytes);
 const frames=demuxClusters(bytes,{timecodeScale:findTimecodeScale(bytes).value,trackNumber:cfg.trackNumber}).frames;
 const errors=[],v=Object.assign(new EventTarget(),{currentTime:0,paused:false,volume:1,muted:false});
 const engine=new AudioEngine({win:window,speed:2,onError:e=>errors.push(e.message)});
 try{
  engine.attachVideo(v);engine.configure(cfg);
  for(let i=0;i<100&&!engine.decoder;i++)await wait(10);
  check(!!engine.decoder,'real Opus decoder configured');
  const results=[];
  for(const offset of [0,10,20]){
   const before=engine.scheduledFrames;
   v.currentTime=offset;
   engine.push(frames.map(f=>({...f,pts:f.pts+offset,duration:0.02})));
   for(let i=0;i<100&&(engine.configPending||!engine.decoder||engine.decoder.decodeQueueSize);i++)await wait(10);
   await wait(40);
   const last=engine.pcm.at(-1);
   check(last&&last.t>=offset,'decoded PCM follows the new packet timeline after gap '+offset+': '+last?.t);
   v.currentTime=offset+0.1;engine.tick();
   check(engine.scheduledFrames>before,'nonzero PCM is scheduled after gap '+offset+': '+JSON.stringify({inPos:engine.inPos,nextWhen:engine.nextWhen,now:engine.ctx.currentTime,anchor:engine.anchorPending,last:last.t,pcm:engine.pcm.length}));
   results.push({offset,last:last.t});
  }
  check(errors.length===0,'decoder errors: '+errors.join(','));
  return results;
 }finally{engine.destroy()}
}
window.__testDone=(async()=>{
 const errors=[],sinks=[];let speed=2;
 const nativeBuffers=Object.getOwnPropertyDescriptor(MediaSource.prototype,'sourceBuffers').get;
 const hook=installMseHook(window,{getSpeed:()=>speed,onError:e=>errors.push(e.message),onRateRequest(){},
  createAudioSink(options){check(!options.createNativeAudioSource,'must not create a second native player');const sink={destroyed:false,configure(){},push(){check(!this.destroyed,'push to retired sink')},reset(){},discard(){},destroy(){this.destroyed=true}};sinks.push(sink);return sink;}});
 const video=document.getElementById('video');
 const bytes=new Uint8Array(await(await fetch('/bench/fixtures/native-track-video.mp4')).arrayBuffer());
 const audio=Uint8Array.from(atob(silentAacBase64),c=>c.charCodeAt(0));
 async function append(sb,data){const done=once(sb,'updateend');sb.appendBuffer(data);await done;}
 async function load(){
  const ms=new MediaSource(),url=URL.createObjectURL(ms);const opened=once(ms,'sourceopen');video.src=url;await opened;
  URL.revokeObjectURL(url); // Attached playback must survive releasing the URL registry entry.
  const a=ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  const v=ms.addSourceBuffer('video/mp4; codecs="avc1.42c00a"');
  check(nativeBuffers.call(ms).length===2,'real native video and audio buffers');
  check(ms.sourceBuffers.length===2&&ms.sourceBuffers.item(0)===a&&ms.sourceBuffers.item(1)===v,'public buffer identity/order');
  await Promise.all([append(v,bytes),append(a,audio)]);
  a.timestampOffset=2.021333333333333;await append(a,audio);
  ms.endOfStream();await video.play();return {ms,url,a,v};
 }
 try{
  const first=await load();
  const physicalTime=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime').get;
  const physicalDuration=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'duration').get;
  check(Math.abs(physicalDuration.call(video)-2.026666)<0.03,'native duration is halved for 2x');
  const begin=video.currentTime;await wait(600);const advanced=video.currentTime-begin;
  check(advanced>0.2,'real A/V playback must advance');
  check(Math.abs(video.currentTime-physicalTime.call(video)*2)<0.01,'content clock is twice the physical clock');
  check(video.readyState>=3,'native A/V ready');check(first.ms.activeSourceBuffers[0]===first.a,'active buffer identity');check(document.querySelectorAll('audio').length===0,'no sidecar native element');
  const seeked=once(video,'seeked');video.currentTime=2.5;await seeked;check(Math.abs(video.currentTime-2.5)<0.1,'seek mapped exactly once');
  speed=1.5;const second=await load();await wait(300);
  check(sinks[0].destroyed,'replaced source releases only its sink');check(!sinks[1].destroyed,'replacement sink stays active');
  check(video.playbackRate===1.5,'replacement identity has its own rate');
  check(errors.length===0,'no decode/buffer errors: '+errors.join(','));
  video.pause();second.ms.removeSourceBuffer(second.a);check(second.ms.sourceBuffers.length===1,'native audio removed');check(sinks[1].destroyed,'removed audio releases sink');let rejected=false;try{second.a.appendBuffer(audio)}catch(e){rejected=e.name==='InvalidStateError'}check(rejected,'retired buffer rejects append');video.removeAttribute('src');video.load();await wait(100);
  URL.revokeObjectURL(first.url);URL.revokeObjectURL(second.url);
  check(sinks[1].destroyed,'detach releases current sink');
  const audioTimeline=await audioTimelineGaps();
  return {advanced,sourceBuffers:2,seek:true,replacement:true,errors,audioTimeline};
 }finally{hook.uninstall();}
})().then(result=>window.__testResult={result},error=>window.__testResult={error:error.stack});
</script>`;
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
  const target = path.resolve(root, '.' + req.url);
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : 'video/mp4'); res.end(fs.readFileSync(target));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  browser = spawn(chrome, ['--headless','--mute-audio','--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'], {stdio:['ignore','ignore','pipe']});
  let diagnostic='';browser.stderr.on('data',data=>{diagnostic=(diagnostic+data).slice(-4000)});
  const port = await waitForDevToolsPort(profile, browser).catch(error => { throw new Error(error.message + ': ' + diagnostic); });
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j)});
  let id=0;const pending=new Map();socket.on('message',raw=>{const m=JSON.parse(raw),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(Error(method+' timeout')),20000);pending.set(n,{resolve,reject,timer});socket.send(JSON.stringify({id:n,method,params}))});
  await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  let result;
  for(let i=0;i<200;i++){const r=await call('Runtime.evaluate',{expression:'window.__testResult',returnByValue:true});result=r.result?.value;if(result)break;await wait(100)}
  assert.ok(result,'browser test completed');assert.ok(!result.error,result.error);console.log('PASS native audio track real-browser playback, seek and replacement',result.result);
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
  socket?.close();if(browser&&browser.exitCode===null){browser.kill();await new Promise(r=>browser.once('exit',r))}server.close();fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
});
