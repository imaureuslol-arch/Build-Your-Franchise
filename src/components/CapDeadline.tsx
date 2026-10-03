"use client";

import { useEffect, useState } from "react";

export default function CapDeadline({ deadline }: { deadline?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!deadline) return null;
  const minutes = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  return <p className="text-xs text-cap-over" title={new Date(deadline).toLocaleString("en-GB", { timeZone: "Europe/Athens" })}>
    {minutes ? `Get under hard cap: ${days}d ${hours}h ${minutes % 60}m` : "Hard-cap deadline reached"}
  </p>;
}
