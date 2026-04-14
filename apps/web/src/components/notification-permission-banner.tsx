'use client'

import { useState, useEffect } from "react";

const DISMISSED_KEY = "trueself_notif_banner_dismissed";

export function NotificationPermissionBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") return;
    if (localStorage.getItem(DISMISSED_KEY)) return;
    setVisible(true);
  }, []);

  function handleEnable() {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted" || perm === "denied") {
        setVisible(false);
      }
    });
  }

  function handleDismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-navy-800/60 border border-[var(--border-default)] mb-4 text-sm">
      <div className="flex items-center gap-2.5 min-w-0">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="text-trust shrink-0">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-navy-300 truncate">
          Enable browser notifications to receive live interview alerts
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleEnable}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-trust hover:opacity-90 transition-opacity"
        >
          Enable
        </button>
        <button
          onClick={handleDismiss}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-navy-400 hover:text-navy-200 transition-colors"
          aria-label="Dismiss"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
