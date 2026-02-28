export default function ImagiaLogo({ className }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id="imagia-bulb" x1="32" y1="6" x2="32" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id="imagia-leaf" x1="36" y1="10" x2="54" y2="2" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4ade80" />
          <stop offset="1" stopColor="#22c55e" />
        </linearGradient>
      </defs>
      {/* Lightbulb glass dome + neck */}
      <path d="M32 6C19.85 6 10 15.85 10 28c0 7.73 4 14.55 10 18.4V50h24v-3.6C50 42.55 54 35.73 54 28 54 15.85 44.15 6 32 6z" fill="url(#imagia-bulb)" />
      {/* Glass highlight */}
      <path d="M24 16c-4 3-7 8-7 13" stroke="#fff" strokeOpacity=".3" strokeWidth="2.5" strokeLinecap="round" />
      {/* Base segments */}
      <rect x="20" y="50" width="24" height="4" rx="2" fill="#4f46e5" />
      <rect x="22" y="55" width="20" height="3.5" rx="1.75" fill="#4338ca" />
      <path d="M24 59.5h16c0 3-3.5 4.5-8 4.5s-8-1.5-8-4.5z" fill="#3730a3" />
      {/* Leaf sprouting from top */}
      <path d="M34 14c4-9 15-16 24-13-3 11-13 18-24 13z" fill="url(#imagia-leaf)" />
      <path d="M34 14c6-5 16-11 24-13" stroke="#16a34a" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
