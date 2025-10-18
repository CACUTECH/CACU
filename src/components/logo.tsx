export const Logo = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 200 200"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Dark Blue elements - approximated from CSS */}
    <rect x="10" y="50" width="80" height="80" fill="hsl(var(--primary-dark))" />
    <rect x="60" y="30" width="80" height="80" fill="hsl(var(--primary-dark))" />
    <circle cx="100" cy="100" r="40" fill="hsl(var(--primary-dark))" />

    {/* Light purple element */}
    <rect x="70" y="80" width="100" height="50" fill="hsl(var(--primary))" />
  </svg>
);
