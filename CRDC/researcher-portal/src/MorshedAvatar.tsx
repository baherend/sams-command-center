type MorshedAvatarProps = {
  size?: number
  isOpen?: boolean
  compact?: boolean
}

export default function MorshedAvatar({
  size = 84,
  isOpen = false,
  compact = false,
}: MorshedAvatarProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://w3.org"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        display: 'block',
        overflow: 'visible',
        filter: compact ? 'none' : 'drop-shadow(0 10px 16px rgba(0, 0, 0, 0.35))',
      }}
    >
      <defs>
        {/* إضاءة وظلال ثلاثية الأبعاد للبشرة */}
        <radialGradient id="skin3d" cx="42%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#FFE0C8" />
          <stop offset="65%" stopColor="#F2B88C" />
          <stop offset="100%" stopColor="#D48D60" />
        </radialGradient>

        {/* تدرج 3D للبدلة الأكاديمية */}
        <linearGradient id="suit3d" x1="20" y1="65" x2="100" y2="115" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2B5282" />
          <stop offset="50%" stopColor="#162E4D" />
          <stop offset="100%" stopColor="#0B192C" />
        </linearGradient>

        {/* تدرج 3D لقبعة التخرج */}
        <linearGradient id="cap3d" x1="30" y1="8" x2="90" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="55%" stopColor="#0F172A" />
          <stop offset="100%" stopColor="#020617" />
        </linearGradient>

        {/* تدرج ذهبي 3D للشرابة والزخارف */}
        <linearGradient id="gold3d" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="50%" stopColor="#D97706" />
          <stop offset="100%" stopColor="#92400E" />
        </linearGradient>

        {/* وهج صفحات الكتاب المفتوح */}
        <radialGradient id="bookGlow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#FEF08A" stopOpacity={isOpen ? '0.95' : '0.45'} />
          <stop offset="65%" stopColor="#38BDF8" stopOpacity={isOpen ? '0.45' : '0.15'} />
          <stop offset="100%" stopColor="#38BDF8" stopOpacity="0" />
        </radialGradient>

        {/* تدرج غلاف الكتاب */}
        <linearGradient id="bookCover3d" x1="25" y1="75" x2="95" y2="112" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="50%" stopColor="#047857" />
          <stop offset="100%" stopColor="#064E3B" />
        </linearGradient>

        {/* تدرج صفحات الكتاب */}
        <linearGradient id="pages3d" x1="30" y1="74" x2="90" y2="105" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#F8FAFC" />
          <stop offset="100%" stopColor="#CBD5E1" />
        </linearGradient>
      </defs>

      {/* خلفية دائرية فقط في الوضع المصغر داخل الرسائل */}
      {compact && (
        <circle cx="60" cy="60" r="56" fill="#EFF6FF" stroke="url(#gold3d)" strokeWidth="4" />
      )}

      {/* ظل أرضي ناعم يعطي إحساس الوقوف 3D */}
      {!compact && (
        <ellipse cx="60" cy="113" rx="34" ry="5" fill="rgba(0,0,0,0.32)" />
      )}

      {/* الجسم والبدلة ثلاثية الأبعاد */}
      <path
        d="M24 108C26 86 40 76 60 76C80 76 94 86 96 108C96 111 93 113 90 113H30C27 113 24 111 24 108Z"
        fill="url(#suit3d)"
      />
      {/* طية الياقة لإبراز العمق */}
      <path d="M47 76L60 94L73 76H47Z" fill="#F8FAFC" />
      <path d="M57 78L60 91L63 78L60 76L57 78Z" fill="url(#gold3d)" />

      {/* الرقبة بظل ثلاثي الأبعاد */}
      <rect x="52" y="62" width="16" height="16" rx="7" fill="url(#skin3d)" />
      <path d="M52 64C55 68 65 68 68 64V68C64 71 56 71 52 68V64Z" fill="rgba(146, 64, 14, 0.22)" />

      {/* الأذنان */}
      <circle cx="38" cy="48" r="5" fill="#E09F73" />
      <circle cx="82" cy="48" r="5" fill="#D48D60" />

      {/* الرأس ثلاثي الأبعاد */}
      <rect x="39" y="27" width="42" height="41" rx="20" fill="url(#skin3d)" />

      {/* الشعر بتدرج عمق */}
      <path
        d="M39 42C39 30 47 23 60 23C73 23 81 30 81 42C78 35 72 32 60 32C48 32 42 35 39 42Z"
        fill="#1E293B"
      />

      {/* قبعة التخرج 3D */}
      <polygon
        points="60,8 95,21 60,34 25,21"
        fill="url(#cap3d)"
        stroke="url(#gold3d)"
        strokeWidth="1.8"
      />
      {/* لمعة ضوء أعلى القبعة */}
      <polygon points="60,10 88,20 60,26 32,20" fill="rgba(255,255,255,0.08)" />
      <path d="M44 27V34C44 37 51 39 60 39C69 39 76 37 76 34V27" fill="#0F172A" />
      <circle cx="60" cy="21" r="2.5" fill="url(#gold3d)" />
      <path d="M60 21L85 25V39" stroke="url(#gold3d)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="85" cy="40" r="2.8" fill="url(#gold3d)" />

      {/* النظارة الطبية 3D مع انعكاس زجاجي */}
      <rect
        x="43"
        y="42"
        width="14"
        height="10"
        rx="3.5"
        fill="rgba(255,255,255,0.45)"
        stroke="#0F172A"
        strokeWidth="2.2"
      />
      <rect
        x="63"
        y="42"
        width="14"
        height="10"
        rx="3.5"
        fill="rgba(255,255,255,0.45)"
        stroke="#0F172A"
        strokeWidth="2.2"
      />
      {/* لمعة عدسات النظارة */}
      <line x1="45" y1="44" x2="49" y2="49" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="65" y1="44" x2="69" y2="49" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="57" y1="46.5" x2="63" y2="46.5" stroke="#0F172A" strokeWidth="2.2" />

      {/* العيون بلمعة حياة */}
      <circle cx="50" cy="47" r="2.1" fill="#0F172A" />
      <circle cx="50.7" cy="46.2" r="0.7" fill="#FFFFFF" />
      <circle cx="70" cy="47" r="2.1" fill="#0F172A" />
      <circle cx="70.7" cy="46.2" r="0.7" fill="#FFFFFF" />

      {/* ابتسامة ودودة */}
      <path
        d="M54 57C56.5 60 63.5 60 66 57"
        stroke="#8C4A27"
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {/* ============================================================ */}
      {/* الكتاب المفتوح ثلاثي الأبعاد الذي يحمله مرشد وتفتح منه المحادثة */}
      {/* ============================================================ */}
      {!compact && (
        <g>
          {/* هالة ضوئية تنبعث من الكتاب */}
          <ellipse cx="60" cy="84" rx="34" ry="18" fill="url(#bookGlow)" />

          {/* غلاف الكتاب السفلي 3D */}
          <path
            d="M27 83L60 90L93 83L90 107L60 113L30 107L27 83Z"
            fill="url(#bookCover3d)"
            stroke="url(#gold3d)"
            strokeWidth="1.6"
          />

          {/* الصفحات المفتوحة 3D (الصفحة اليسرى واليمنى) */}
          <path
            d="M31 80C41 77 52 79 60 85V108C52 103 41 101 32 104L31 80Z"
            fill="url(#pages3d)"
            stroke="#CBD5E1"
            strokeWidth="1"
          />
          <path
            d="M89 80C79 77 68 79 60 85V108C68 103 79 101 88 104L89 80Z"
            fill="url(#pages3d)"
            stroke="#CBD5E1"
            strokeWidth="1"
          />

          {/* سطور ذهبية مضيئة على صفحات الكتاب */}
          <line x1="37" y1="86" x2="54" y2="89" stroke="#D97706" strokeWidth="1.4" strokeLinecap="round" />
          <line x1="37" y1="92" x2="54" y2="95" stroke="#94A3B8" strokeWidth="1.3" strokeLinecap="round" />
          <line x1="37" y1="98" x2="50" y2="100" stroke="#94A3B8" strokeWidth="1.3" strokeLinecap="round" />

          <line x1="66" y1="89" x2="83" y2="86" stroke="#D97706" strokeWidth="1.4" strokeLinecap="round" />
          <line x1="66" y1="95" x2="83" y2="92" stroke="#94A3B8" strokeWidth="1.3" strokeLinecap="round" />
          <line x1="70" y1="100" x2="83" y2="98" stroke="#94A3B8" strokeWidth="1.3" strokeLinecap="round" />

          {/* اليدان تمسكان بالكتاب من الجانبين */}
          <circle cx="29" cy="94" r="5" fill="url(#skin3d)" stroke="#D48D60" strokeWidth="1" />
          <circle cx="91" cy="94" r="5" fill="url(#skin3d)" stroke="#D48D60" strokeWidth="1" />
        </g>
      )}
    </svg>
  )
}
