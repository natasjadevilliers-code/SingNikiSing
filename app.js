
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
  rangeTarget: null,
  rangeHoldFrames: 0,
  rangeLastMatched: null,
  rangeStartMidi: null,
  rangeListenAfter: 0,
  masterVolume: 1.0,
  earDirection: null,
  intervalTarget: null,
  progress: JSON.parse(localStorage.getItem('singwiseProgress') || '{"sessions":0,"bestPitch":0,"history":[],"rangeLow":null,"rangeHigh":null,"streak":0,"lastDate":null}'),
  daily: {started:false,index:0,points:0,completed:[],pitchSamples:[],stabilitySamples:[],stepSamples:[],timer:null,elapsed:0},
  recorder: null,
  recordingChunks: [],
  recordings: []
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
  const hl=$('#homeLevel'); if(hl) hl.textContent=Math.max(1,Math.min(20,Math.floor((p.sessions||0)/4)+1));
  $('#bestPitch').textContent = p.bestPitch ? `${p.bestPitch}%` : '—';
  $('#homeScore').textContent = p.bestPitch ? `${p.bestPitch}%` : '—';
  const rr = p.rangeLow!=null && p.rangeHigh!=null ? `${midiToName(p.rangeLow)}–${midiToName(p.rangeHigh)}` : 'Not tested';
  $('#homeRange').textContent = rr;
  $('#savedRange').textContent = rr;
  const vpt=$('#voiceProfileTitle'), vpx=$('#voiceProfileText');
  if(vpt && vpx){
    if(p.rangeLow!=null && p.rangeHigh!=null){
      const span=p.rangeHigh-p.rangeLow;
      vpt.textContent=`Your comfortable range: ${rr}`;
      vpx.textContent=`That spans ${span} semitones. Songs and exercises will be shifted to stay closer to this area.`;
    } else {
      vpt.textContent='Complete the range check';
      vpx.textContent='Once both ends are confirmed, SingNikiSing will adapt songs and exercises to your comfortable voice.';
    }
  }
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
    state.analyser.fftSize = 2048;
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
  // Fast normalized autocorrelation tuned for singing (~75–1000 Hz).
  let rms=0;
  for(let i=0;i<buf.length;i++) rms += buf[i]*buf[i];
  rms=Math.sqrt(rms/buf.length);
  if(rms<0.012) return -1;

  const minLag=Math.floor(sampleRate/1000);
  const maxLag=Math.min(Math.floor(sampleRate/75), buf.length-2);
  let bestLag=-1, best=0;

  // Use every second sample to reduce CPU load on phones.
  for(let lag=minLag; lag<=maxLag; lag++){
    let corr=0, normA=0, normB=0;
    for(let i=0; i<buf.length-lag; i+=2){
      const a=buf[i], b=buf[i+lag];
      corr += a*b; normA += a*a; normB += b*b;
    }
    const denom=Math.sqrt(normA*normB) || 1;
    const score=corr/denom;
    if(score>best){best=score;bestLag=lag;}
  }
  if(bestLag<0 || best<0.55) return -1;

  // Small parabolic refinement around the best lag.
  const scoreAt=(lag)=>{
    let corr=0,nA=0,nB=0;
    for(let i=0;i<buf.length-lag;i+=2){
      const a=buf[i],b=buf[i+lag];
      corr+=a*b;nA+=a*a;nB+=b*b;
    }
    return corr/(Math.sqrt(nA*nB)||1);
  };
  let refined=bestLag;
  if(bestLag>minLag && bestLag<maxLag){
    const y1=scoreAt(bestLag-1), y2=best, y3=scoreAt(bestLag+1);
    const denom=(y1-2*y2+y3);
    if(Math.abs(denom)>1e-6) refined += 0.5*(y1-y3)/denom;
  }
  return sampleRate/refined;
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
    dailyLiveSample(nearest,cents);
    $('#liveNote').textContent = midiToName(nearest);
    $('#liveFreq').textContent = `${f.toFixed(1)} Hz`;
    $('#needle').style.left = `${Math.max(0,Math.min(100,50+cents/2))}%`;
    const lane=$('#laneDot'); if(lane) lane.style.left=`${Math.max(5,Math.min(95,50+cents/2))}%`;
    if(Math.abs(cents)<=10) $('#pitchFeedback').textContent='Excellent — centered on the note.';
    else if(cents<0) $('#pitchFeedback').textContent=`About ${Math.abs(cents).toFixed(0)} cents flat. Let the pitch rise slightly.`;
    else $('#pitchFeedback').textContent=`About ${cents.toFixed(0)} cents sharp. Release down slightly.`;

    scoreTarget(nearest,cents);
    observeRange(nearest,cents);
    scoreInterval(nearest,cents);
  }
  requestAnimationFrame(pitchLoop);
}

