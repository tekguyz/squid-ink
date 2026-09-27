"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEMO_OFF } from "@/lib/auth/demo-visitor";

/**
 * Demo mode for the client islands (issue #19). app/layout.tsx reads the fact
 * on the server — lib/auth/demo-visitor.ts — and wraps every page in
 * <DemoMode>, so a write control deep in a shell reads it without every layer
 * in between carrying a prop, and a new page cannot forget it.
 *
 * Outside a provider the answer is false: a control that forgot to ask shows
 * live and the database still refuses the write. Hiding or disabling is never
 * the enforcement.
 */

const DemoContext = createContext(false);

export function DemoMode({ demo, children }: { demo: boolean; children: ReactNode }) {
  return <DemoContext.Provider value={demo}>{children}</DemoContext.Provider>;
}

export function useDemo(): boolean {
  return useContext(DemoContext);
}

/** The message, set beside a turned-off control. Mono meta, the same voice as
 *  the "Soon" badge: it explains a state, it is not an error. */
export function DemoOffNote({ id, className = "" }: { id?: string; className?: string }) {
  return (
    <span id={id} className={`font-mono text-muted text-[9.5px] tracking-[0.06em] ${className}`}>
      {DEMO_OFF}
    </span>
  );
}
