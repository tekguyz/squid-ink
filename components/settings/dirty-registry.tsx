"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * How the Settings footer knows WHICH section has unsaved changes.
 *
 * Each section owns its own draft and its own save; nothing here holds a field
 * value. A section reports only a label and a count, and hands over save and
 * discard callbacks. That is the boundary the page was decided around
 * (docs/DECISIONS.md § Settings): one flat form blob could only ever say "you
 * have changes", and a section that owns itself can later move to its own
 * route without a rewrite.
 *
 * A section with nothing to save — Appearance applies instantly, Connected
 * apps is a stub — simply does not call useDirtySection.
 */

interface DirtySection {
  id: string;
  label: string;
  count: number;
}

interface Handlers {
  save: () => Promise<void>;
  discard: () => void;
}

interface Registry {
  /** Every registered section, clean ones included (count 0). */
  registered: DirtySection[];
  report: (section: DirtySection) => void;
  unregister: (id: string) => void;
  handlers: RefObject<Map<string, Handlers>>;
}

const RegistryContext = createContext<Registry | null>(null);

function useRegistry(): Registry {
  const registry = useContext(RegistryContext);
  if (!registry) throw new Error("Settings sections must render inside DirtyRegistryProvider");
  return registry;
}

export function DirtyRegistryProvider({ children }: { children: ReactNode }) {
  const [registered, setRegistered] = useState<DirtySection[]>([]);
  const handlers = useRef(new Map<string, Handlers>());

  const report = useCallback((section: DirtySection) => {
    setRegistered((previous) => {
      const index = previous.findIndex((s) => s.id === section.id);
      if (index === -1) return [...previous, section];
      const next = [...previous];
      next[index] = section;
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setRegistered((previous) => previous.filter((s) => s.id !== id));
  }, []);

  const value = useMemo(
    () => ({ registered, report, unregister, handlers }),
    [registered, report, unregister],
  );
  return <RegistryContext value={value}>{children}</RegistryContext>;
}

/** Called by a section on every render with its current dirty count. */
export function useDirtySection(
  id: string,
  label: string,
  count: number,
  save: () => Promise<void>,
  discard: () => void,
) {
  const { report, unregister, handlers } = useRegistry();

  // The latest closures, every render: a save must send the draft as it is
  // when Update is pressed, not as it was when the section mounted.
  useEffect(() => {
    handlers.current.set(id, { save, discard });
  });

  useEffect(() => {
    report({ id, label, count });
  }, [id, label, count, report]);

  useEffect(
    () => () => {
      unregister(id);
      handlers.current.delete(id);
    },
    [id, unregister, handlers],
  );
}

/** What the footer reads: whether any section registered, the dirty sections,
 *  and one save and one discard that reach every one of them. */
export function useDirtySummary() {
  const { registered, handlers } = useRegistry();
  const sections = useMemo(() => registered.filter((s) => s.count > 0), [registered]);

  const saveAll = useCallback(async () => {
    for (const section of sections) await handlers.current.get(section.id)?.save();
  }, [sections, handlers]);

  const discardAll = useCallback(() => {
    for (const section of sections) handlers.current.get(section.id)?.discard();
  }, [sections, handlers]);

  return { anyRegistered: registered.length > 0, sections, saveAll, discardAll };
}
