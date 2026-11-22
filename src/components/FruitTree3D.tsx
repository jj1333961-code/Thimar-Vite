export default function FruitTree3D() {
  return (
    <div className="ai-orb-layer" aria-hidden="true">
      <svg
        viewBox="0 0 240 240"
        className="ai-orb-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="ai-orb-bg" cx="40%" cy="35%">
            <stop offset="0" stopColor="#e8f3ee" />
            <stop offset="0.55" stopColor="#b9d9cc" />
            <stop offset="1" stopColor="#6fa893" />
          </radialGradient>
          <radialGradient id="ai-orb-glow" cx="50%" cy="50%">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <filter id="ai-orb-blur" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* outer glow */}
        <circle cx="120" cy="120" r="108" fill="url(#ai-orb-glow)" filter="url(#ai-orb-blur)" />

        {/* main circle */}
        <circle cx="120" cy="120" r="92" fill="url(#ai-orb-bg)" stroke="#0f5f4e" strokeWidth="2.5" />

        {/* sound-wave bars (centered) */}
        <g transform="translate(120 120)" stroke="#0f5f4e" strokeWidth="6" strokeLinecap="round">
          <line x1="-46" y1="0" x2="-46" y2="0" />
          <line x1="-30" y1="-18" x2="-30" y2="18" />
          <line x1="-14" y1="-34" x2="-14" y2="34" />
          <line x1="0" y1="-46" x2="0" y2="46" />
          <line x1="14" y1="-34" x2="14" y2="34" />
          <line x1="30" y1="-18" x2="30" y2="18" />
          <line x1="46" y1="0" x2="46" y2="0" />
        </g>

        {/* animated pulse ring */}
        <circle cx="120" cy="120" r="92" fill="none" stroke="#0f5f4e" strokeWidth="1.5" opacity="0.35">
          <animate attributeName="r" values="92;104;92" dur="2.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.35;0;0.35" dur="2.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}
