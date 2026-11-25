import { useI18n } from './i18n'

export default function ResearcherGuideHome({
  applicantType,
  onStartRequest,
}: {
  applicantType: 'egyptian' | 'foreign'
  onStartRequest: () => void
}) {
  const { isEn } = useI18n()

  const servicesList = isEn
    ? [
        { num: '01', title: 'Research Arbitration & Publication', desc: 'Peer review and publication in two Supreme Council of Universities accredited journals (7/7 rating): Journal of Administrative Research & Sadat Journal for Administrative and Financial Research.' },
        { num: '02', title: 'Thesis Proofreading (Arabic & English)', desc: 'Comprehensive linguistic and stylistic review of Master’s and PhD theses by certified specialists.' },
        { num: '03', title: 'Statistical Analysis & Review', desc: 'Complete statistical analysis or methodology/results verification for academic theses.' },
        { num: '04', title: 'Digital Transformation Fundamentals Certificate', desc: 'Training course and accredited examination required for postgraduate degrees.' },
        { num: '05', title: 'Plagiarism Check', desc: 'Official similarity and originality report for theses and research papers.' },
      ]
    : [
        { num: '01', title: 'تحكيم ونشر الأبحاث العلمية', desc: 'تحكيم ونشر في مجلتين معتمدتين من المجلس الأعلى للجامعات بتقييم 7/7: مجلة البحوث الإدارية ومجلة السادات للبحوث الإدارية والمالية.' },
        { num: '02', title: 'التدقيق اللغوي للرسائل العلمية (عربي وإنجليزي)', desc: 'مراجعة لغوية وأسلوبية شاملة لرسائل الماجستير والدكتوراه على يد متخصصين معتمدين.' },
        { num: '03', title: 'التحليل الإحصائي والمراجعة الإحصائية', desc: 'إجراء التحليل الإحصائي الكامل أو مراجعة المنهجية والنتائج الإحصائية للرسائل العلمية.' },
        { num: '04', title: 'شهادة أساسيات التحول الرقمي', desc: 'دورة تدريبية واختبار معتمد لاستيفاء متطلبات الدرجات العلمية للدراسات العليا.' },
        { num: '05', title: 'قياس نسبة الاقتباس', desc: 'فحص نسبة الاقتباس والأصالة العلمية وإصدار الإفادة المعتمدة للرسائل والأبحاث.' },
      ]

  return (
    <div className="guide-home" style={{ display: 'grid', gap: '1.25rem' }}>
      <div className="portal-heading" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem' }}>
        <div>
          <span className="eyebrow">{isEn ? 'Procedural Guide & Center Overview' : 'الدليل الإجرائي والتعريف بالمركز'}</span>
          <h1>{isEn ? 'Welcome to CRDC Researcher Portal' : 'مرحباً بك في بوابة مركز الاستشارات والبحوث والتطوير'}</h1>
          <p>{isEn
            ? 'Your official guide to center services, degree requirements, payment procedures, and accredited journals at Sadat Academy for Management Sciences.'
            : 'دليلك الشامل للتعرف على خدمات المركز، متطلبات كل درجة علمية، خطوات السداد، والمجلات العلمية المعتمدة بأكاديمية السادات للعلوم الإدارية.'}</p>
        </div>
        <button type="button" className="primary-button" onClick={onStartRequest}>
          {isEn ? 'Submit a New Request →' : 'قدّم طلباً جديداً ←'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
        {servicesList.map((srv) => (
          <article key={srv.num} className="portal-card" style={{ display: 'grid', gap: '0.5rem', alignContent: 'start' }}>
            <span className="eyebrow">{srv.num}</span>
            <h3 style={{ margin: 0 }}>{srv.title}</h3>
            <p style={{ margin: 0, opacity: 0.88, lineHeight: 1.65 }}>{srv.desc}</p>
          </article>
        ))}
      </div>

      <div className="catalog-layout">
        <article className="portal-card" style={{ display: 'grid', gap: '0.75rem' }}>
          <span className="eyebrow">{isEn ? 'Step-by-Step Workflow' : 'خطوات الحصول على الخدمة'}</span>
          <h2>{isEn ? 'General Procedures & Payment' : 'الإجراءات العامة والسداد'}</h2>
          <ol style={{ margin: 0, paddingInlineStart: '1.25rem', display: 'grid', gap: '0.55rem', lineHeight: 1.7 }}>
            <li>{isEn ? 'Select your work type (Thesis: ~100–150 pages, or Research Paper: ~20–30 pages) and desired services.' : 'اختر نوع العمل (رسالة علمية: حوالي 100–150 صفحة، أو بحث للنشر: حوالي 20–30 صفحة) والخدمات المطلوبة.'}</li>
            <li>{isEn ? 'Receive your official payment order from the center.' : 'يتم إصدار إذن الدفع الرسمي لطلبك من المركز.'}</li>
            <li>{applicantType === 'foreign'
              ? (isEn ? 'As an international researcher, pay in USD at the accredited bank and upload your bank receipt.' : 'بصفتك باحثاً وافداً، يتم السداد بالدولار الأمريكي (USD) في البنك المعتمد ثم رفع إيصال السداد.')
              : (isEn ? 'As an Egyptian researcher, pay in EGP at the Academy treasury and upload your receipt.' : 'بصفتك باحثاً مصرياً، يتم السداد بالجنيه المصري (EGP) في خزينة الأكاديمية ثم رفع إيصال السداد.')}</li>
            <li>{isEn ? 'Expected turnaround time for services is approximately 10 to 30 days, after which stamped certificates are issued.' : 'المدة المتوقعة لإنجاز الخدمات من 10 أيام إلى شهر تقريباً، وتُسلَّم بعدها الإفادات المعتمدة والمختومة.'}</li>
          </ol>
        </article>

        <aside className="portal-card requirement-card" style={{ display: 'grid', gap: '0.75rem', alignContent: 'start' }}>
          <span className="eyebrow">{isEn ? 'Degree & Journal Rules' : 'متطلبات الدرجات والمجلات'}</span>
          <h2>{isEn ? 'Requirements & Journals (7/7)' : 'متطلبات الدرجات والمجلات المعتمدة'}</h2>
          <ul className="requirement-list">
            <li><span>{isEn ? 'Academic PhD' : 'الدكتوراه الأكاديمي'}</span><strong>{isEn ? 'All 5 services + 2 papers' : 'جميع الخدمات + نشر بحثين'}</strong></li>
            <li><span>{isEn ? 'Academic Master’s' : 'الماجستير الأكاديمي'}</span><strong>{isEn ? 'All 5 services + 1 paper' : 'جميع الخدمات + نشر بحث واحد'}</strong></li>
            <li><span>{isEn ? 'Professional Master’s / PhD' : 'الماجستير والدكتوراه المهني'}</span><strong>{isEn ? 'Digital Transformation only' : 'التحول الرقمي فقط'}</strong></li>
          </ul>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.35rem' }}>
            <a href="https://ekb.eg" target="_blank" rel="noopener noreferrer" className="quiet-button" style={{ textDecoration: 'none' }}>
              {isEn ? 'Journal of Administrative Research ↗' : 'مجلة البحوث الإدارية ↗'}
            </a>
            <a href="https://ekb.eg" target="_blank" rel="noopener noreferrer" className="quiet-button" style={{ textDecoration: 'none' }}>
              {isEn ? 'Sadat Journal (SJSAF) ↗' : 'مجلة السادات (SJSAF) ↗'}
            </a>
          </div>
        </aside>
      </div>
    </div>
  )
}