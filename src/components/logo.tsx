export const Logo = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 50 50"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
      <path d="M9.6,20.5c0,-5.8 4.7,-10.5 10.5,-10.5h10.8c5.8,0 10.5,4.7 10.5,10.5v0c0,0 -20.8,0 -31.8,0z" fill="hsl(var(--primary))" />
      <path d="M2.1,27.6c0,-5.8 4.7,-10.5 10.5,-10.5h25.7c5.8,0 10.5,4.7 10.5,10.5v12.2c0,5.8 -4.7,10.5 -10.5,10.5h-25.7c-5.8,0 -10.5,-4.7 -10.5,-10.5z" fill="hsl(var(--secondary))" />
  </svg>
);
