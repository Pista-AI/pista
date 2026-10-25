import { type ReactNode, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

/** Anchored popover that opens above or below its trigger and closes on outside click / Escape. */
export function Popover({
  trigger,
  children,
  placement = "top-start",
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  placement?: "top-start" | "bottom-start" | "bottom-end" | "top-end";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const [v, h] = placement.split("-");
  const style = {
    ...(v === "top" ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
    ...(h === "start" ? { left: 0 } : { right: 0 }),
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className="popover" style={style}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  description,
  checked,
  icon,
  onClick,
}: {
  children: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="menu-item" onClick={onClick}>
      {icon}
      <span style={{ minWidth: 0 }}>
        <div>{children}</div>
        {description && <div className="desc">{description}</div>}
      </span>
      {checked && <Check size={15} className="check" />}
    </button>
  );
}