async function ensureAudio(){
  if(!state.audioCtx){
    state.audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  }
  if(state.audioCtx.state === 'suspended'){
    try { await state.audioCtx.resume(); } catch(e) {}
  }
  return state.audioCtx;
}

async function playTone(midi,duration=.75,delay=0){
  const ctx=await ensureAudio();
  const t=ctx.currentTime+delay;
  const master=ctx.createGain();
  const compressor=ctx.createDynamicsCompressor();
  compressor.threshold.value=-12;
  compressor.knee.value=8;
  compressor.ratio.value=4;
  compressor.attack.value=.003;
  compressor.release.value=.18;
  master.gain.value=0.72*(state.masterVolume||1);
  master.connect(compressor).connect(ctx.destination);

  // Fundamental plus soft harmonics sounds much louder on a phone speaker
  // than a single low sine wave.
  const parts=[
    {mult:1,type:'triangle',gain:.55},
    {mult:2,type:'sine',gain:.22},
    {mult:3,type:'sine',gain:.10}
  ];
  parts.forEach(p=>{
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type=p.type;
    o.frequency.value=midiToFreq(midi)*p.mult;
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(p.gain,t+.025);
    g.gain.setValueAtTime(p.gain,t+Math.max(.04,duration-.12));
    g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    o.connect(g).connect(master);
    o.start(t); o.stop(t+duration+.04);
  });
}

async function playPattern(midis,beat=.5){
  await ensureAudio();
  midis.forEach((m,i)=>playTone(m,beat*.82,i*beat));
}

$('#appVolume').addEventListener('input',e=>{
  state.masterVolume=Math.max(.2,Math.min(1,Number(e.target.value)/100));
});

$('#playTarget').onclick=async()=>{ await ensureAudio(); playTone(state.targetMidi); };
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
$('#replayRangeNote').onclick=()=>replayRangeTarget();
$('#rangeCantMatch').onclick=()=>finishCurrentRangeSide();

async function startRange(which){
  if(!state.micEnabled) await enableMic();
  await ensureAudio();

  state.testingRange=which;
  state.rangeObserved=[];
  state.rangeHoldFrames=0;
  state.rangeLastMatched=null;

  // Start around an easy central note. If a saved range exists, use its centre.
  const savedLow = state.progress.rangeLow, savedHigh = state.progress.rangeHigh;
  let startMidi = (savedLow!=null && savedHigh!=null)
    ? Math.round((savedLow+savedHigh)/2)
    : 60; // C4 is a neutral default starting point.

  // Keep the opening target within a broadly singable test area.
  startMidi = Math.max(48, Math.min(67, startMidi));
  state.rangeStartMidi=startMidi;
  state.rangeTarget=startMidi;
  state.rangeListenAfter=Date.now()+1200;
  $('#rangeTargetDisplay').textContent=midiToName(state.rangeTarget);
  $('#rangeDetectedDisplay').textContent='—';
  $('#rangeMatchDisplay').textContent='Listen';

  if(which==='low'){
    state.rangeLow=null;
    $('#lowRange').textContent='—';
    $('#rangeFeedback').textContent=`LOW test: listen to ${midiToName(state.rangeTarget)}, then copy it. Hold it steadily for about 1 second.`;
  }else{
    state.rangeHigh=null;
    $('#highRange').textContent='—';
    $('#rangeFeedback').textContent=`HIGH test: listen to ${midiToName(state.rangeTarget)}, then copy it gently. Hold it steadily for about 1 second.`;
  }

  playTone(state.rangeTarget,.8);
  state.rangeListenAfter=Date.now()+1150;
}

