"use client";

import { useEffect, useMemo, useState } from "react";

type AgeTickerProps = {
  iso: string | null | undefined;
  className?: string;
};

export function AgeTicker({ iso, className }: AgeTickerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const formatted = useMemo(() => {
    if (!iso) return "Unknown";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Unknown";
    if (!mounted) return "--";
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }, [iso, mounted]);

  return <span className={className}>{formatted}</span>;
}
