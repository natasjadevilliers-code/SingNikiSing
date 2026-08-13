
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  audioCtx: null,
  analyser: null,
  stream: null,
  micEnabled: false,
  liveMidi: null,
  liveCents: null,
  liveHz: 0,
  targetMidi: 57,
  rangeLow: null,
  rangeHigh: null,
  testingRange: null,
  rangeObserved: [],
  earDirection: null,
  intervalTarget: null,
  progress: JSON.parse(localStorage.getItem('singwiseProgress') || '{"sessions":0,"bestPitch":0,"history":[],"rangeLow":null,"rangeHigh":null,"streak":0,"lastDate":null}')
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);
const midiToName = m => NOTE_NAMES[((Math.round(m)%12)+12)%12] + (Math.floor(Math.round(m)/12)-1);
const freqToMidi = f => 69 + 12 * Math.log2(f/440);

function saveProgress(){
  localStorage.setItem('singwiseProgress', JSON.stringify(state.progress));
  refreshProgress();
}
function markSession(label, extra=''){
  const today = new Date().toISOString().slice(0,10);
  if(state.progress.lastDate !== today){
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
    state.progress.streak = state.progress.lastDate === yesterday ? (state.progress.streak||0)+1 : 1;
    state.progress.lastDate = today;
  }
  state.progress.sessions = (state.progress.sessions||0)+1;
  state.progress.history.unshift({date:new Date().toLocaleString(),label,extra});
  state.progress.history = state.progress.history.slice(0,30);
  saveProgress();
}
function refreshProgress(){
  const p = state.progress;
  $('#homeSessions').textContent = p.sessions || 0;
  $('#totalSessions').textContent = p.sessions || 0;
  $('#homeStreak').textContent = `${p.streak||0} day${p.streak===1?'':'s'}`;
  $('#bestPitch').textContent = p.bestPitch ? `${p.bestPitch}%` : '—';
  $('#homeScore').textContent = p.bestPitch ? `${p.bestPitch}%` : '—';
  const rr = p.rangeLow!=null && p.rangeHigh!=null ? `${midiToName(p.rangeLow)}–${midiToName(p.rangeHigh)}` : 'Not tested';
  $('#homeRange').textContent = rr;
  $('#savedRange').textContent = rr;
  $('#history').innerHTML = (p.history||[]).length ? p.history.map(h=>`<div class="history-item"><b>${h.label}</b><br><small>${h.date}${h.extra?` · ${h.extra}`:''}</small></div>`).join('') : '<p>No sessions yet.</p>';
}

$$('.tab').forEach(btn=>btn.onclick=()=>showScreen(btn.dataset.screen));
$$('[data-go]').forEach(btn=>btn.onclick=()=>showScreen(btn.dataset.go));
function showScreen(id){
  $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.screen===id));
  $$('.screen').forEach(x=>x.classList.toggle('active',x.id===id));
}

