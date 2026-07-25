/**
 * Emergency lighting for an armed tile. Two layers of corner glows pulsing in
 * antiphase — opposite corners trading intensity reads as a rotating beacon,
 * where a single uniform pulse just reads as a flashing rectangle.
 *
 * Sits above the video but below the chrome — no z-index needed, since every
 * layer here is positioned with auto z and DOM order decides. Never takes
 * pointer events: the operator must still be able to hit Silence.
 */
export function SirenOverlay() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <span className="siren-a absolute inset-0" />
      <span className="siren-b absolute inset-0" />
      <span className="absolute inset-0 border-2 border-critical/60" />
    </div>
  );
}
