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
}: {
  src: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "block",
        width: size,
        height: size,
        backgroundColor: "currentColor",
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