async function enableMic(){
  try{
    state.audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
    await state.audioCtx.resume();
    state.stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const src = state.audioCtx.createMediaStreamSource(state.stream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 4096;
    src.connect(state.analyser);
    state.micEnabled = true;
    $('#micBtn').textContent = 'Microphone on';
    $('#micBtn').disabled = true;
    requestAnimationFrame(pitchLoop);
  }catch(e){
    alert('Microphone access is needed for live pitch coaching. Open the app over HTTPS and allow microphone permission.');
  }
}
$('#micBtn').onclick=enableMic;

function autoCorrelate(buf, sampleRate){
  let SIZE = buf.length, rms = 0;
  for(let i=0;i<SIZE;i++) rms += buf[i]*buf[i];
  rms = Math.sqrt(rms/SIZE);
  if(rms < 0.01) return -1;
  let r1=0,r2=SIZE-1,thres=.2;
  for(let i=0;i<SIZE/2;i++){ if(Math.abs(buf[i])<thres){r1=i;break;} }
  for(let i=1;i<SIZE/2;i++){ if(Math.abs(buf[SIZE-i])<thres){r2=SIZE-i;break;} }
  buf = buf.slice(r1,r2); SIZE=buf.length;
  const c=new Array(SIZE).fill(0);
  for(let i=0;i<SIZE;i++) for(let j=0;j<SIZE-i;j++) c[i]+=buf[j]*buf[j+i];
  let d=0; while(c[d]>c[d+1]) d++;
  let max=-1,maxpos=-1;
  for(let i=d;i<SIZE;i++) if(c[i]>max){max=c[i];maxpos=i;}
  let T0=maxpos;
  const x1=c[T0-1]||c[T0], x2=c[T0], x3=c[T0+1]||c[T0];
  const a=(x1+x3-2*x2)/2, b=(x3-x1)/2;
  if(a) T0 -= b/(2*a);
  return sampleRate/T0;
}

let smoothMidi = [];
function pitchLoop(){
  if(!state.analyser) return;
  const buf = new Float32Array(state.analyser.fftSize);
  state.analyser.getFloatTimeDomainData(buf);
  const f = autoCorrelate(buf, state.audioCtx.sampleRate);
  if(f>70 && f<1400){
    const midi = freqToMidi(f);
    smoothMidi.push(midi); if(smoothMidi.length>5) smoothMidi.shift();
    const sm = smoothMidi.slice().sort((a,b)=>a-b)[Math.floor(smoothMidi.length/2)];
    const nearest = Math.round(sm);
    const cents = (sm-nearest)*100;
    state.liveMidi=nearest; state.liveCents=cents; state.liveHz=f;
    $('#liveNote').textContent = midiToName(nearest);
    $('#liveFreq').textContent = `${f.toFixed(1)} Hz`;
    $('#needle').style.left = `${Math.max(0,Math.min(100,50+cents/2))}%`;
    if(Math.abs(cents)<=10) $('#pitchFeedback').textContent='Excellent — centered on the note.';
    else if(cents<0) $('#pitchFeedback').textContent=`About ${Math.abs(cents).toFixed(0)} cents flat. Let the pitch rise slightly.`;
    else $('#pitchFeedback').textContent=`About ${cents.toFixed(0)} cents sharp. Release down slightly.`;

    scoreTarget(nearest,cents);
    observeRange(nearest,cents);
    scoreInterval(nearest,cents);
  }
  requestAnimationFrame(pitchLoop);
}

function playTone(midi,duration=.65,delay=0){
  state.audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
  const t = state.audioCtx.currentTime + delay;
  const o = state.audioCtx.createOscillator(), g = state.audioCtx.createGain();
  o.type='sine'; o.frequency.value=midiToFreq(midi);
  g.gain.setValueAtTime(0.0001,t);
  g.gain.exponentialRampToValueAtTime(.18,t+.03);
  g.gain.exponentialRampToValueAtTime(.0001,t+duration);
  o.connect(g).connect(state.audioCtx.destination); o.start(t); o.stop(t+duration+.05);
}
function playPattern(midis, beat=.5){
  midis.forEach((m,i)=>playTone(m,beat*.85,i*beat));
}

$('#playTarget').onclick=()=>playTone(state.targetMidi);
$('#newTarget').onclick=()=>{
  const low=state.progress.rangeLow ?? 52, high=state.progress.rangeHigh ?? 69;
  const diff=$('#pitchDifficulty').value;
  let pool=[];
  if(diff==='easy') for(let m=Math.max(low,55);m<=Math.min(high,67);m+=2) pool.push(m);
  else if(diff==='medium') for(let m=low;m<=high;m++) pool.push(m);
  else for(let m=Math.max(45,low-3);m<=Math.min(81,high+3);m++) pool.push(m);
  state.targetMidi = pool[Math.floor(Math.random()*pool.length)] || 57;
  $('#targetLabel').textContent=`Target: ${midiToName(state.targetMidi)}`;
  $('#matchAccuracy').textContent='Listen, then sing the note.';
  playTone(state.targetMidi);
};
let targetScores=[];
function scoreTarget(note,cents){
  if(!$('#pitch').classList.contains('active')) return;
  const dist=Math.abs((note-state.targetMidi)*100+cents);
  if(dist<100){
    const score=Math.max(0,Math.round(100-dist));
    targetScores.push(score); if(targetScores.length>20) targetScores.shift();
    const avg=Math.round(targetScores.reduce((a,b)=>a+b,0)/targetScores.length);
    $('#matchAccuracy').textContent=`Live accuracy: ${avg}%`;
    if(avg>state.progress.bestPitch){state.progress.bestPitch=avg; saveProgress();}
  }
}

$('#startLow').onclick=()=>startRange('low');
$('#startHigh').onclick=()=>startRange('high');
function startRange(which){
  if(!state.micEnabled){ enableMic(); }
  state.testingRange=which; state.rangeObserved=[];
  $('#rangeFeedback').textContent = which==='low'
    ? 'Sing downward gently in small steps. Hold each comfortable note for about 1 second. Stop before it becomes breathy, fry-like, or forced.'
    : 'Sing upward gently in small steps. Use an easy “oo” or lip trill. Stop before you push, yell, squeeze or lose control.';
}
function observeRange(note,cents){
  if(!state.testingRange || Math.abs(cents)>35) return;
  state.rangeObserved.push(note);
  if(state.rangeObserved.length>100) state.rangeObserved.shift();
  const counts={}; state.rangeObserved.forEach(n=>counts[n]=(counts[n]||0)+1);
  const stable=Object.keys(counts).filter(n=>counts[n]>=3).map(Number);
  if(!stable.length)return;
  if(state.testingRange==='low'){
    state.rangeLow=Math.min(...stable);
    $('#lowRange').textContent=midiToName(state.rangeLow);
  } else {
    state.rangeHigh=Math.max(...stable);
    $('#highRange').textContent=midiToName(state.rangeHigh);
  }
  if(state.rangeLow!=null&&state.rangeHigh!=null){
    $('#rangeSpan').textContent=`${state.rangeHigh-state.rangeLow} semitones`;
  }
}
$('#saveRange').onclick=()=>{
  if(state.rangeLow==null || state.rangeHigh==null){ $('#rangeFeedback').textContent='Complete both low and high tests first.'; return; }
  if(state.rangeHigh-state.rangeLow<8){ $('#rangeFeedback').textContent='That span looks unusually small. Try both tests again using gentle connected singing.'; return; }
  state.progress.rangeLow=state.rangeLow; state.progress.rangeHigh=state.rangeHigh;
  state.testingRange=null;
  markSession('Vocal range test',`${midiToName(state.rangeLow)}–${midiToName(state.rangeHigh)}`);
  $('#rangeFeedback').textContent='Range saved. Exercises and key suggestions will now adapt to it.';
};

const exercises = [
 {id:'release',cat:'release',title:'Jaw + tongue release',mins:2,level:'All levels',why:'Reduces unnecessary tension around the jaw, tongue and laryngeal area before phonation.',instruction:'Drop the jaw loosely. Massage the masseter muscles. Let the tongue rest wide behind the lower teeth. Breathe silently through the mouth and nose. Add gentle sighs only if the throat feels easy.',pattern:null},
 {id:'liptrill',cat:'sovt',title:'Lip trill sirens',mins:3,level:'Beginner+',why:'A semi-occluded vocal tract exercise that encourages efficient vocal-fold vibration with less collision and helps coordinate airflow and pitch.',instruction:'Keep lips loose. Make a gentle “brrr” and glide from a comfortable low note to a comfortable high note and back. Small, easy sirens first; never force the top.',pattern:[0,2,4,5,7,5,4,2,0]},
 {id:'vv',cat:'sovt',title:'“VV” 5-note scales',mins:3,level:'Beginner+',why:'The narrow lip opening creates helpful back pressure while allowing clear pitch work.',instruction:'Sing “vvvv-oo” on 1-2-3-4-5-4-3-2-1. Keep volume medium-soft and tone buoyant.',pattern:[0,2,4,5,7,5,4,2,0]},
 {id:'ng',cat:'resonance',title:'NG → vowel resonance',mins:3,level:'Beginner+',why:'Helps connect an easy resonant hum-like sensation into vowels without pressing.',instruction:'Sing “ng” as in “sing”, then open gently to “ah” without changing the pitch or pushing more air. Think smooth, not loud.',pattern:[0,2,4,2,0]},
 {id:'mum',cat:'resonance',title:'MUM octave arpeggio',mins:4,level:'Intermediate',why:'Builds registration balance and resonance through a wider interval while discouraging over-spreading.',instruction:'Use a rounded, speech-like “mum”. Sing 1-3-5-8-5-3-1. Keep the upper note lighter rather than louder.',pattern:[0,4,7,12,7,4,0]},
 {id:'pitch3',cat:'pitch',title:'Three-note pitch lock',mins:4,level:'Beginner',why:'Trains clean onset, pitch centering and controlled movement between nearby notes.',instruction:'Listen first, then sing 1-2-3-2-1 on “noo”. Aim to arrive on each pitch immediately instead of sliding into it.',pattern:[0,2,4,2,0]},
 {id:'staccato',cat:'agility',title:'Light 5-note staccato',mins:3,level:'Intermediate',why:'Builds coordination and agility without carrying excessive vocal weight.',instruction:'Sing a tiny, buoyant “gee” on 1-2-3-4-5-4-3-2-1. Each note should be clean and light, never punched.',pattern:[0,2,4,5,7,5,4,2,0]},
 {id:'runs',cat:'agility',title:'1-2-3-4-5 turn',mins:4,level:'Advanced',why:'Improves accuracy in quicker note changes and discourages scooping.',instruction:'Start slowly: 1-2-3-4-5-4-3-2-1, then increase speed only while every note stays distinct.',pattern:[0,2,4,5,7,5,4,2,0]},
 {id:'hiss',cat:'breath',title:'Steady hiss control',mins:3,level:'All levels',why:'Practises steady controlled exhalation without confusing breath capacity with singing volume.',instruction:'Inhale silently and comfortably—not maximally. Exhale on a quiet “sss” for 8–12 seconds with even flow. Repeat 4 times. Shoulders stay relaxed.',pattern:null},
 {id:'phrasing',cat:'breath',title:'One-breath phrase',mins:4,level:'Beginner+',why:'Connects breath management to real musical phrasing rather than long breath-holding contests.',instruction:'Sing a comfortable 5-note phrase at medium-soft volume on “loo”. Plan the inhale before the phrase and avoid taking an oversized breath.',pattern:[0,2,4,5,7,5,4,2,0]}
];

function renderExercises(filter='all'){
  $('#exerciseList').innerHTML = exercises.filter(e=>filter==='all'||e.cat===filter).map(e=>`
    <div class="exercise-card">
      <span class="tag">${e.cat.toUpperCase()}</span>
      <h3>${e.title}</h3>
      <div class="exercise-meta">${e.mins} min · ${e.level}</div>
      <p>${e.why}</p>
      <button class="secondary" data-ex="${e.id}">Open exercise</button>
    </div>`).join('');
  $$('[data-ex]').forEach(b=>b.onclick=()=>openExercise(b.dataset.ex));
}
renderExercises();
$$('[data-filter]').forEach(b=>b.onclick=()=>{
  $$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));
  renderExercises(b.dataset.filter);
});
let activeExercise=null;
function openExercise(id){
  activeExercise=exercises.find(e=>e.id===id);
  $('#modalCategory').textContent=activeExercise.cat.toUpperCase();
  $('#modalTitle').textContent=activeExercise.title;
  $('#modalWhy').textContent=activeExercise.why;
  $('#modalInstruction').textContent=activeExercise.instruction;
  $('#modalPattern').textContent=activeExercise.pattern ? 'Pattern: '+activeExercise.pattern.map(x=>['1','♭2','2','♭3','3','4','♯4','5','♭6','6','♭7','7','8'][x]||x).join(' – ') : 'No fixed pitch pattern.';
  $('#exerciseModal').classList.remove('hidden');
}
$('#modalClose').onclick=()=>$('#exerciseModal').classList.add('hidden');
$('#exercisePlay').onclick=()=>{
  if(!activeExercise?.pattern) return;
  const low=state.progress.rangeLow ?? 52, high=state.progress.rangeHigh ?? 69;
  const span=Math.max(...activeExercise.pattern);
  let root=Math.max(low+2, Math.min(60, high-span-2));
  if(root+span>high) root=high-span;
  playPattern(activeExercise.pattern.map(x=>root+x), .45);
};
$('#exerciseDone').onclick=()=>{
  if(activeExercise) markSession('Exercise completed',activeExercise.title);
  $('#exerciseModal').classList.add('hidden');
};

