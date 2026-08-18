/**
 * Renders an exported Figma glyph as a mask so it can take `currentColor`.
 *
 * Only use this for the monochrome glyphs (nav, PTZ, tile controls). The alert
 * badges and link-quality icons are multi-colour and must render as <img> to
 * keep their exported fills.
 */
export function MaskIcon({
  src,
  size = 24,
  className,
  background,
}: {
  src: string;
  size?: number;
  className?: string;
  /** Painted behind the mask instead of `currentColor`. The glyph is a hole,
   *  so anything can go through it — a hard-stop gradient turns a solid battery
   *  into one with a level, without a second export or a hand-drawn icon. */
  background?: string;
}) {
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "block",
        width: size,
        height: size,
        backgroundColor: background ? undefined : "currentColor",
        backgroundImage: background,
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
