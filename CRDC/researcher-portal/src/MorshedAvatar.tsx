export default function MorshedAvatar({ size = 38 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://w3.org"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'block' }}
    >
      {/* خلفية دائرية متناسقة مع ألوان الأكاديمية */}
      <circle cx="48" cy="48" r="46" fill="#EFF6FF" stroke="#D4AF37" strokeWidth="3" />

      {/* البدلة الرسمية للباحث */}
      <path
        d="M20 88C22 72 33 65 48 65C63 65 74 72 76 88"
        fill="#1E3A5F"
      />
      {/* القميص الأبيض وربطة العنق */}
      <path d="M40 65L48 79L56 65H40Z" fill="#FFFFFF" />
      <path d="M46 67L48 77L50 67L48 65L46 67Z" fill="#D4AF37" />

      {/* الرقبة */}
      <rect x="42" y="55" width="12" height="12" rx="5" fill="#F1C29B" />

      {/* الأذنان */}
      <circle cx="30" cy="43" r="4" fill="#E5B087" />
      <circle cx="66" cy="43" r="4" fill="#E5B087" />

      {/* الوجه */}
      <rect x="31" y="25" width="34" height="34" rx="16" fill="#F6C9A4" />

      {/* الشعر */}
      <path
        d="M31 38C31 28 38 22 48 22C58 22 65 28 65 38C63 32 58 29 48 29C38 29 33 32 31 38Z"
        fill="#1E293B"
      />

      {/* قبعة التخرج الأكاديمية */}
      <polygon points="48,9 75,20 48,30 21,20" fill="#0F172A" stroke="#D4AF37" strokeWidth="1.5" />
      <path d="M35 25V31C35 33 41 35 48 35C55 35 61 33 61 31V25" fill="#1E3A5F" />
      {/* الشرابة الذهبية للقبعة */}
      <path d="M68 22V34" stroke="#D4AF37" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="68" cy="35" r="2.2" fill="#D4AF37" />

      {/* النظارة الطبية للباحث */}
      <rect x="34" y="38" width="11" height="8" rx="2.5" fill="#FFFFFF" fillOpacity="0.35" stroke="#1E3A5F" strokeWidth="2" />
      <rect x="51" y="38" width="11" height="8" rx="2.5" fill="#FFFFFF" fillOpacity="0.35" stroke="#1E3A5F" strokeWidth="2" />
      <line x1="45" y1="42" x2="51" y2="42" stroke="#1E3A5F" strokeWidth="2" />

      {/* العيون */}
      <circle cx="39.5" cy="42" r="1.6" fill="#0F172A" />
      <circle cx="56.5" cy="42" r="1.6" fill="#0F172A" />

      {/* ابتسامة ودودة */}
      <path
        d="M43 50C45 52.5 51 52.5 53 50"
        stroke="#9A5B3A"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* كتاب بحثي صغير في أسفل الزاوية */}
      <rect x="56" y="71" width="18" height="14" rx="2" fill="#D4AF37" stroke="#1E3A5F" strokeWidth="1.5" />
      <line x1="65" y1="71" x2="65" y2="85" stroke="#1E3A5F" strokeWidth="1.5" />
    </svg>
  )
}