function randomEar(){
  const root=55+Math.floor(Math.random()*10);
  const step=[2,3,4,5,7][Math.floor(Math.random()*5)]*(Math.random()<.5?-1:1);
  state.earDirection=step>0?'up':'down';
  playTone(root,.45,0); playTone(root+step,.45,.7);
}
$('#earPlay').onclick=randomEar;
$$('[data-ear]').forEach(b=>b.onclick=()=>{
  const ok=b.dataset.ear===state.earDirection;
  $('#earFeedback').textContent=state.earDirection ? (ok?'Correct! Your ear heard the direction.':'Not this time. Replay it and notice where the second note settles.') : 'Press play first.';
  if(ok) markSession('Ear training','Higher/lower');
});
$('#intervalPlay').onclick=()=>{
  const low=state.progress.rangeLow ?? 52, high=state.progress.rangeHigh ?? 69;
  const root=Math.max(low+2,Math.min(60,high-7));
  const step=[2,3,4,5,7][Math.floor(Math.random()*5)];
  state.intervalTarget=root+step;
  playTone(root,.45,0); playTone(root+step,.45,.65);
  $('#intervalFeedback').textContent=`Now sing the second note (${midiToName(state.intervalTarget)}).`;
};
$('#intervalNew').onclick=()=>$('#intervalPlay').click();
function scoreInterval(note,cents){
  if(!state.intervalTarget || !$('#ear').classList.contains('active')) return;
  const dist=Math.abs((note-state.intervalTarget)*100+cents);
  if(dist<25){
    $('#intervalFeedback').textContent='Excellent — you matched the second note.';
    state.intervalTarget=null;
    markSession('Interval copying','Matched within 25 cents');
  }
}

