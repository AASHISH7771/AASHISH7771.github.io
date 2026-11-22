/* Kura — offline-capable phrasebook.
   Nepali text produced by machine translation, then manually corrected
   (see tools/phrases.report.txt for the raw MT + round-trip output). */

window.PHRASES = [
  // ---------- greetings ----------
  { c: "greet", en: "Hello / greetings",            ne: "नमस्ते" },
  { c: "greet", en: "Thank you",                    ne: "धन्यवाद" },
  { c: "greet", en: "Sorry / excuse me",            ne: "माफ गर्नुहोस्" },
  { c: "greet", en: "Yes",                          ne: "हो" },
  { c: "greet", en: "No",                           ne: "होइन" },
  { c: "greet", en: "Do you speak English?",        ne: "तपाईं अंग्रेजी बोल्नुहुन्छ?" },
  { c: "greet", en: "I don't understand",           ne: "मैले बुझिनँ" },
  { c: "greet", en: "Please help me",               ne: "कृपया मलाई मद्दत गर्नुहोस्" },

  // ---------- money ----------
  { c: "money", en: "How much is this?",            ne: "यो कति हो?" },
  { c: "money", en: "That's too expensive",         ne: "त्यो धेरै महँगो छ" },
  { c: "money", en: "Can you make it cheaper?",     ne: "अलि सस्तो गर्नुहोस् न" },
  { c: "money", en: "Where is the ATM?",            ne: "एटीएम कहाँ छ?" },
  { c: "money", en: "I'll take it",                 ne: "यही लिन्छु" },

  // ---------- transport ----------
  { c: "move", en: "Where is the bus station?",     ne: "बस पार्क कहाँ छ?" },
  { c: "move", en: "How far is it?",                ne: "कति टाढा छ?" },
  { c: "move", en: "Please take me to this address", ne: "मलाई यो ठेगानामा लैजानुहोस्" },
  { c: "move", en: "Stop here please",              ne: "यहीं रोक्नुहोस्" },
  { c: "move", en: "How long does it take?",        ne: "कति समय लाग्छ?" },

  // ---------- food ----------
  { c: "food", en: "I want this one",               ne: "यो चाहियो" },
  { c: "food", en: "Vegetarian food",               ne: "शाकाहारी खाना" },
  { c: "food", en: "Not spicy please",              ne: "पिरो नहाल्नुहोस्" },
  { c: "food", en: "Water please",                  ne: "पानी दिनुहोस्" },
  { c: "food", en: "The bill please",               ne: "बिल ल्याउनुहोस्" },

  // ---------- stay / trek ----------
  { c: "stay", en: "Do you have a room available?", ne: "कोठा छ?" },
  { c: "stay", en: "How much per night?",           ne: "एक रातको कति?" },
  { c: "stay", en: "Is there hot water?",           ne: "तातो पानी छ?" },
  { c: "stay", en: "Which way is the trekking trail?", ne: "ट्रेकिङ बाटो कुन तिर छ?" },
  { c: "stay", en: "I need a guide",                ne: "मलाई गाइड चाहियो" },

  // ---------- emergency ----------
  { c: "sos", en: "Help!",                          ne: "मद्दत गर्नुहोस्!" },
  { c: "sos", en: "Please call a doctor",           ne: "डाक्टरलाई बोलाउनुहोस्" },
  { c: "sos", en: "I am sick",                      ne: "मलाई बिरामी छ" },
  { c: "sos", en: "Where is the police station?",   ne: "प्रहरी चौकी कहाँ छ?" },
  { c: "sos", en: "I am lost",                      ne: "म हराएँ" }
];

window.PHRASE_CATS = [
  { id: "all",   label: "All" },
  { id: "greet", label: "Basics" },
  { id: "money", label: "Money" },
  { id: "move",  label: "Getting around" },
  { id: "food",  label: "Food" },
  { id: "stay",  label: "Stay & trek" },
  { id: "sos",   label: "Emergency" }
];
