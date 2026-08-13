# SingWise

A browser-based vocal training app.

## Features
- Live microphone pitch detection
- Sharp/flat cent display
- Note-matching trainer
- Conservative comfortable-range test
- Adaptive vocal exercises
- SOVT, resonance, agility, pitch and breath drills
- Ear training
- Interval-copying practice
- Public-domain/traditional and original practice melodies
- ±6 semitone key shifting
- Per-song automatic best-key suggestion from saved vocal range
- Progress/streak tracking using localStorage
- Installable PWA shell

## Running locally
Microphone access generally requires HTTPS or localhost.

A simple local test:
python3 -m http.server 8000

Then open http://localhost:8000 from the same computer.

For iPhone use, host the folder on an HTTPS service (for example GitHub Pages, Netlify, Cloudflare Pages, or Vercel), open it in Safari, allow microphone access, then Add to Home Screen.

## Important
This is a practice tool, not a medical or clinical voice assessment. Vocal exercises should not hurt.


## Daily Coach mode
- Guided full-session sequence in a sensible training order
- Live microphone monitoring throughout the session
- Per-step practice recordings using MediaRecorder where supported
- Pitch-centering and control scoring during suitable exercises
- Points awarded per completed step
- Session totals saved into Progress
- Recordings are kept only as temporary in-browser session audio unless the user explicitly downloads/saves them


## v4 fixes
- Faster phone-friendly pitch detection
- Guided range test ignores its own reference note while the phone speaker is playing
- Clear target / detected note / match displays
- Stronger multi-harmonic reference tone designed to be more audible on phone speakers
- In-app master volume slider


## v5 UI redesign
- Friendlier progression-based home screen
- Large action cards for Daily Practice, Songs, and Voice Check
- Learning path / level display
- Cleaner light visual system
- Real-time pitch note lane
- More prominent personalised voice profile
- Keeps the v4 audio and guided range-test fixes


## v6 iPhone audio architecture
- Works around iOS Safari microphone/playback routing behaviour by releasing microphone capture during reference-tone playback
- Re-enables microphone capture after the reference is finished
- Range test uses explicit listen → sing handoff
- Added Test Speaker button
- This addresses a known WebKit/iOS class of issues where getUserMedia can reduce or alter playback volume/routing


## v7 Guided Coach
- Spoken voice prompts using the browser's system speech voice
- Fully sequenced voice check: natural speech → comfortable hum → guided low notes → guided high notes → result
- Automatic progression after confirmed note matches
- Spoken feedback between steps
- Visible target / detected note / live pitch meter
- Explicit iOS playback vs play-and-record audio-session switching where supported
- Microphone released during coach speech and reference tones to improve iPhone playback volume and prevent self-detection


## v8 Real Audio
- Replaced browser-generated coach speech with prerecorded WAV prompt files
- Replaced live Web Audio reference notes in the voice check with 49 prerecorded WAV tone files
- Uses one HTMLAudioElement for playback on iPhone
- Microphone is fully released before every coach prompt/reference note
- Listening resumes only after playback has ended
- Speaker Test now plays a real prerecorded sentence followed by a real audio tone file
