'use client'

import { useState, useMemo, useRef, useEffect } from "react";
import type { TeamMember } from "@trueself/shared-types";

export interface SelectedInvitee {
  id: string;
  name: string;
  email: string;
}

interface InviteeMultiSelectProps {
  teamMembers: TeamMember[];
  selected: SelectedInvitee[];
  currentUserId: string;
  onChange: (invitees: SelectedInvitee[]) => void;
}

export function InviteeMultiSelect({
  teamMembers,
  selected,
  currentUserId,
  onChange,
}: InviteeMultiSelectProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedIds = new Set(selected.map((s) => s.id));

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return teamMembers.filter(
      (m) =>
        !selectedIds.has(m.id) &&
        (m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    );
  }, [query, teamMembers, selectedIds]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function add(member: TeamMember) {
    onChange([...selected, { id: member.id, name: member.name, email: member.email }]);
    setQuery("");
    setOpen(false);
  }

  function remove(id: string) {
    onChange(selected.filter((s) => s.id !== id));
  }

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Chips */}
      <div className="flex flex-wrap gap-2">
        {selected.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-navy-700 text-navy-200 border border-[var(--border-subtle)]"
          >
            {s.name}
            {s.id !== currentUserId && (
              <button
                type="button"
                onClick={() => remove(s.id)}
                className="text-navy-500 hover:text-navy-200 transition-colors"
                aria-label={`Remove ${s.name}`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search team members…"
          className="input-field focus-ring text-sm"
          autoComplete="off"
        />

        {open && filtered.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-xl bg-navy-800 border border-[var(--border-default)] shadow-xl overflow-hidden">
            {filtered.slice(0, 8).map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => add(m)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-navy-700 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-navy-700 flex items-center justify-center text-xs font-bold text-navy-300 shrink-0">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-navy-100 truncate">{m.name}</p>
                    <p className="text-xs text-navy-500 truncate">{m.email}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
