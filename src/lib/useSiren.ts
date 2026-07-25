import { useEffect, useRef } from "react";

/**
 * A synthesised two-tone wail. Generated rather than loaded from a file: no
 * asset to ship or license, and the pitch sweep stays tunable.
 *
 * Browsers refuse to start audio outside a user gesture, which is exactly what
 * the alarm toggle is — the context is created on the click that arms it.
 */
export function useSiren(active: boolean, volume = 0.06) {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active) return;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;

    const ctx = ctxRef.current ?? new Ctor();
    ctxRef.current = ctx;
    void ctx.resume();

    const carrier = ctx.createOscillator();
    carrier.type = "sawtooth";
    carrier.frequency.value = 660;

    // The wail is an LFO swinging the carrier, not a square switch between two
    // pitches — the glide is what makes it read as a siren rather than a beep.
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.55;
    const sweep = ctx.createGain();
    sweep.gain.value = 300;
    lfo.connect(sweep);
    sweep.connect(carrier.frequency);

    // Rolls off the sawtooth's harsher harmonics so it carries without
    // being painful over a monitor speaker.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2200;

    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.25);

    carrier.connect(tone);
    tone.connect(out);
    out.connect(ctx.destination);
    carrier.start();
    lfo.start();

    return () => {
      const t = ctx.currentTime;
      // Fade out rather than hard-stop; cutting an oscillator at full
      // amplitude produces an audible click.
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.18);
      carrier.stop(t + 0.2);
      lfo.stop(t + 0.2);
    };
  }, [active, volume]);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);
}