function replayRangeTarget(){
  if(state.testingRange && state.rangeTarget!=null){
    state.rangeHoldFrames=0;
    $('#rangeTargetDisplay').textContent=midiToName(state.rangeTarget);
    $('#rangeDetectedDisplay').textContent='—';
    $('#rangeMatchDisplay').textContent='Listen';
    playTone(state.rangeTarget,.8);
    state.rangeListenAfter=Date.now()+1150;
    $('#rangeFeedback').textContent=`Listen to ${midiToName(state.rangeTarget)} first. When the sound stops, sing the same note and hold it.`;
  }else{
    $('#rangeFeedback').textContent='Start the LOW or HIGH guided test first.';
  }
}

function observeRange(note,cents){
  if(!state.testingRange || state.rangeTarget==null) return;
  if(Date.now() < (state.rangeListenAfter||0)) return;

  $('#rangeDetectedDisplay').textContent=midiToName(note);

  // Score distance from the exact target, not merely the nearest detected note.
  const signedDistance=(note-state.rangeTarget)*100+cents;
  const distance=Math.abs(signedDistance);

  if(distance <= 45){
    state.rangeHoldFrames++;
    const pct=Math.max(0,Math.round(100-distance));
    $('#rangeMatchDisplay').textContent=`${pct}%`;
    $('#rangeFeedback').textContent=`Yes — that is ${midiToName(state.rangeTarget)}. Keep holding it steadily…`;

    // Roughly ~0.7–1 sec depending on device callback rate.
    if(state.rangeHoldFrames >= 12){
      const matched = state.rangeTarget;
      state.rangeLastMatched = matched;

      if(state.testingRange==='low'){
        state.rangeLow = matched;
        $('#lowRange').textContent = midiToName(matched);
        state.rangeTarget = matched - 1;
      }else{
        state.rangeHigh = matched;
        $('#highRange').textContent = midiToName(matched);
        state.rangeTarget = matched + 1;
      }

      state.rangeHoldFrames=0;

      if(state.rangeLow!=null && state.rangeHigh!=null){
        $('#rangeSpan').textContent=`${state.rangeHigh-state.rangeLow} semitones`;
      }

      // Hard safety boundaries to prevent a runaway test.
      if(state.rangeTarget < 36 || state.rangeTarget > 84){
        finishCurrentRangeSide();
        return;
      }

      setTimeout(()=>{
        if(state.testingRange){
          $('#rangeTargetDisplay').textContent=midiToName(state.rangeTarget);
          $('#rangeDetectedDisplay').textContent='—';
          $('#rangeMatchDisplay').textContent='Listen';
          $('#rangeFeedback').textContent=`Good. Now listen to ${midiToName(state.rangeTarget)}. Sing only after the reference sound stops.`;
          playTone(state.rangeTarget,.8);
          state.rangeListenAfter=Date.now()+1150;
        }
      },350);
    }
  }else{
    state.rangeHoldFrames=Math.max(0,state.rangeHoldFrames-1);
    const direction=signedDistance<0?'below':'above';
    $('#rangeMatchDisplay').textContent=distance<100?'Close':'Try again';
    $('#rangeFeedback').textContent=`Target ${midiToName(state.rangeTarget)}. You are singing ${midiToName(note)} (${Math.round(distance)} cents ${direction}). Adjust gently or replay the target.`;
  }
}

