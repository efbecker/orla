export function OrlaLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#f38020" />
      <path d="M6 20.5c3.2-2.6 6.8-2.6 10 0s6.8 2.6 10 0" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M6 13.5c3.2-2.6 6.8-2.6 10 0s6.8 2.6 10 0" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}