const songs = [
 {id:'amazing',title:'Amazing Grace',source:'Traditional hymn',key:'G',baseRoot:55, melody:[0,5,9,5,9,7,5,2,0,5,9,5,9,7,12], rhythm:[1,2,1,1,2,1,2,1,2,2,1,1,2,1,3]},
 {id:'twinkle',title:'Twinkle, Twinkle, Little Star',source:'Traditional melody',key:'C',baseRoot:60, melody:[0,0,7,7,9,9,7,5,5,4,4,2,2,0], rhythm:[1,1,1,1,1,1,2,1,1,1,1,1,1,2]},
 {id:'ode',title:'Ode to Joy',source:'Beethoven melody — public domain',key:'C',baseRoot:60, melody:[4,4,5,7,7,5,4,2,0,0,2,4,4,2,2], rhythm:Array(15).fill(1)},
 {id:'scarborough',title:'Scarborough Fair',source:'Traditional',key:'D minor',baseRoot:62, melody:[0,0,7,7,5,3,2,0,3,5,7,5,3,2,0], rhythm:[1,1,2,1,1,1,2,1,1,1,1,1,1,1,3]},
 {id:'when',title:'When the Saints Go Marching In',source:'Traditional',key:'C',baseRoot:60, melody:[0,4,5,7,0,4,5,7,0,4,5,7,4,0,4,2], rhythm:Array(16).fill(1)},
 {id:'original1',title:'Open Sky',source:'Original SingWise exercise song',key:'C',baseRoot:60, melody:[0,2,4,7,5,4,2,0,4,5,7,9,7,5,4,2,0], rhythm:[1,1,1,2,1,1,1,2,1,1,1,2,1,1,1,1,3]}
];

