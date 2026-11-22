/* ============================================================
   Kura — English ⇄ Nepali voice translator
   No backend, no API keys. Speech in → Nepali out.
   ============================================================ */
'use strict';

(() => {

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* =========================================================
     1. Devanagari → Latin transliteration — implemented in translit.js
     ========================================================= */
  const romanize = (text) => (typeof window !== 'undefined' && window.romanize)
    ? window.romanize(text)
    : String(text || '');

  /* =========================================================
     2. State
     ========================================================= */
  const LS_LOG = 'kura.log.v1';
  const LS_SET = 'kura.settings.v1';

  const state = {
    mode: 'en2ne',
    cat: 'all',
    listening: false,
    capturing: false,   // button is held down right now
    busy: false,
    current: null,
    log: [],
    settings: {
      autoSpeak: true, slow: false, engine: 'auto',
      ttsVoice: 'ne-NP-HemkalaNeural',
      sttEndpoint: '', sttKey: '', sttModel: 'whisper-1',
      localBase: '', localReady: false
    }
  };

  const L = {
    en2ne: { from:'en', to:'ne', srcLang:'en-US', dstLang:'ne-NP', srcLabel:'You say',   dstLabel:'नेपाली',  placeholder:'Type in English…' },
    ne2en: { from:'ne', to:'en', srcLang:'ne-NP', dstLang:'en-US', srcLabel:'They say', dstLabel:'English', placeholder:'Type in नेपाली…' }
  };

  /* =========================================================
     3. Translation — provider chain, no key required
     ========================================================= */
  const trCache = new Map();

  async function fetchJSON(url, ms = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  const PROVIDERS = [
    {
      name: 'g-nmt',
      url: (q, f, t) => `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${f}&tl=${t}&q=${encodeURIComponent(q)}`,
      parse: d => Array.isArray(d) ? d.filter(x => typeof x === 'string').join(' ') : String(d || '')
    },
    {
      name: 'g-gtx',
      url: (q, f, t) => `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${f}&tl=${t}&dt=t&q=${encodeURIComponent(q)}`,
      parse: d => (Array.isArray(d) && Array.isArray(d[0])) ? d[0].map(s => s[0] || '').join('') : ''
    },
    {
      name: 'mymemory',
      url: (q, f, t) => `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${f}|${t}`,
      parse: d => (d && d.responseData && d.responseData.translatedText) || ''
    }
  ];

  async function translate(text, from, to) {
    const key = `${from}|${to}|${text}`;
    if (trCache.has(key)) return trCache.get(key);

    let lastErr;
    for (const p of PROVIDERS) {
      try {
        const data = await fetchJSON(p.url(text, from, to));
        const out = (p.parse(data) || '').trim();
        if (out) {
          trCache.set(key, out);
          return out;
        }
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('translate failed');
  }

  /* =========================================================
     4. Speech output
     ========================================================= */
  const audioEl = new Audio();
  audioEl.preload = 'auto';
  let speakToken = 0;

  function playUrl(url, rate) {
    return new Promise((resolve, reject) => {
      try { audioEl.pause(); } catch (_) {}
      audioEl.src = url;
      audioEl.playbackRate = rate || 1;
      if ('preservesPitch' in audioEl) audioEl.preservesPitch = true;

      const done = () => { off(); resolve(); };
      const fail = () => { off(); reject(new Error('audio failed')); };
      function off() {
        audioEl.removeEventListener('ended', done);
        audioEl.removeEventListener('error', fail);
        audioEl.removeEventListener('stalled', fail);
      }
      audioEl.addEventListener('ended', done);
      audioEl.addEventListener('error', fail);
      audioEl.addEventListener('stalled', fail);

      const pr = audioEl.play();
      if (pr && pr.catch) pr.catch(fail);
    });
  }

  function chunkText(text, max = 165) {
    const parts = [];
    const sentences = String(text).split(/(?<=[।?!.])\s+/);
    let buf = '';

    const flush = () => { if (buf.trim()) parts.push(buf.trim()); buf = ''; };

    for (const s of sentences) {
      if ((buf ? buf + ' ' + s : s).length <= max) {
        buf = buf ? buf + ' ' + s : s;
      } else {
        flush();
        if (s.length <= max) { buf = s; continue; }
        let cur = '';
        for (const w of s.split(/\s+/)) {
          if ((cur ? cur + ' ' + w : w).length <= max) cur = cur ? cur + ' ' + w : w;
          else { if (cur) parts.push(cur); cur = w; }
        }
        buf = cur;
      }
    }
    flush();
    return parts.filter(Boolean);
  }

  async function speakOnline(text, lang, rate) {
    const parts = chunkText(text);
    for (let i = 0; i < parts.length; i++) {
      const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob'
        + '&tl=' + encodeURIComponent(lang)
        + '&q=' + encodeURIComponent(parts[i]);
      await playUrl(url, rate);
    }
  }

  /** Neural voice from the local server — the one that actually sounds like Nepali. */
  async function speakNeural(text, rate) {
    const parts = chunkText(text, 400);
    for (const part of parts) {
      const res = await fetch(state.localBase + '/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: part,
          voice: state.settings.ttsVoice || 'ne-NP-HemkalaNeural',
          speed: rate
        })
      });
      if (!res.ok) throw new Error('tts HTTP ' + res.status);

      const blob = await res.blob();
      if (!blob.size) throw new Error('empty audio');

      const url = URL.createObjectURL(blob);
      try { await playUrl(url, 1); }          // speed already baked in server-side
      finally { setTimeout(() => URL.revokeObjectURL(url), 10000); }
    }
  }

  function voicesReady() {
    return new Promise(res => {
      const v = window.speechSynthesis ? speechSynthesis.getVoices() : [];
      if (v && v.length) return res(v);
      let done = false;
      const finish = () => { if (!done) { done = true; res(speechSynthesis.getVoices() || []); } };
      try { speechSynthesis.addEventListener('voiceschanged', finish, { once: true }); } catch (_) {}
      setTimeout(finish, 700);
    });
  }

  async function deviceVoice(lang) {
    if (!('speechSynthesis' in window)) return null;
    const vs = await voicesReady();
    const want = lang.toLowerCase();
    const base = want.split('-')[0];
    const exact = vs.find(v => (v.lang || '').toLowerCase().replace('_', '-') === want);
    if (exact) return exact;
    const any = vs.find(v => (v.lang || '').toLowerCase().replace('_', '-').split('-')[0] === base);
    return any || null;
  }

  async function speakDevice(text, lang, rate) {
    if (!('speechSynthesis' in window)) throw new Error('no tts');
    const v = await deviceVoice(lang);   // voice must be set BEFORE speak()

    return new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = rate || 1;
      if (v) u.voice = v;

      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        err ? reject(err) : resolve();
      };

      u.onend = () => finish();
      u.onerror = () => finish(new Error('device tts failed'));

      try { speechSynthesis.cancel(); } catch (_) {}
      speechSynthesis.speak(u);

      // some browsers never fire onend — don't hang the queue
      setTimeout(() => finish(), Math.max(4000, String(text).length * 130));
    });
  }

  /** Speak `text` in `lang`. neural → Google → device → romanized English. */
  async function say(text, lang, roman) {
    const token = ++speakToken;
    const rate = state.settings.slow ? 0.85 : 1;
    const eng = state.settings.engine;
    const nepali = lang.toLowerCase().startsWith('ne');
    const v = await deviceVoice(lang);

    // Re-check the speech server before giving up on the neural voice, so a
    // voice change takes effect immediately instead of needing a page refresh.
    if (nepali && state.settings.ttsVoice !== 'google' && !state.localBase) {
      await ensureLocal();
    }

    const wantsNeural = state.settings.ttsVoice !== 'google'
      && state.settings.ttsVoice !== 'device';

    // 1. Neural voice via a speech server. The best of the lot, but optional:
    //    the app is fully usable as a plain PWA with nothing running anywhere.
    if (nepali && state.localBase && wantsNeural) {
      try { await speakNeural(text, rate); return 'neural'; }
      catch (e) {
        if (token !== speakToken) return 'aborted';
        console.warn('[kura] neural voice failed, falling back:', e.message);
      }
    }

    // 2. No server, no key, no cost: the phone's own Nepali voice. Tried
    //    BEFORE Google's legacy translate_tts, which is the robotic one.
    if (nepali && v && !state.localBase && eng !== 'online') {
      try { await speakDevice(text, lang, rate); return 'device'; }
      catch (e) { if (token !== speakToken) return 'aborted'; }
    }

    if (eng !== 'device' && navigator.onLine !== false) {
      try { await speakOnline(text, lang, rate); return 'online'; }
      catch (e) { if (token !== speakToken) return 'aborted'; }
    }
    if (eng !== 'online' && v) {
      try { await speakDevice(text, lang, rate); return 'device'; }
      catch (e) { if (token !== speakToken) return 'aborted'; }
    }
    if (nepali && roman) {
      try { await speakDevice(roman, 'en-US', rate * 0.92); return 'roman'; }
      catch (e) {}
    }
    throw new Error('no voice available');
  }

  /* =========================================================
     5. DOM helpers
     ========================================================= */
  const el = {
    srcCard: $('#srcCard'), srcText: $('#srcText'), srcLabel: $('#srcLabel'),
    dstCard: $('#dstCard'), dstText: $('#dstText'), dstLabel: $('#dstLabel'),
    romanText: $('#romanText'), dstHint: $('#dstHint'),
    micBtn: $('#micBtn'), micLabel: $('#micLabel'),
    typeToggle: $('#typeToggle'), typeRow: $('#typeRow'), typeInput: $('#typeInput'),
    dirLabel: $('#dirLabel'), swapBtn: $('#swapBtn'),
    showOverlay: $('#showOverlay'), showNe: $('#showNe'), showRoman: $('#showRoman'),
    showPlay: $('#showPlay'), showClose: $('#showClose'),
    phraseList: $('#phraseList'), catBar: $('#catBar'),
    logList: $('#logList'), clearLogBtn: $('#clearLogBtn'),
    toast: $('#toast')
  };

  let toastTimer;
  function toast(msg, ms = 2800) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  function setBusy(v) {
    state.busy = v;
    el.micBtn.classList.toggle('is-busy', v);
  }

  /** Show which recogniser produced the transcript — Google and local Whisper
      are worlds apart on Nepali, and guessing is a waste of everyone's time. */
  function setEngineTag(name, weak) {
    const tag = $('#engineTag');
    if (!tag) return;                       // never take the whole app down over a badge
    if (!name) { tag.hidden = true; tag.textContent = ''; return; }
    tag.hidden = false;
    tag.textContent = name;
    tag.classList.toggle('is-weak', !!weak);
  }

  function setSrc(text) {
    el.srcText.textContent = text;
    el.srcCard.classList.toggle('has-text', !!text);
  }

  function setDst(neText) {
    el.dstText.textContent = neText || '—';
    const roman = state.mode === 'en2ne' ? romanize(neText) : '';
    el.romanText.textContent = roman;
    el.dstCard.classList.toggle('is-live', !!neText);
    state.current = { src: el.srcText.textContent, dst: neText, roman };
    return roman;
  }

  /* =========================================================
     6. Core flow
     ========================================================= */
  async function handleUtterance(text) {
    text = (text || '').trim();
    if (!text) return;

    const cfg = L[state.mode];
    setSrc(text);
    setBusy(true);
    el.dstHint.textContent = 'Translating…';

    try {
      const out = await translate(text, cfg.from, cfg.to);
      const roman = setDst(out);
      hideMicError();
      pushLog(text, out);
      el.dstHint.textContent = state.mode === 'en2ne'
        ? 'Spoken aloud in Nepali automatically.'
        : 'Read aloud in English automatically.';

      if (state.settings.autoSpeak) {
        say(out, cfg.dstLang, roman).catch(() => {
          toast('Translated — but no voice available. Show the screen instead.');
        });
      }
    } catch (e) {
      el.dstHint.textContent = 'Translation failed.';
      toast('Translation failed — check your connection, or use the phrasebook.');
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- speech recognition ---------------- */
  let recog = null;
  let browserAsrFailed = false;   // sticky: once Google's engine fails, use Whisper

  function stopListening() {
    if (recog) { try { recog.stop(); } catch (_) {} }
    setListening(false);
  }

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast('Speech input is not supported in this browser. Type instead.');
      openTypeRow(true);
      return;
    }
    if (state.listening) { stopListening(); return; }
    if (state.busy) return;

    recog = new SR();
    const cfg = L[state.mode];
    recog.lang = cfg.srcLang;
    recog.interimResults = true;
    recog.continuous = false;
    recog.maxAlternatives = 1;

    let finalText = '';

    recog.onstart = () => {
      hideMicError();
      setListening(true, 'Listening… release to translate');
      el.dstHint.textContent = 'Speak, then let go.';
    };

    recog.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) setSrc(finalText + interim);
    };

    recog.onerror = (ev) => {
      const map = {
        'not-allowed':      'Microphone blocked. Allow mic access in your browser settings.',
        'service-not-allowed': 'Microphone blocked by the browser.',
        'no-speech':        "Didn't catch that — try again.",
        'audio-capture':    'No microphone found.',
        'network':          'Speech needs a connection. Type instead?',
        'aborted':          ''
      };
      const msg = map[ev.error] !== undefined ? map[ev.error] : 'Speech error: ' + ev.error;
      state.capturing = false;
      el.micBtn.classList.remove('is-holding');
      setListening(false);
      el.dstHint.textContent = '';

      if (ev.error === 'network') {
        // Chrome streams audio to Google's speech service; when that call fails
        // the API only ever reports "network", even on a perfectly good connection.
        browserAsrFailed = true;   // next attempt uses the local model instead
        showMicError(
          'Browser speech service failed',
          'Chrome sends your audio to Google for recognition, and that request failed. '
          + 'This happens behind proxies, with privacy extensions blocking it, or when Chrome\u2019s '
          + 'built-in key is rate-limited. Type your sentence below, or add your own voice '
          + 'endpoint in Settings \u2192 Voice input.',
          { retry: true }
        );
        return;
      }

      if (ev.error === 'language-not-supported') openTypeRow(true);
      if (msg) toast(msg, 3200);
    };

    recog.onend = () => {
      // The recogniser stops itself on silence; release the hold state so the
      // next tap starts a new turn instead of trying to end the last one.
      state.capturing = false;
      el.micBtn.classList.remove('is-holding');
      setListening(false);
      if (finalText.trim()) {
        setEngineTag('via Google');
        handleUtterance(finalText.trim());
      }
    };

    try { recog.start(); }
    catch (e) { toast('Could not start the mic. Try again.'); }
  }

  /* =========================================================
     6b. Microphone UI state + recorded-audio fallback
     Chrome's built-in recogniser is a black box that fails with a
     useless "network" error. If the user supplies their own
     Whisper-compatible endpoint, we record and upload instead —
     which also works with a local server, i.e. fully offline.
     ========================================================= */
  const idleLabel = () => (state.mode === 'en2ne' ? 'Hold to talk' : 'Hold while they talk');

  function setListening(on, label) {
    state.listening = on;
    el.micBtn.classList.toggle('is-rec', on);
    el.micLabel.textContent = on ? (label || 'Listening…') : idleLabel();
  }

  function showMicError(title, body, opts) {
    opts = opts || {};
    $('#micErrTitle').textContent = title;
    $('#micErrBody').textContent = body;
    $('#micRetry').hidden = !opts.retry;
    $('#micError').hidden = false;
    state.capturing = false;       // never leave the button latched on a failure
    el.micBtn.classList.remove('is-holding');
    setListening(false);
  }

  function hideMicError() { $('#micError').hidden = true; }

  let recorder = null;
  let recChunks = [];
  let recTimer = null;

  /** Explicit setting wins; otherwise any locally running Kura speech server. */
  const activeStt = () => state.settings.sttEndpoint
    || (state.localBase ? state.localBase + '/v1/audio/transcriptions' : '');

  async function probeLocalServer() {
    // 1. Same origin — this is how the phone reaches the PC. If the page was
    //    served by stt_server.py (directly or through a tunnel), /health is here.
    const candidates = [location.origin];
    // 2. Desktop fallback: static server on :8080, speech server on :8081.
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      candidates.push('http://127.0.0.1:8081');
    }

    for (const base of candidates) {
      try {
        const res = await fetch(base + '/health', { cache: 'no-store' });
        if (!res.ok) continue;
        const info = await res.json();
        if (!info) continue;
        state.localBase = base;
        state.localReady = !!info.ready;
        if (!probeAnnounced) {          // one toast, not one per retry
          probeAnnounced = true;
          toast('Voice server connected — natural Nepali voice' + (info.ready ? ' + mic' : ''), 3000);
        }
        return;
      } catch (_) { /* try the next candidate */ }
    }
  }

  /** The startup probe can lose a race with a server that isn't up yet (or was
      restarted mid-session). Without a retry, every voice silently degrades to
      Google's robot — which reads as "changing the voice does nothing". */
  let probeAnnounced = false;
  let lastProbeAt = 0;
  async function ensureLocal(minGapMs = 4000) {
    if (state.localBase) return true;
    if (Date.now() - lastProbeAt < minGapMs) return false;
    lastProbeAt = Date.now();
    await probeLocalServer();
    return !!state.localBase;
  }

  /** Say precisely WHY the mic failed — "blocked" and "no device" are different fixes. */
  async function micDiagnose(err) {
    const name = (err && err.name) || '';

    if (!window.isSecureContext) {
      return 'This page is on a plain http:// network address, and browsers refuse '
        + 'the microphone there — the hardware is fine, the origin is not. Open the '
        + 'app on localhost, over https://, or use the tunnel / chrome-flags route.';
    }
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return 'Chrome is blocking the mic for this site (this is a browser permission, '
        + 'not a hardware fault). Click the mic/padlock icon in the address bar, set '
        + 'Microphone to Allow, then reload.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(d => d.kind === 'audioinput');
        if (inputs.length) {
          return `Windows sees ${inputs.length} microphone(s) but none was usable. `
            + 'Check Settings → Privacy → Microphone, and that no other app is holding it.';
        }
        return 'No microphone is connected to this device.';
      } catch (_) {
        return 'No microphone found.';
      }
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'The microphone is busy — another app is holding it. Close that app and retry.';
    }
    return 'The mic could not start (' + (name || 'unknown error') + ').';
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      return showMicError('Recording not supported',
        'This browser cannot record audio. Type your sentence instead.', { retry: false });
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      return showMicError('Microphone unavailable', await micDiagnose(e), { retry: true });
    }

    // The user can release the button while we're still waiting for the device
    // to open. Nothing was captured in that window, so don't produce an empty
    // clip — tell them to hold a moment longer.
    if (!state.capturing) {
      stream.getTracks().forEach(t => t.stop());
      toast('Hold the button while you speak.', 2200);
      return;
    }

    recChunks = [];
    let mime = '';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
    else if (MediaRecorder.isTypeSupported('audio/mp4')) mime = 'audio/mp4';

    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      stream.getTracks().forEach(t => t.stop());
      return showMicError('Recording failed', String(e.message || e), { retry: true });
    }

    recorder.ondataavailable = ev => { if (ev.data && ev.data.size) recChunks.push(ev.data); };

    recorder.onstop = async () => {
      clearTimeout(recTimer);
      stream.getTracks().forEach(t => t.stop());
      setListening(false);

      const type = recorder.mimeType || 'audio/webm';
      const blob = new Blob(recChunks, { type });
      recChunks = [];
      // Only reject clips too small to contain speech at all; let Whisper judge
      // anything longer (a quick "how much?" is short but legitimate).
      if (blob.size < 700) { toast('Too short — hold the button a moment longer.'); return; }

      setBusy(true);
      el.dstHint.textContent = 'Transcribing…';
      try {
        const text = await transcribe(blob, type);
        if (!text) { el.dstHint.textContent = ''; return toast("Didn't catch that — try again."); }
        hideMicError();
        // Local Whisper is fine for English and genuinely poor for Nepali —
        // flag it so a bad result doesn't look like a translation bug.
        setEngineTag('via local Whisper', state.mode === 'ne2en');
        handleUtterance(text);
      } catch (err) {
        el.dstHint.textContent = '';
        showMicError('Transcription failed',
          String(err.message || err) + '. Check the endpoint in Settings → Voice input.',
          { retry: true });
      } finally {
        setBusy(false);
      }
    };

    recorder.start();
    setListening(true, 'Listening… release to translate');
    recTimer = setTimeout(stopRecording, 20000);   // safety cap, not the normal path
  }

  function stopRecording() {
    clearTimeout(recTimer);
    try { if (recorder && recorder.state === 'recording') recorder.stop(); } catch (_) {}
  }

  async function transcribe(blob, type) {
    const s = state.settings;
    const fd = new FormData();
    fd.append('file', blob, 'clip.' + (type.indexOf('mp4') >= 0 ? 'mp4' : 'webm'));
    fd.append('model', s.sttModel || 'whisper-1');
    fd.append('response_format', 'json');

    fd.append('language', state.mode === 'en2ne' ? 'en' : 'ne');

    // Whisper picks the output script from the prompt. Without a Devanagari
    // prompt it transcribes Nepali into English words that sound vaguely right
    // ("you got the whole") — the exact failure the user keeps hitting.
    if (state.mode === 'ne2en') {
      fd.append('prompt', 'यो कति हो? बस पार्क कहाँ छ? मलाई गाइड चाहियो। '
        + 'एक रातको कति? खाना कहाँ पाइन्छ? धन्यवाद।');
    }

    const headers = {};
    if (s.sttKey) headers.Authorization = 'Bearer ' + s.sttKey;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40000);
    let res;
    try {
      res = await fetch(activeStt(), { method: 'POST', headers, body: fd, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new Error('server said HTTP ' + res.status);
    const data = await res.json();
    return String(
      data.text ||
      (data.results && data.results[0] && (data.results[0].transcript || data.results[0].text)) ||
      ''
    ).trim();
  }

  /* Push-to-talk: press and hold to capture, release to translate. */
  function beginCapture() {
    if (state.capturing) return;
    hideMicError();
    state.capturing = true;
    el.micBtn.classList.add('is-holding');

    // Two capture paths, and which one ran must be remembered: stopping the
    // wrong one leaves the mic open forever (or translates nothing).
    //   browser → Chrome/Android's Google-backed recogniser
    //   record  → record locally, POST to Whisper
    // English goes via Google because it is excellent at it and returns in a
    // second; Nepali also prefers it, since local Whisper is weak at Nepali.
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR && !browserAsrFailed) {
      state.capturePath = 'browser';
      startListening();
      return;
    }

    if (activeStt()) {
      state.capturePath = 'record';
      startRecording();                  // may await getUserMedia
    } else {
      state.capturePath = 'browser';
      startListening();
    }
  }

  function endCapture() {
    if (!state.capturing) return;
    state.capturing = false;
    el.micBtn.classList.remove('is-holding');

    if (state.capturePath === 'record') stopRecording();
    else stopListening();                // recog.stop() finalises → onend translates
  }

  /* Hold-to-talk in both directions: press, speak, release to translate. */
  function micPress() { beginCapture(); }
  function micRelease() { endCapture(); }

  /* =========================================================
     7. History
     ========================================================= */
  function loadLog() {
    try { state.log = JSON.parse(localStorage.getItem(LS_LOG) || '[]') || []; }
    catch (_) { state.log = []; }
  }

  function pushLog(src, dst) {
    state.log.unshift({ src, dst, mode: state.mode, ts: Date.now() });
    state.log = state.log.slice(0, 60);
    try { localStorage.setItem(LS_LOG, JSON.stringify(state.log)); } catch (_) {}
    renderLog();
  }

  function renderLog() {
    el.logList.innerHTML = '';
    if (!state.log.length) {
      el.logList.innerHTML = '<p class="log-empty">Nothing yet. Your translations show up here.</p>';
      return;
    }
    state.log.forEach(item => {
      const b = document.createElement('button');
      b.className = 'log-item';
      const roman = item.mode === 'en2ne' ? romanize(item.dst) : '';
      b.innerHTML = `<span class="l-src">${escapeHtml(item.src)}</span>`
                  + `<span class="l-dst">${escapeHtml(item.dst)}</span>`
                  + (roman ? `<span class="l-roman">${escapeHtml(roman)}</span>` : '');
      b.addEventListener('click', () => openShow(item.dst, roman, item.mode));
      el.logList.appendChild(b);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  /* =========================================================
     8. Phrasebook
     ========================================================= */
  function renderCats() {
    el.catBar.innerHTML = '';
    (window.PHRASE_CATS || []).forEach(c => {
      const b = document.createElement('button');
      b.className = 'cat' + (state.cat === c.id ? ' is-active' : '');
      b.textContent = c.label;
      b.setAttribute('aria-pressed', String(state.cat === c.id));
      b.addEventListener('click', () => { state.cat = c.id; renderCats(); renderPhrases(); });
      el.catBar.appendChild(b);
    });
  }

  function renderPhrases() {
    const all = window.PHRASES || [];
    const list = state.cat === 'all' ? all : all.filter(p => p.c === state.cat);
    el.phraseList.innerHTML = '';
    list.forEach(p => {
      const b = document.createElement('button');
      b.className = 'phrase';
      b.innerHTML = `<span class="p-en">${escapeHtml(p.en)}</span>`
                  + `<span class="p-ne">${escapeHtml(p.ne)}</span>`
                  + `<span class="p-roman">${escapeHtml(romanize(p.ne))}</span>`;
      b.addEventListener('click', () => openShow(p.ne, romanize(p.ne), 'en2ne'));
      el.phraseList.appendChild(b);
    });
  }

  /* =========================================================
     9. Show overlay
     ========================================================= */
  let showCtx = { text: '', roman: '', mode: 'en2ne' };

  function openShow(text, roman, mode) {
    showCtx = { text: text || '', roman: roman || '', mode: mode || 'en2ne' };
    el.showNe.textContent = showCtx.text;
    el.showRoman.textContent = showCtx.roman;
    $('#showTag').textContent = showCtx.mode === 'en2ne' ? 'नेपाली' : 'ENGLISH';
    el.showOverlay.hidden = false;
    document.addEventListener('keydown', escClose);
  }

  function closeShow() {
    el.showOverlay.hidden = true;
    document.removeEventListener('keydown', escClose);
  }

  function escClose(e) { if (e.key === 'Escape') closeShow(); }

  /* =========================================================
     10. Settings
     ========================================================= */
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SET) || '{}');
      Object.assign(state.settings, s || {});
    } catch (_) {}
  }

  function saveSettings() {
    try { localStorage.setItem(LS_SET, JSON.stringify(state.settings)); } catch (_) {}
  }

  function syncSettingsUI() {
    $('#setAutoSpeak').checked = !!state.settings.autoSpeak;
    $('#setSlow').checked = !!state.settings.slow;
    $('#setEngine').value = state.settings.engine;
    $('#setVoice').value = state.settings.ttsVoice || 'ne-NP-HemkalaNeural';
    $('#sttEndpoint').value = state.settings.sttEndpoint || '';
    $('#sttKey').value = state.settings.sttKey || '';
    $('#sttModel').value = state.settings.sttModel || '';
    updateEngineNote();
  }

  function updateEngineNote() {
    const note = $('#engineNote');
    const voice = state.settings.ttsVoice;

    if (voice === 'google') {
      note.textContent = 'Google legacy voice — the robotic one. Pick the phone '
        + 'voice for free offline speech, or run the speech server for the neural voice.';
      return;
    }
    if (voice === 'device') {
      note.textContent = 'Using your phone\u2019s built-in voice — free, offline, '
        + 'no server. If it sounds wrong or is missing, add a Nepali voice in your '
        + 'phone\u2019s text-to-speech settings.';
      return;
    }
    if (state.localBase) {
      const who = voice.indexOf('Sagar') >= 0 ? 'Sagar' : 'Hemkala';
      note.textContent = `Using the local neural voice (${who}) — this is the natural one.`;
      return;
    }
    deviceVoice('ne-NP').then(v => {
      note.textContent = v
        ? `No speech server, so using your phone\u2019s Nepali voice (${v.name}). `
          + 'The neural Hemkala/Sagar voices need the server.'
        : 'No speech server, and no Nepali voice installed on this phone — Google\u2019s '
          + 'online voice is used instead. Add a Nepali voice in Android settings for offline speech.';
    });
  }

  /* =========================================================
     11. Mode / direction
     ========================================================= */
  function applyMode() {
    const cfg = L[state.mode];
    el.srcLabel.textContent = cfg.srcLabel;
    el.dstLabel.textContent = cfg.dstLabel;
    el.typeInput.placeholder = cfg.placeholder;
    el.dirLabel.textContent = state.mode === 'en2ne' ? 'English → नेपाली' : 'नेपाली → English';
    setEngineTag('');
    setSrc(state.mode === 'en2ne'
      ? 'Hold the mic and say it in English'
      : 'Hold the mic, point it at them, and let them talk');
    el.dstText.textContent = '—';
    el.romanText.textContent = '';
    el.dstCard.classList.remove('is-live');
    el.dstHint.textContent = state.mode === 'en2ne'
      ? 'The Nepali is spoken out loud automatically.'
      : 'Reads it out in English as soon as you let go.';
    el.micLabel.textContent = idleLabel();
    const empty = $('#emptyState');          // chips removed from the UI; keep this optional
    if (empty) empty.hidden = state.mode !== 'en2ne';
    $$('#dirSwitch button').forEach(b =>
      b.classList.toggle('is-active', b.dataset.mode === state.mode));
    state.current = null;
  }

  function setMode(mode) {
    if (mode !== 'en2ne' && mode !== 'ne2en') return;
    if (state.mode === mode) return;
    if (state.capturing) endCapture();
    state.mode = mode;
    applyMode();
  }

  /* =========================================================
     12. Wiring
     ========================================================= */
  function openTypeRow(force) {
    const show = force !== undefined ? force : el.typeRow.hidden;
    el.typeRow.hidden = !show;
    el.micBtn.style.display = show ? 'none' : '';
    if (show) el.typeInput.focus();
  }

  function init() {
    loadLog(); renderLog();
    loadSettings(); syncSettingsUI();
    renderCats(); renderPhrases();

    // Manifest shortcuts open straight into a direction (?mode=ne2en).
    const wanted = new URLSearchParams(location.search).get('mode');
    if (wanted === 'ne2en' || wanted === 'en2ne') state.mode = wanted;

    applyMode();

    /* ---------------- install as an app ---------------- */
    const standalone = () => window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    const installBtn = $('#installBtn');
    const installHint = $('#installHint');
    let deferredPrompt = null;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    /** Why no install prompt? Say it plainly instead of leaving the section blank. */
    function installBlocker() {
      if (!window.isSecureContext) {
        return 'This page is on a plain http:// address, and browsers only allow installing '
          + 'apps from https:// (or localhost). Put these files on a free https host, '
          + 'open that link, and the Install button appears here.';
      }
      if (!('serviceWorker' in navigator)) {
        return 'This browser cannot install web apps. Open the https:// link in Chrome '
          + 'on Android, or Safari on iPhone.';
      }
      return null;
    }

    function refreshInstallUI() {
      if (!installBtn || !installHint) return;   // removed from the markup? never crash

      if (standalone()) { installBtn.hidden = true; installHint.hidden = true; return; }

      if (deferredPrompt) {
        installBtn.hidden = false;
        installHint.hidden = true;
        return;
      }

      // No native prompt. Never leave this section empty — that reads as
      // "the app has no install option at all", which is how it was reported.
      installBtn.hidden = true;
      installHint.hidden = false;

      const blocked = installBlocker();
      if (blocked) { installHint.textContent = blocked; return; }

      // iOS never fires beforeinstallprompt — Share is the only route.
      if (isIOS) {
        installHint.textContent = 'To install: tap the Share button, then "Add to Home Screen".';
        return;
      }
      installHint.textContent = 'To install: open your browser menu (⋮) and choose '
        + '"Install app" or "Add to Home screen". If it is missing, the app has to be '
        + 'served over https:// first.';
    }

    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();          // keep Chrome's mini-infobar out of the way
      deferredPrompt = e;
      refreshInstallUI();
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      installBtn.hidden = true;
      installHint.hidden = true;
      toast('Kura installed — open it from your home screen.', 3400);
    });
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return toast('Use your browser menu → "Add to Home screen".');
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (_) {}
      deferredPrompt = null;
      refreshInstallUI();
    });
    refreshInstallUI();

    // tabs
    $$('.tab').forEach(t => t.addEventListener('click', () => {
      $$('.tab').forEach(x => { x.classList.remove('is-active'); x.setAttribute('aria-selected', 'false'); });
      t.classList.add('is-active');
      t.setAttribute('aria-selected', 'true');
      $$('.screen').forEach(s => s.classList.remove('is-active'));
      $('#screen-' + t.dataset.tab).classList.add('is-active');
    }));

    // Push-to-talk. Pointer events cover mouse, touch and pen in one path.
    const mic = el.micBtn;

    mic.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Capture the pointer so a finger sliding off the button still delivers
      // its pointerup — otherwise the recording never stops.
      try { mic.setPointerCapture(e.pointerId); } catch (_) {}
      micPress();
    });

    mic.addEventListener('pointerup', (e) => { e.preventDefault(); micRelease(); });
    mic.addEventListener('pointercancel', micRelease);
    mic.addEventListener('lostpointercapture', micRelease);
    mic.addEventListener('contextmenu', (e) => e.preventDefault());  // no long-press menu
    mic.addEventListener('dragstart', (e) => e.preventDefault());

    // Keyboard access: hold Space or Enter.
    mic.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        micPress();
      }
    });
    mic.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        micRelease();
      }
    });
    mic.addEventListener('blur', micRelease);

    // "Try again" re-runs the permission request without recording anything,
    // which is what actually re-triggers the browser prompt.
    $('#micRetry').addEventListener('click', async () => {
      hideMicError();
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach(t => t.stop());
        toast('Microphone is working — hold the button and speak.', 2600);
      } catch (e) {
        showMicError('Microphone unavailable', await micDiagnose(e), { retry: true });
      }
    });

    $('#micType').addEventListener('click', () => { hideMicError(); openTypeRow(true); });
    el.typeToggle.addEventListener('click', () => openTypeRow());
    el.typeRow.addEventListener('submit', e => {
      e.preventDefault();
      const v = el.typeInput.value.trim();
      if (!v) return;
      el.typeInput.value = '';
      handleUtterance(v);
    });

    // replay / show
    $('#replayBtn').addEventListener('click', () => {
      if (!state.current || !state.current.dst) return toast('Nothing to re-hear yet.');
      const cfg = L[state.mode];
      say(state.current.dst, cfg.dstLang, state.current.roman)
        .catch(() => toast('No voice available — use the ⤢ show button instead.'));
    });
    el.dstCard.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      if (!state.current || !state.current.dst) return;
      openShow(state.current.dst, state.current.roman, state.mode);
    });
    $('#showBtn').addEventListener('click', () => {
      if (!state.current || !state.current.dst) return toast('Nothing to show yet.');
      openShow(state.current.dst, state.current.roman, state.mode);
    });

    // direction switch — the big one
    $$('#dirSwitch button').forEach(b => {
      b.addEventListener('click', () => setMode(b.dataset.mode));
    });

    // the small header ⇄ does the same thing
    el.swapBtn.addEventListener('click', () => {
      setMode(state.mode === 'en2ne' ? 'ne2en' : 'en2ne');
    });

    // try chips
    $$('.chip').forEach(c => c.addEventListener('click', () => handleUtterance(c.dataset.try)));

    // show overlay
    el.showClose.addEventListener('click', closeShow);
    $('#showX').addEventListener('click', closeShow);
    el.showPlay.addEventListener('click', () => {
      const cfg = L[showCtx.mode || 'en2ne'];
      say(showCtx.text, cfg.dstLang, showCtx.roman).catch(() => toast('No voice available right now.'));
    });

    // settings
    $('#settingsBtn').addEventListener('click', () => { $('#sheetBackdrop').hidden = false; });
    $('#sheetDone').addEventListener('click', () => { $('#sheetBackdrop').hidden = true; });
    $('#sheetBackdrop').addEventListener('click', e => {
      if (e.target.id === 'sheetBackdrop') $('#sheetBackdrop').hidden = true;
    });
    $('#setAutoSpeak').addEventListener('change', e => { state.settings.autoSpeak = e.target.checked; saveSettings(); });
    $('#setSlow').addEventListener('change', e => { state.settings.slow = e.target.checked; saveSettings(); });
    $('#setEngine').addEventListener('change', e => { state.settings.engine = e.target.value; saveSettings(); updateEngineNote(); });

    // Switch voice → hear it immediately. This is the whole point of the control.
    $('#setVoice').addEventListener('change', e => {
      state.settings.ttsVoice = e.target.value;
      saveSettings();
      updateEngineNote();
      hideMicError();
      say('नमस्ते। यो कति हो?', 'ne-NP', 'namaste. yo kati ho?').catch(() => {});
    });

    [['#sttEndpoint', 'sttEndpoint'], ['#sttKey', 'sttKey'], ['#sttModel', 'sttModel']].forEach(([sel, key]) => {
      const input = $(sel);
      input.addEventListener('change', () => {
        state.settings[key] = input.value.trim();
        saveSettings();
      });
    });

    el.clearLogBtn.addEventListener('click', () => {
      state.log = [];
      try { localStorage.removeItem(LS_LOG); } catch (_) {}
      renderLog();
    });

    // unlock audio on first gesture (iOS / autoplay policy)
    const unlock = () => {
      const silent = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      const a = new Audio(silent);
      a.play().catch(() => {});
      document.removeEventListener('pointerdown', unlock);
    };
    document.addEventListener('pointerdown', unlock);

    // warm the voice list
    if ('speechSynthesis' in window) {
      try { speechSynthesis.getVoices(); } catch (_) {}
    }

    probeLocalServer();

    // offline app shell
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  // expose for debugging / tests
  window.Kura = { romanize, translate, chunkText, state };

})();
