"use client";

/**
 * The site's dropdown. A native <select> opens a list the browser draws itself
 * (Windows chrome, and a serif fallback font), so this draws its own: a dark
 * panel with the condensed italic menu type and a teal highlight.
 *
 * The list opens in a layer on top of the page (a portal), so a card or a
 * scrolling column can't clip it. It drops down, or up when there's no room.
 *
 * Keyboard: Enter / Space / ArrowDown open; arrows move; Home / End jump;
 * typing a letter jumps to the next option starting with it; Enter picks;
 * Escape or Tab closes.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const LIST_MAX_HEIGHT = 288; // matches max-h-72

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown when no option matches `value`. */
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** "sm" for compact rows (destination pickers, the masthead). */
  size?: "sm" | "md";
  className?: string;
}

export default function Select({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  ariaLabel,
  disabled,
  size = "md",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const id = useId();
  const selected = options.find((o) => o.value === value);

  // Close when clicking anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Follow the button while open (scrolling, resizing).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = root.current?.getBoundingClientRect();
      if (!r) return;
      const up = window.innerHeight - r.bottom < Math.min(LIST_MAX_HEIGHT, options.length * 36) + 12 && r.top > window.innerHeight - r.bottom;
      setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: r.width, up });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, options.length]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openList() {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function pick(i: number) {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") return setOpen(false);
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); }
    else if (e.key.length === 1) {
      const ch = e.key.toLowerCase();
      const order = [...options.keys()].map((k) => (active + 1 + k) % options.length);
      const hit = order.find((i) => options[i].label.toLowerCase().startsWith(ch));
      if (hit != null) setActive(hit);
    }
  }

  const sm = size === "sm";
  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={ariaLabel}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={`w-full flex items-center justify-between gap-2 text-left border rounded-sm transition-colors
          font-blocky font-bold italic uppercase tracking-wide
          bg-surface-light text-text border-border hover:border-teal focus:outline-none focus-visible:border-teal
          disabled:opacity-40 disabled:cursor-not-allowed
          ${open ? "border-teal" : ""} ${sm ? "px-2 py-1 text-sm" : "px-3 py-2 text-base"}`}
      >
        <span className={`truncate ${selected ? "" : "text-text-dim"}`}>{selected?.label ?? placeholder}</span>
        <svg aria-hidden viewBox="0 0 12 8" className={`shrink-0 w-3 h-2 text-teal transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>

      {open && pos && createPortal(
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            minWidth: pos.width,
            transform: pos.up ? "translateY(-100%)" : undefined,
          }}
          className="select-list z-[100] w-max max-w-[min(22rem,90vw)] max-h-72 overflow-y-auto rounded-sm border border-teal py-1"
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
              className={`px-3 py-1.5 cursor-pointer font-blocky font-bold italic uppercase tracking-wide truncate
                border-l-4 ${sm ? "text-sm" : "text-base"}
                ${i === active ? "bg-teal/15 text-white border-teal" : "text-white/80 border-transparent"}
                ${o.value === value ? "text-teal" : ""}`}
            >
              {o.label}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}
