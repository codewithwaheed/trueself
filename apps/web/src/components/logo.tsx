export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = {
    sm: { icon: 28, text: "text-lg" },
    md: { icon: 36, text: "text-xl" },
    lg: { icon: 44, text: "text-2xl" },
  };
  const s = sizes[size];

  return (
    <div className="flex items-center gap-2.5">
      <div
        className="relative flex items-center justify-center rounded-xl bg-trust/10"
        style={{ width: s.icon, height: s.icon }}
      >
        {/* Shield icon */}
        <svg
          width={s.icon * 0.55}
          height={s.icon * 0.55}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 2L3 7V12C3 17.55 6.84 22.74 12 24C17.16 22.74 21 17.55 21 12V7L12 2Z"
            fill="currentColor"
            className="text-trust"
          />
          <path
            d="M10 15.5L7.5 13L6.09 14.41L10 18.33L18 10.33L16.59 8.92L10 15.5Z"
            fill="currentColor"
            className="text-navy-950"
          />
        </svg>
      </div>
      <span
        className={`${s.text} font-bold tracking-tight`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        True<span className="text-trust">Self</span>
      </span>
    </div>
  );
}