function finishCurrentRangeSide(){
  if(!state.testingRange){
    $('#rangeFeedback').textContent='Start a guided range test first.';
    return;
  }

  const side=state.testingRange;
  state.testingRange=null;
  state.rangeTarget=null;
  state.rangeHoldFrames=0;
  $('#rangeTargetDisplay').textContent='—';
  $('#rangeMatchDisplay').textContent='Finished';

  if(side==='low'){
    if(state.rangeLow==null){
      $('#rangeFeedback').textContent='No low note was confirmed yet. Try the LOW test again and match the first target before stopping.';
    }else{
      $('#rangeFeedback').textContent=`Low side finished at ${midiToName(state.rangeLow)}. Now start the HIGH test.`;
    }
  }else{
    if(state.rangeHigh==null){
      $('#rangeFeedback').textContent='No high note was confirmed yet. Try the HIGH test again and match the first target before stopping.';
    }else{
      $('#rangeFeedback').textContent=`High side finished at ${midiToName(state.rangeHigh)}. If both sides look right, tap Save range.`;
    }
  }

  if(state.rangeLow!=null && state.rangeHigh!=null){
    $('#rangeSpan').textContent=`${state.rangeHigh-state.rangeLow} semitones`;
  }
}

$('#saveRange').onclick=()=>{
  if(state.rangeLow==null || state.rangeHigh==null){
    $('#rangeFeedback').textContent='Complete both the LOW and HIGH guided tests first.';
    return;
  }
  if(state.rangeHigh <= state.rangeLow){
    $('#rangeFeedback').textContent='Those results do not look valid. Please repeat both tests.';
    return;
  }
  const span=state.rangeHigh-state.rangeLow;
  if(span<7){
    $('#rangeFeedback').textContent='That range looks unusually narrow. Repeat the tests gently before saving.';
    return;
  }

  state.progress.rangeLow=state.rangeLow;
  state.progress.rangeHigh=state.rangeHigh;
  state.testingRange=null;
  state.rangeTarget=null;

  markSession('Vocal range test',`${midiToName(state.rangeLow)}–${midiToName(state.rangeHigh)} · ${span} semitones`);
  $('#rangeFeedback').textContent=`Saved: ${midiToName(state.rangeLow)}–${midiToName(state.rangeHigh)}. Song-key suggestions and exercises will now adapt to this range.`;
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
$('#exercisePlay').onclick=async()=>{
  await ensureAudio();
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

async function randomEar(){
  await ensureAudio();
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
$('#intervalPlay').onclick=async()=>{
  await ensureAudio();
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
 {id:'original1',title:'Open Sky',source:'Original SingNikiSing exercise song',key:'C',baseRoot:60, melody:[0,2,4,7,5,4,2,0,4,5,7,9,7,5,4,2,0], rhythm:[1,1,1,2,1,1,1,2,1,1,1,2,1,1,1,1,3]}
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
  $$('[data-play-song]').forEach(b=>b.onclick=async()=>{
    await ensureAudio();
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
  if(state.progress.rangeLow==null){ alert('Run the vocal range test first so SingNikiSing knows your comfortable range.'); return; }
  // Set a compromise based on the first selected song; per-song button is more precise.
  $('#globalTranspose').value=bestTranspose(songs[0]);
  renderSongs();
};


const DAILY_PROGRAM = [
  {kind:'release',title:'Body + jaw release',duration:60,points:50,why:'Release unnecessary tension before you phonate.',instruction:'Roll the shoulders gently. Let the jaw hang loose. Massage the jaw muscles. Rest the tongue wide behind the lower teeth. Take quiet, easy breaths. No big inhalations.',pattern:null,scorePitch:false},
  {kind:'sovt',title:'Lip trill sirens',duration:120,points:100,why:'Semi-occluded exercises help coordinate airflow and vocal-fold vibration efficiently.',instruction:'Make an easy lip trill and glide through a comfortable part of your range. Keep it light. Do not chase the highest note.',pattern:[0,2,4,5,7,5,4,2,0],scorePitch:false},
  {kind:'sovt',title:'VV five-note scales',duration:120,points:120,why:'Build steady phonation while keeping the vocal tract partially closed.',instruction:'Sing “vvvv-oo” on 1-2-3-4-5-4-3-2-1. Start in the middle of your comfortable range. Stay medium-soft.',pattern:[0,2,4,5,7,5,4,2,0],scorePitch:true},
  {kind:'resonance',title:'NG → AH resonance',duration:120,points:120,why:'Move from easy resonance into an open vowel without adding throat pressure.',instruction:'Sing “ng” as in “sing”, then open gently to “ah”. Try to keep the pitch steady as the vowel changes.',pattern:[0,2,4,2,0],scorePitch:true},
  {kind:'pitch',title:'Pitch-lock drill',duration:150,points:160,why:'Train clean pitch arrival instead of sliding into every note.',instruction:'Listen first, then sing the pattern on “noo”. Try to land on each note immediately and hold the centre.',pattern:[0,2,4,2,0],scorePitch:true},
  {kind:'agility',title:'Light five-note agility',duration:120,points:140,why:'Improve coordination between notes without pushing extra weight.',instruction:'Sing a light “gee” through the five-note pattern. Keep each note distinct and small. Speed comes after accuracy.',pattern:[0,2,4,5,7,5,4,2,0],scorePitch:true},
  {kind:'breath',title:'One-breath phrase',duration:90,points:90,why:'Practise planned breathing in a musical phrase instead of breath-holding.',instruction:'Take a comfortable silent breath. Sing the pattern smoothly on “loo” in one breath. Do not overfill the lungs.',pattern:[0,2,4,5,7,5,4,2,0],scorePitch:true},
  {kind:'song',title:'Song phrase practice',duration:180,points:220,why:'Apply pitch, breath and resonance to actual melody.',instruction:'Choose a song from Song Practice in your suggested key. Work phrase-by-phrase: listen, sing, repeat. Aim for easy tone before volume.',pattern:null,scorePitch:true}
];

function dailyRootFor(step){
  const low = state.progress.rangeLow ?? 52, high = state.progress.rangeHigh ?? 69;
  if(!step.pattern) return 60;
  const span = Math.max(...step.pattern);
  let root = Math.round((low+high-span)/2);
  root = Math.max(low+1, Math.min(root, high-span-1));
  return root;
}
function renderDailySequence(){
  $('#dailySequence').innerHTML = DAILY_PROGRAM.map((s,i)=>`
    <div class="daily-step ${i===state.daily.index&&state.daily.started?'active':''} ${state.daily.completed.includes(i)?'done':''}">
      <div class="num">${state.daily.completed.includes(i)?'✓':i+1}</div>
      <div><b>${s.title}</b><br><small>${Math.round(s.duration/60*10)/10} min · ${s.kind.toUpperCase()}</small></div>
      <div>${s.points} pts</div>
    </div>`).join('');
  $('#sessionCompleted').textContent = `${state.daily.completed.length}/${DAILY_PROGRAM.length}`;
}
function currentDailyStep(){ return DAILY_PROGRAM[state.daily.index]; }

function loadDailyStep(){
  const s=currentDailyStep();
  if(!s) return finishDaily();
  $('#dailyStage').textContent=`STEP ${state.daily.index+1} OF ${DAILY_PROGRAM.length} · ${s.kind.toUpperCase()}`;
  $('#dailyExerciseTitle').textContent=s.title;
  $('#dailyExerciseWhy').textContent=s.why;
  $('#dailyInstruction').textContent=s.instruction;
  $('#dailyTimer').textContent='00:00';
  state.daily.elapsed=0;
  state.daily.stepSamples=[];
  $('#dailyPitchScore').textContent='—';
  $('#dailyStability').textContent='—';
  $('#dailyProgressBar').style.width=`${(state.daily.index/DAILY_PROGRAM.length)*100}%`;
  renderDailySequence();
}
async function startDaily(){
  if(!state.micEnabled) await enableMic();
  state.daily={started:true,index:0,points:0,completed:[],pitchSamples:[],stabilitySamples:[],stepSamples:[],timer:null,elapsed:0};
  state.recordings=[];
  $('#recordingsList').innerHTML='';
  $('#dailyPoints').textContent='0';
  $('#dailyStart').textContent='Restart daily practice';
  loadDailyStep();
  startDailyTimer();
}
function startDailyTimer(){
  if(state.daily.timer) clearInterval(state.daily.timer);
  state.daily.timer=setInterval(()=>{
    if(!state.daily.started) return;
    state.daily.elapsed++;
    const m=String(Math.floor(state.daily.elapsed/60)).padStart(2,'0');
    const s=String(state.daily.elapsed%60).padStart(2,'0');
    $('#dailyTimer').textContent=`${m}:${s}`;
  },1000);
}
function playDailyDemo(){
  const s=currentDailyStep(); if(!s?.pattern) return;
  const r=dailyRootFor(s);
  playPattern(s.pattern.map(x=>r+x),.5);
}
function calculateStepScore(){
  const s=currentDailyStep();
  const samples=state.daily.stepSamples.slice();
  if(!samples.length || !s.scorePitch) return {pitch:null,control:null,earned:Math.round(s.points*.75)};
  const cents=samples.map(x=>Math.abs(x.cents)).filter(Number.isFinite);
  const pitch = cents.length ? Math.round(Math.max(0,100-(cents.reduce((a,b)=>a+b,0)/cents.length)*1.35)) : 0;
  const mids=samples.map(x=>x.midi).filter(Number.isFinite);
  let control=0;
  if(mids.length>2){
    const diffs=[];
    for(let i=1;i<mids.length;i++) diffs.push(Math.abs(mids[i]-mids[i-1]));
    const avg=diffs.reduce((a,b)=>a+b,0)/diffs.length;
    control=Math.round(Math.max(0,100-avg*45));
  }
  const earned=Math.round(s.points*(0.45+0.35*(pitch/100)+0.20*(control/100)));
  return {pitch,control,earned};
}
function nextDaily(){
  if(!state.daily.started) return;
  const s=currentDailyStep(), result=calculateStepScore();
  if(!state.daily.completed.includes(state.daily.index)) state.daily.completed.push(state.daily.index);
  state.daily.points += result.earned;
  $('#dailyPoints').textContent=state.daily.points;
  if(result.pitch!=null) state.daily.pitchSamples.push(result.pitch);
  if(result.control!=null) state.daily.stabilitySamples.push(result.control);
  state.daily.index++;
  updateDailySessionStats();
  if(state.daily.index>=DAILY_PROGRAM.length) finishDaily(); else loadDailyStep();
}
function updateDailySessionStats(){
  const p=state.daily.pitchSamples, c=state.daily.stabilitySamples;
  $('#sessionPitch').textContent=p.length?`${Math.round(p.reduce((a,b)=>a+b,0)/p.length)}%`:'—';
  $('#sessionControl').textContent=c.length?`${Math.round(c.reduce((a,b)=>a+b,0)/c.length)}%`:'—';
  $('#sessionCompleted').textContent=`${state.daily.completed.length}/${DAILY_PROGRAM.length}`;
}
function finishDaily(){
  if(state.daily.timer) clearInterval(state.daily.timer);
  state.daily.started=false;
  $('#dailyStage').textContent='SESSION COMPLETE';
  $('#dailyExerciseTitle').textContent='Great work — today’s practice is complete';
  $('#dailyExerciseWhy').textContent=`You earned ${state.daily.points} points. Consistency matters more than chasing one perfect score.`;
  $('#dailyInstruction').textContent='Your session has been added to Progress. Come back tomorrow for another structured workout.';
  $('#dailyProgressBar').style.width='100%';
  const p=state.daily.pitchSamples;
  const avg=p.length?Math.round(p.reduce((a,b)=>a+b,0)/p.length):0;
  if(avg>state.progress.bestPitch) state.progress.bestPitch=avg;
  markSession('Daily vocal programme',`${state.daily.points} points${avg?` · ${avg}% pitch`:''}`);
  renderDailySequence();
}
$('#dailyStart').onclick=startDaily;
$('#dailyPlayDemo').onclick=playDailyDemo;
$('#dailyNext').onclick=nextDaily;

async function toggleDailyRecording(){
  if(!state.micEnabled) await enableMic();
  if(state.recorder && state.recorder.state==='recording'){
    state.recorder.stop();
    $('#dailyRecordBtn').textContent='Record this step';
    $('#recordingStatus').textContent='Saving recording…';
    return;
  }
  if(!window.MediaRecorder || !state.stream){
    $('#recordingStatus').textContent='Recording is not supported in this browser.';
    return;
  }
  state.recordingChunks=[];
  let options={};
  const choices=['audio/mp4','audio/webm;codecs=opus','audio/webm'];
  const supported=choices.find(t=>MediaRecorder.isTypeSupported?.(t));
  if(supported) options.mimeType=supported;
  try{
    state.recorder=new MediaRecorder(state.stream,options);
  }catch(e){
    state.recorder=new MediaRecorder(state.stream);
  }
  state.recorder.ondataavailable=e=>{ if(e.data?.size) state.recordingChunks.push(e.data); };
  state.recorder.onstop=()=>{
    const type=state.recorder.mimeType || supported || 'audio/webm';
    const blob=new Blob(state.recordingChunks,{type});
    const url=URL.createObjectURL(blob);
    const step=currentDailyStep()?.title || 'Practice';
    state.recordings.unshift({url,step,type,date:new Date().toLocaleTimeString()});
    renderRecordings();
    $('#recordingStatus').textContent='Recording saved on this device for this session.';
  };
  state.recorder.start();
  $('#dailyRecordBtn').textContent='Stop recording';
  $('#recordingStatus').textContent='● Recording your practice…';
}
$('#dailyRecordBtn').onclick=toggleDailyRecording;

function renderRecordings(){
  $('#recordingsList').innerHTML = state.recordings.length ? state.recordings.map((r,i)=>`
    <div class="recording-item">
      <div><b>${r.step}</b><br><small>${r.date}</small></div>
      <audio controls src="${r.url}"></audio>
    </div>`).join('') : '';
}
renderDailySequence();

function dailyLiveSample(note,cents){
  if(!state.daily.started || !$('#daily').classList.contains('active')) return;
  $('#dailyLiveNote').textContent=midiToName(note);
  state.daily.stepSamples.push({midi:note,cents});
  if(state.daily.stepSamples.length>450) state.daily.stepSamples.shift();
  const recent=state.daily.stepSamples.slice(-45);
  const avgC=recent.reduce((a,x)=>a+Math.abs(x.cents),0)/recent.length;
  const ps=Math.round(Math.max(0,100-avgC*1.35));
  $('#dailyPitchScore').textContent=`${ps}%`;
  if(recent.length>2){
    const ds=[];
    for(let i=1;i<recent.length;i++) ds.push(Math.abs(recent[i].midi-recent[i-1].midi));
    const av=ds.reduce((a,b)=>a+b,0)/ds.length;
    const st=Math.round(Math.max(0,100-av*45));
    $('#dailyStability').textContent=`${st}%`;
  }
}

$('#resetProgress').onclick=()=>{
  if(confirm('Reset all saved SingNikiSing progress on this device?')){
    state.progress={sessions:0,bestPitch:0,history:[],rangeLow:null,rangeHigh:null,streak:0,lastDate:null};
    saveProgress();
  }
};

refreshProgress();


// iPhone/iPad Safari requires audio to be unlocked by a direct user gesture.
const unlockAudioOnce = async () => {
  try { await ensureAudio(); } catch(e) {}
  document.removeEventListener('pointerdown', unlockAudioOnce);
  document.removeEventListener('touchend', unlockAudioOnce);
};
document.addEventListener('pointerdown', unlockAudioOnce, {passive:true});
document.addEventListener('touchend', unlockAudioOnce, {passive:true});

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
