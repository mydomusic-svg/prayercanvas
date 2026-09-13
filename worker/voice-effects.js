// Voice presets for the Funny Cartoon category, keyed by the
// cartoon_characters.voice_effect column (0018_cartoon_voice_effect.sql).
//
// Shared between the render worker and scripts/sample-cartoon-voices.mjs so
// that a sample you listen to is the chain that will actually be rendered.
// It lived inside worker/index.js and the sample script had no access to
// it, which meant every judgement about how these voices sound was made on
// audio missing half the processing. Two copies would have drifted within a
// week; this is one.
//
// PITCH IS BACK, modestly, and the history matters because it explains the
// numbers.
//
// The first attempt used 0.75 to 1.45 and was unusable — but not for the
// reason everyone assumed. `asetrate` reinterprets a stream's sample rate
// rather than scaling pitch, so `asetrate=44100*p` only means "p times
// faster" if the input really is 44100. OpenAI returns 24kHz, so every
// cartoon voice played 1.8375x too fast: a 30-second read arrived in 16.
// The compensating atempo undid the pitch ratio and knew nothing about the
// rate mismatch, so the error survived it. Three rounds of "still too fast"
// chased tempo settings that were never the problem.
//
// With that fixed (see the aresample=44100 bracket in buildFilterComplex),
// pitch does what it was always supposed to do: raise the formants without
// touching the pace. That is also the only lever that makes an adult voice
// read as young — no OpenAI model ships a child voice, and no amount of
// delivery instruction changes the size of the speaker you hear. Bright
// voices and playful direction got these as far as "cheerful adult", which
// is exactly where the feedback landed: "they sound like adults".
//
// So the values below are small on purpose. 1.10 to 1.22, not 1.45. Enough
// to shrink the apparent speaker, short of the squeak where consonants
// start dissolving and a prayer stops being followable — which defeats the
// point, however funny the voice.
//
// `rate` is an extra tempo multiplier applied after the pitch compensation.
// It stays at 1.0 everywhere: pace is set in the TTS request and in the
// delivery instructions, and adding a third place to control it is how the
// last tangle started.
export const VOICE_EFFECTS = {
  // Nasal and honking: scoop the chest register out and push the 1.5-2.5kHz
  // "quack" band hard. Pitched up the most after the squirrel — a duck that
  // sounds like a man honking is just a man honking.
  duck: {
    pitch: 1.18,
    rate: 1.0,
    chain:
      "equalizer=f=400:width_type=q:w=1.0:g=-6," +
      "equalizer=f=1900:width_type=q:w=1.1:g=7," +
      "vibrato=f=6.5:d=0.12",
  },
  // Small and bright: the highest lift of the set, because a squirrel is the
  // smallest animal here and the name is literally the effect.
  chipmunk: {
    pitch: 1.22,
    rate: 1.0,
    chain: "equalizer=f=2600:width_type=q:w=1.0:g=4,vibrato=f=5:d=0.07",
  },
  // Airy rather than squeaky — the lightest touch of the set.
  sparkle: {
    pitch: 1.14,
    rate: 1.0,
    chain: "equalizer=f=3000:width_type=q:w=1.0:g=3,vibrato=f=4.5:d=0.06",
  },
  // Not-from-here: chorus detunes copies of the voice against itself, which
  // reads as "modulated" without moving the words.
  alien: {
    pitch: 1.16,
    rate: 1.0,
    chain:
      "chorus=0.6:0.9:50|60:0.4|0.32:0.25|0.4:2|1.3,tremolo=f=5:d=0.18",
  },
  // Big and rumbling, and the one deliberately held back. A bear should
  // still sound big; 1.10 takes the grown-man edge off `ballad` without
  // turning a bear into a cub. If Boomer still reads adult he can go to
  // 1.14, but past that he stops being a bear.
  bear: {
    pitch: 1.10,
    rate: 1.0,
    chain:
      "equalizer=f=140:width_type=q:w=1.0:g=6," +
      "equalizer=f=2500:width_type=q:w=1.0:g=-3",
  },
};

/**
 * The ffmpeg audio filter stages for one voice effect, in order.
 *
 * Exported rather than inlined so the worker and the sample script build
 * byte-identical chains. If you are reading this because a sample sounded
 * different from a render, that is the bug this function exists to prevent
 * — check that both callers go through it.
 */
export function voiceEffectStages(pitch, rate, chain) {
  const stages = [];

  if (pitch !== 1.0 || rate !== 1.0) {
    const tempo = (1 / pitch) * rate;

    if (pitch !== 1.0) {
      // NORMALISE TO 44.1kHz FIRST — see the long note at the top. Without
      // the bracketing aresample calls, asetrate reinterprets whatever rate
      // the source happens to be at, and the whole chain silently becomes a
      // speed change instead of a pitch change.
      stages.push("aresample=44100");
      stages.push(`asetrate=44100*${pitch}`);
      stages.push("aresample=44100");
    }

    // atempo accepts 0.5-2.0 per instance; chain them rather than letting
    // ffmpeg reject the whole graph.
    let remaining = tempo;
    while (remaining < 0.5) {
      stages.push("atempo=0.5");
      remaining /= 0.5;
    }
    while (remaining > 2.0) {
      stages.push("atempo=2.0");
      remaining /= 2.0;
    }
    stages.push(`atempo=${remaining.toFixed(6)}`);
  }

  if (chain) stages.push(chain);
  return stages;
}