function songMinMax(song,trans=0){
  const notes=song.melody.map(x=>song.baseRoot+x+trans);
  return [Math.min(...notes),Math.max(...notes)];
}
function bestTranspose(song){
  const low=state.progress.rangeLow, high=state.progress.rangeHigh;
  if(low==null||high==null) return 0;
  let best=0,bestScore=1e9;
  for(let t=-6;t<=6;t++){
    const [mn,mx]=songMinMax(song,t);
    const overflow=Math.max(0,low-mn)+Math.max(0,mx-high);
    const center=Math.abs(((mn+mx)/2)-((low+high)/2))*.08;
    const score=overflow*10+center;
    if(score<bestScore){bestScore=score;best=t;}
  }
  return best;
}
function renderSongs(){
  const t=parseInt($('#globalTranspose').value);
  $('#songList').innerHTML=songs.map(s=>{
    const [mn,mx]=songMinMax(s,t);
    const fits=state.progress.rangeLow!=null ? (mn>=state.progress.rangeLow && mx<=state.progress.rangeHigh) : null;
    return `<div class="song-card">
      <span class="tag">${s.source}</span>
      <h3>${s.title}</h3>
      <div class="song-meta">Original key: ${s.key} · Current melody: ${midiToName(mn)}–${midiToName(mx)}</div>
      <p>${fits===null?'Test your range for a personalised fit suggestion.':fits?'This transposition fits inside your saved range.':'Some notes fall outside your saved comfortable range.'}</p>
      <button class="secondary" data-play-song="${s.id}">Play melody</button>
      <button class="primary" data-best-song="${s.id}">Use best key</button>
    </div>`;
  }).join('');
  $$('[data-play-song]').forEach(b=>b.onclick=()=>{
    const s=songs.find(x=>x.id===b.dataset.playSong), tr=parseInt($('#globalTranspose').value);
    let time=0;
    s.melody.forEach((x,i)=>{ playTone(s.baseRoot+x+tr,.38, time); time += .42*(s.rhythm[i]||1); });
    markSession('Song practice',`${s.title}, shift ${tr>=0?'+':''}${tr}`);
  });
  $$('[data-best-song]').forEach(b=>b.onclick=()=>{
    const s=songs.find(x=>x.id===b.dataset.bestSong);
    $('#globalTranspose').value=bestTranspose(s);
    renderSongs();
  });
}
renderSongs();
$('#globalTranspose').onchange=renderSongs;
$('#autoKey').onclick=()=>{
  if(state.progress.rangeLow==null){ alert('Run the vocal range test first so SingWise knows your comfortable range.'); return; }
  // Set a compromise based on the first selected song; per-song button is more precise.
  $('#globalTranspose').value=bestTranspose(songs[0]);
  renderSongs();
};

$('#resetProgress').onclick=()=>{
  if(confirm('Reset all saved SingWise progress on this device?')){
    state.progress={sessions:0,bestPitch:0,history:[],rangeLow:null,rangeHigh:null,streak:0,lastDate:null};
    saveProgress();
  }
};

refreshProgress();

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
