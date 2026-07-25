import { MaskIcon } from "./Icon";

export function TopBar({
  towerId,
  online,
  camerasOnline,
  camerasTotal,
}: {
  towerId: string;
  online: boolean;
  camerasOnline: number;
  camerasTotal: number;
}) {
  const allUp = camerasOnline === camerasTotal;

  return (
    <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-line px-[16px]">
      <nav aria-label="Breadcrumb" className="flex items-center gap-[4px]">
        <a
          href="#"
          className="font-display text-[14px] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-white"
        >
          TOWERS
        </a>
        <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
        <span className="flex items-center gap-[6px]">
          <span
            aria-current="page"
            className="font-display text-[14px] leading-[20px] tracking-[0.14px] text-white"
          >
            {towerId}
          </span>
          <span
            className={`flex items-center justify-center rounded-[2px] px-[6px] py-px font-display text-[12px] uppercase tracking-[0.12px] ${
              online
                ? "bg-terra/15 text-terra"
                : "bg-critical/15 text-critical"
            }`}
          >
            {online ? "Online" : "Offline"}
          </span>
        </span>
      </nav>

      <div className="flex items-center gap-[6px] pr-[9px] text-dim">
        <MaskIcon src="/icons/cctv.svg" size={16} />
        <p className="font-display text-[14px] leading-[20px] uppercase tracking-[0.14px] text-dim">
          Sentry cameras:{" "}
          <span className={allUp ? "text-terra" : "text-warn"}>
            {camerasOnline}/{camerasTotal}
          </span>
        </p>
      </div>
    </header>
  );
}
