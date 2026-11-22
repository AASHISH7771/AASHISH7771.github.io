/* Devanagari → readable Latin transliteration.
   Not scholarly IAST — it's tuned so a tourist can pronounce what's on screen.
   Works as a browser global (window.romanize) and as a CommonJS module. */

(function (root) {
  'use strict';

  const CONS = {
    'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng',
    'च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
    'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n',
    'त':'t','थ':'th','द':'d','ध':'dh','न':'n',
    'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m',
    'य':'y','र':'r','ल':'l','व':'b','श':'sh','ष':'sh','स':'s','ह':'h',
    'ळ':'l','क़':'q','ख़':'kh','ग़':'g','ज़':'z','ड़':'r','ढ़':'rh','फ़':'f'
  };

  // Long vowels are collapsed to single letters: the tourist needs something
  // they can pronounce in one go, not linguistic accuracy.
  const IND_VOWEL = {
    'अ':'a','आ':'aa','इ':'i','ई':'i','उ':'u','ऊ':'u','ऋ':'ri','ॠ':'ri',
    'ऌ':'li','ए':'e','ऐ':'ai','ओ':'o','औ':'au'
  };

  const MATRA = {
    'ा':'aa','ि':'i','ी':'i','ु':'u','ू':'u','ृ':'ri','ॄ':'ri',
    'े':'e','ै':'ai','ॉ':'o','ो':'o','ौ':'au'
  };

  const DIGITS = {
    '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9'
  };

  const PUNCT = /[\s,.;:!?()\[\]"'“”‘’—–\-\/]/;

  function romanize(input) {
    if (!input) return '';

    const chars = Array.from(String(input).normalize('NFC'));
    const out = [];
    let pending = false;  // a consonant is waiting for its vowel
    let wordLen = 0;      // Devanagari letters seen in the current word

    const keepInherent = () => {
      if (pending) { out.push('a'); pending = false; }
    };

    // A word-final inherent "a" is usually silent in Nepali (khar-ch, not
    // khar-cha) — except in one-letter words like म (ma) and छ (chha).
    const closeWord = () => {
      if (pending && wordLen <= 1) out.push('a');
      pending = false;
      wordLen = 0;
    };

    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];

      if (CONS[c]) {
        keepInherent();
        out.push(CONS[c]);
        pending = true;
        wordLen++;
        continue;
      }
      if (MATRA[c]) {
        out.push(MATRA[c]);
        pending = false;
        wordLen++;
        continue;
      }
      if (c === '्') { pending = false; wordLen++; continue; }  // virama kills the inherent vowel
      if (c === 'ं' || c === 'ँ') {                             // anusvara / candrabindu
        keepInherent();                                          // बुझिनँ → bujhinan, not bujhinn
        out.push('n');
        pending = false;
        wordLen++;
        continue;
      }
      if (c === 'ः') { out.push('h'); pending = false; wordLen++; continue; }
      if (c === '़') { continue; }                              // stray nukta
      if (IND_VOWEL[c]) { keepInherent(); out.push(IND_VOWEL[c]); pending = false; wordLen++; continue; }
      if (DIGITS[c] !== undefined) { keepInherent(); out.push(DIGITS[c]); pending = false; wordLen++; continue; }

      if (c === '।') { closeWord(); out.push('.'); continue; }

      if (PUNCT.test(c)) {
        closeWord();
        out.push(c);
        continue;
      }

      keepInherent();
      out.push(c);
      wordLen++;
    }

    closeWord();

    return out.join('').replace(/\s+/g, ' ').trim();
  }

  if (typeof module === 'object' && module.exports) module.exports = { romanize };
  else root.romanize = romanize;

})(typeof self !== 'undefined' ? self : this);
