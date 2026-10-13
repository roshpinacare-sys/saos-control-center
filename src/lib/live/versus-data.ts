// ═══ גשר-החי · מטריצת-השוואה — בחינת 23 פרוטוקולים מתקדמים ══════════════════
// מקור: EXEC-CD-15-a — מחקר-רשת-חי (25+ חיפושים, 2024-2025), שמור במחקר-המלא
// /tmp/dex-research.json ומוטמע-כאן בתמצית. מצב-האימוץ של SovereignDex
// מדווח-בכנות: live (חי-עכשיו) · partial (חלקי) · planned (בתכנון) · out
// (מחוץ-לתחום-לפי-החלטת-המפעיל).

export type Adoption = 'live' | 'partial' | 'planned' | 'out';

export interface ChecklistItem {
  feature: string;
  why: string;
  leaders: string;
  adoption: Adoption;
  note: string;
}

export interface ProtocolDigest {
  name: string;
  chains: string;
  highlights: string[];
  features: string[];
  notable: string;
}

export const PROTOCOLS: ProtocolDigest[] = [
  {
    name: 'Uniswap v4', chains: 'Ethereum + ~10 EVM (Arbitrum, Base, Optimism, BNB, Unichain...)',
    highlights: ['Hooks — בריכות-ניתנות-לתכנות ב-8+ נקודות-מחזור-חיים', 'Singleton: חוזה-אחד-מחזיק-את-כל-הבריכות (יצירת-בריכה ~99% זולה-יותר)', 'Flash-accounting על transient-storage — התחשבנות-פעם-אחת-בסוף-הטרנזקציה'],
    features: ['hooks', 'ניתוב-מורכב-חסכוני-בגז', 'הגנת-MEV דרך-hooks', 'פקודות-לימיט דרך-hook'],
    notable: 'הושק 30.1.2025; מערכת-ה-hooks הפכה בריכות לפלטפורמות-ניתנות-לתכנות.',
  },
  {
    name: 'Jupiter', chains: 'Solana (+ חוצה-שרשראות בשותפות)',
    highlights: ['אגרגטור #1 של Solana — ניתוב על-פני 20+ מקורות-נזילות', 'אפליקציית-מסחר שלמה: swap + limit + DCA/VA + perps + launchpad', 'Meta-API — מנוע-ברירת-המחדל של ארנקי Solana'],
    features: ['אגרגציה', 'limit-orders', 'פקודות-טריגר', 'DCA+VA', 'perps עד-100x', 'launchpad', 'API'],
    notable: 'מנתב את רוב-נפח-ה-DEX של Solana — מודל-ההתייחסות ל"אפליקציית-הכל".',
  },
  {
    name: 'Hyperliquid', chains: 'L1 ייעודי (HyperCore) + HyperEVM',
    highlights: ['CLOB מלא-על-השרשרת: בלוקים של ~0.07ש׳, קונצנזוס HyperBFT', 'perps עד-50x + ספוט + כספות-HLP — הכל self-custodial', 'HIP-3: שווקי-פרפטואלס-הרשאתיים + builder-codes'],
    features: ['CLOB-perps', 'limit/stop/trigger', 'כספות-אסטרטגיה', 'builder-codes', 'HIP-3', 'EVM-מובנה'],
    notable: 'הוביל את סופרציקל-הפרפטואלס 2025 — נפח-סקטור $12.09T.',
  },
  {
    name: 'dYdX v4', chains: 'אפצ׳יין-Cosmos עצמאי',
    highlights: ['ולידטורים מריצים ספרי-אורדרים מחוץ-לשרשרת עם סליקה-על-השרשרת', 'קודקוד פתוח-מלא (chain+backend+frontends)', 'בזיזה-אנכית: כל-רכיב-רץ אצל-ולידטורים-עצמאיים'],
    features: ['perps עד-~50x', 'limit', 'stop-loss', 'trailing-stop', 'תשתית-אורדרבוק-ולידטורית'],
    notable: 'הפרוטוקול-הכחול-הראשון-שנטש-את-Ethereum לשרשרת-ריבונית משלו — הוכחת-תורת-השרשרת-הריבונית.',
  },
  {
    name: 'GMX v2', chains: 'Arbitrum, Avalanche',
    highlights: ['פרפטואלס-סינתטיים מתומחרי-אורקל (Chainlink) — בלי-אורדרבוק', 'בריכות GM/GLV רב-נכסיות עם איזון-PnL', 'Real-yield: עמלות-משולמות-ל-LP בנכסי-אמת'],
    features: ['perps עד-100x', 'סוואפ-ספוט', 'כספות-GLV', 'LP-מדדי-GLP', 'long/short כל-נכס'],
    notable: 'חלוץ-נרטיב-התשואה-האמתית — ה-LP כ"בית" בקזינו-על-השרשרת.',
  },
  {
    name: 'Raydium', chains: 'Solana',
    highlights: ['תשתית-הנזילות-הראשית של Solana: AMM היברידי + CLMM', 'אינטגרציה-עמוקה-עם pump.fun (מיגרציית-מימים)', 'בריכות-CLMM ללא-עמלת-פרוטוקול'],
    features: ['CLMM', 'AMM', 'כלכלת-מימים/launchpad', 'יצירת-בריכות-הרשאתית'],
    notable: 'מחקר-arXiv: עד-93% מ-388,000 בריכות-שנבדקו = חשד-ראג — הפראית-והמסוכנת-של כלכלת-ההשקות.',
  },
  {
    name: 'Orca', chains: 'Solana',
    highlights: ['Whirlpools — ה-CLMM הראשון של Solana, קוד-פתוח-מלא', 'Smart-Router לביצוע-מיטבי על-פני בריכות', 'Wavebreak: עיצוב-נזילות-שמרסן-קפיצות-תנודתיות'],
    features: ['CLMM', 'נזילות-חד-צדדית', 'ניתוב-חכם', 'חוות-תשואה', 'SDK-פתוח'],
    notable: 'ה-CLMM הידידותי-ביותר-למפתחים ב-Solana — כוח-מניע-מאחורי פורקים ובוטים.',
  },
  {
    name: 'Meteora', chains: 'Solana',
    highlights: ['DLMM — נזילות-מרוכזת מבוססת-בינים שמעצבת-עצמה בזמן-אמת', 'DAMM v2 + עמלות-דינמיות לפי-תנודתיות', 'כספות-דינמיות — אסטרטגיות-תשואה אוטומטיות'],
    features: ['ביני-DLMM', 'עמלות-דינמיות', 'כספות-דינמיות', 'launchpad', 'אדריכלות-בינים-עמידה-MEV'],
    notable: 'תשתית-ההשקה-המרכזית של Solana (MET 2025) — נזילות-שמתאימה-את-עצמה לפעילות.',
  },
  {
    name: 'Curve', chains: 'Ethereum + 9+ רשתות',
    highlights: ['אינווריאנט-StableSwap — ה-AMM הקנוני ליציב-על-יציב', 'StableSwapNG: בריכות-דינמיות של עד-8-טוקנים + ERC-4626', 'crvUSD + הלוואות + מנגנון-veCRV המקורי'],
    features: ['stableswap', 'סטייבלקוין-מקורי', 'הלוואות', 'פריסה-חוצת-רשתות', 'ממשל-gauge/ve'],
    notable: 'שיא-היסטורי: $34.6B ברבעון-1-ל-2025 בלבד — עמוד-התווך של נזילות-היציבים.',
  },
  {
    name: 'Balancer v3', chains: 'Ethereum, Arbitrum, Base, Gnosis, Optimism, Polygon',
    highlights: ['כתיבה-מחדש-תלת-שכבתית: לוגיקת-בריכה / Vault-סליקה / ראוטרים-חוץ', 'מסגרת-hooks משלו', '100%-Boosted-Pools עם-Aave: היתרה-כולה בנכסי-תשואה ERC-4626'],
    features: ['boosted-pools (עמלות+תשואת-הלוואה מוערמות)', 'hooks', 'veBAL', 'בריכות-רב-טוקניות', 'stable-קומפוזביליות'],
    notable: 'כל-דולר-LP מרוויח עמלות-סוואף ותשואת-Aave במקביל — השרטוט ל"נזילות-נושאת-תשואה".',
  },
  {
    name: 'PancakeSwap v4', chains: 'BNB, Ethereum, Base, Arbitrum, Aptos, Linea, opBNB, zkSync...',
    highlights: ['אימוץ-hooks+singleton בסגנון-v4 — על-המספר-הרב-ביותר-של-שרשראות', 'Dynamic-Fee-Hook: עמלות-מתאימות-עצמן לתנודתיות בזמן-אמת', 'Infinity — אדריכלות-הדור-הבא'],
    features: ['hooks', 'limit-orders', 'position-manager+farms', 'UX-רב-שרשרתי', 'כלכלת-CAKE'],
    notable: 'ההתרחבות-הרב-שרשרתית-האגרסיבית-בהיסטוריה — כולל Aptos שאינו-EVM.',
  },
  {
    name: 'Aerodrome', chains: 'Base (בלעדי)',
    highlights: ['ve(3,3): פליטות-vote-escrow + שוחד + גלגל-תנופה-תמריצי', 'Slipstream — נזילות-מרוכזת', 'Metadex03 — אינטגרציית-נזילות חוצת-שרשראות'],
    features: ['בריכות-CL', 'הצבעת-gauge+שוחד', 'גלגל-veAERO', 'מרכז-הנזילות של Base'],
    notable: 'ה-DEX #1 ב-Base של Coinbase — ההוכחה-החיה ש-ve(3,3) לוכד-נזילות-שרשרת-שלמה.',
  },
  {
    name: 'KyberSwap', chains: '10+ שרשראות',
    highlights: ['אגרגטור-ניתוב על-פני Uniswap/Sushi/Curve ועוד', 'Elastic: CLMM עם גורם-הגברה + השקעה-עצמית-אוטומטית של עמלות', 'Zap — LP-בקליק-אחד דרך-האגרגטור'],
    features: ['אגרגטור', 'CLMM-מוגבר', 'Zap-קליק-אחד', 'limit-orders', 'רב-שרשרתי'],
    notable: 'ההגברה+הריבית-דריבית של Elastic יכולות-לעקוף CLMM רגיל כשהמחיר-בטווח.',
  },
  {
    name: '1inch Fusion / Fusion+', chains: '10-12+ EVM',
    highlights: ['Fusion: סוואפים-ללא-גז — חותמים-כוונות, resolvers מתחרים-במכרז-הולנדי', 'Fusion+: חוצה-שרשראות-ללא-גז עם escrow אטומי בשתי-השרשראות', 'הגנת-MEV: הפקודות-לעולם-לא-יושבות ב-mempool-ציבורי'],
    features: ['סוואפ-ללא-גז', 'ביצוע-מבוסס-כוונות', 'מכרז-הולנדי', 'חוצה-שרשראות', 'הגנת-MEV', 'אגרגטור'],
    notable: 'תבנית-התעשייה למסחר-מבוסס-כוונות-ללא-גז — מאומצת ע"י UniswapX ואחרים.',
  },
  {
    name: 'CoW Swap (CoW Protocol)', chains: 'Ethereum, Gnosis, Arbitrum, Base, Avalanche, Polygon',
    highlights: ['מכרזי-אצווה עם מחיר-פסיקה-אחיד', 'תחרות-solvers מקצועיים למקסום-עודף-המשתמש', 'CoW — התאמות-משתמש-למשתמש לפני-נגיעה-בבריכה'],
    features: ['הגנת-MEV החזקה-ביותר', 'פקודות-ללא-גז', 'מכרזי-אצווה', 'limit', 'TWAP', 'כוונות'],
    notable: 'כששתי-פקודות-נפגשות-זו-בזו — שני-הצדדים-מקבלים-מחיר-טוב-מכל-ציטוט-AMM.',
  },
  {
    name: 'Odos', chains: '15-20+ שרשראות',
    highlights: ['SOR-קנייני המוצא-מסלולי-רב-קפיצה לא-מובנים-לעין', 'N-in-M-out: איזון-תיק-שלם בטרנזקציה-אחת', 'AutoRouter עם איזון-מחיר/גז'],
    features: ['ניתוב-רב-שרשרתי', 'סוואפ-אצווה-רב-טוקני', 'איזון-תיק בטרנזקציה-אחת', 'מציאת-מסלול מודעת-גז'],
    notable: 'מנצח-תחרויות-ניתוב על-אף-גודלו-הקטן-יחסית — המסלולים-הלא-מובנים-מנצחים.',
  },
  {
    name: 'Li.Fi', chains: '60+ שרשראות',
    highlights: ['אגרגטור-גישור + אגרגטור-DEX יחד: כל-2-נכסים-חוצה-שרשראות', 'ניתוב על-פני 20+ אגרגטורים ועשרות-גשרים', 'שכבת-ביצוע-מבוססת-כוונות-מוטמעת בארנקים'],
    features: ['סוואפ-חוצה-שרשראות', 'אגרגציית-גשרים', 'אגרגציית-DEX', 'הפשטת-שרשראות', 'SDK/API'],
    notable: 'מסילת-הרכבת-הבלתי-נראית של web3 — כפתור-ה"גשר" של רוב-הארנקים = Li.Fi מתחת.',
  },
  {
    name: 'Thruster', chains: 'Blast (L2)',
    highlights: ['DEX-תשואתי: נכסים-מרוויחים-תשואת-מקור של Blast תוך-כדי-שהם-LP', 'AMM-אופקי + stableswap + Turbo-launchpad', 'נתמך-Pantera; $2B+ נפח, $300M נזילות'],
    features: ['LP-תשואת-מקור', 'launchpad', 'stableswap', 'עיצוב-תמריצי-נקודות'],
    notable: 'נזילות-שמתוכננת-סביב-תשואת-המקור של-השרשרת — LP-משולם-ע"י-ה-L2 עצמו.',
  },
  {
    name: 'Camelot', chains: 'Arbitrum',
    highlights: ['תשתית-נזילות-מותאמת-אישית לבונים', 'Nitro-pools (עמלה/תשואה מותאמות) + Sparta', 'אוריינטציית-real-yield למשתתפי-המערכת'],
    features: ['Nitro', 'Sparta', 'launchpad-לפרויקטי-Arbitrum', 'staking-תשואה-אמת'],
    notable: '"תשתית-נזילות לבונים" — נטוע-עמוק באקוסיסטם-המקורי של Arbitrum.',
  },
  {
    name: 'Vertex', chains: 'Arbitrum (+ Edge)',
    highlights: ['היברידי-אנכי: sequencer-אורדרבוק חוץ + מנוע-סיכונים-על-השרשרת + AMM', 'ספוט+פרפטואלס+שוק-כספים בחשבון-אחד עם margin-מאוחד', 'סופיות-תת-שנייה, עמלות-תת-סנט'],
    features: ['אורדרבוק-AMM היברידי', 'perps', 'ספוט', 'הלוואות-מוטמעות', 'margin-מאוחד'],
    notable: 'ההיאנלוגיה-הקרובה-ביותר-לחשבון-CEX שלם — הלוואה, הלוואת-נגד ומסחר מבטחונת-אחת.',
  },
  {
    name: 'Bluefin', chains: 'Sui',
    highlights: ['CLOB-פרפטואלס על-Sui (~0.4-0.5ש׳ סופיות)', 'פרפטואלס + אופציות + ספוט', 'UI/ביצועים-ברמת-CEX על L1-ציבורי'],
    features: ['perps-אורדרבוק', 'אופציות', 'limit/stop', 'השהיה-ידידותית-לתדירות-גבוהה'],
    notable: 'הוכחה-ש-L1-שאינו-EVM יכול-לשאת-זירת-נגזרות רצינית.',
  },
  {
    name: 'Uniswap Labs Wallet', chains: 'Ethereum, Base, Arbitrum, Optimism, Polygon, Unichain, BNB, Zora, World Chain',
    highlights: ['ארנק-self-custody מובנה-לסוואפ: רב-שרשרתי + on-ramp פיאט + NFT', 'UniswapX: מילויים-הולנדיים — ללא-גז, מוגן-MEV, fillers מתחרים', 'הגנות-אנטי-סנדוויץ׳ + התראות-מחיר'],
    features: ['מילויים-ללא-גז', 'הגנת-MEV', 'סוואפים-רב-שרשרתיים', 'on-ramp פיאט', 'התראות-מחיר'],
    notable: 'ה-DEX-הגדול-ממלא-הזמנות מחוץ-לשרשרת-לפני-שהן-נוגעות-בבריכה.',
  },
  {
    name: 'מחסנית-2025 (כוונות/הפשטת-שרשראות/MEV/AI)', chains: 'כל-השרשראות (chain-agnostic)',
    highlights: ['מסחר-מבוסס-כוונות: חותמים-תוצאה, לא-טרנזקציה', 'הפשטת-שרשראות: לסחור-בכל-נכס-בלי-מדרגות-גישור', 'MEV-כברירת-מחדל: MEV-Blocker, זרימה-פרטית, Flashbots-Protect', 'גז-אפס דרך ERC-4337/paymasters', 'ממשקי-AI-צ׳אט כשכבת-UX הבאה; נפח-פרפטואלס $12.09T'],
    features: ['כוונות', 'הפשטת-שרשראות', 'הגנת-MEV', 'גז-אפס', 'כל-2-נכסים-חוצה-שרשראות', 'UX-מסייע-AI'],
    notable: 'התזה-שהתעשייה-התכנסה-אליה: חותמים-כוונות-ולעולם-לא-רואים גז, גשרים או mempool.',
  },
];

export const CHECKLIST: ChecklistItem[] = [
  {
    feature: '1. ניתוב-אגרגציה חכם (ביצוע-מיטבי בין-זירות)',
    why: 'המבדיל #1 של דקסים-מודרניים: מצטטים-על-פני כל-הבריכות-והדקסים ומנתבים-רב-קפיצה אוטומטית — המחיר-הוא-המוצר.',
    leaders: 'Jupiter, 1inch, KyberSwap, Odos',
    adoption: 'partial',
    note: 'ניתוב-אטומי פנימי על מנוע-העיגונים (MAX_LEGS=3) + ציטוטי-אגרגטורים-חיים (Jupiter/Li.Fi) בגשר-החי.',
  },
  {
    feature: '2. זרם-שוק רב-שרשרתי בזמן-אמת (מחירים, בלוקים, גז, בריאות-שרשרת)',
    why: 'אמת-חיה היא עמוד-התווך של אמון-ושל UX-מקצועי.',
    leaders: 'Hyperliquid (0.07s), DEXScreener, GeckoTerminal, Jupiter Meta-API',
    adoption: 'live',
    note: 'גשר-החי: פרובות-בלוק-חיות ל-10 רשתות + מחירי-שוק-אמת + זוגות-DexScreener — בעמוד-זה.',
  },
  {
    feature: '3. נזילות-מרוכזת (CLMM/DLMM) + עמלות-דינמיות',
    why: 'תקן-יעילות-ההון מאז-v3; בינים-ועמלות-דינמיות מתאימות-עצמן לתנודתיות.',
    leaders: 'Uniswap v4, Raydium, Orca, Meteora, Aerodrome Slipstream',
    adoption: 'planned',
    note: 'דורש-חוזים-על-השרשרת — במפת-הדרך של מנוע-העיגונים.',
  },
  {
    feature: '4. פקודות-לימיט, טריגר וסטופ (כולל trailing-stop)',
    why: 'שולחן-המשחק של מסחר-אמת: קובעים-מחיר-והולכים — דקס-הופך-לטרמינל.',
    leaders: 'Jupiter, dYdX, Hyperliquid, PancakeSwap',
    adoption: 'planned',
    note: 'בתכנון: שכבת-פקודות-מותנות על האורקל-החי של הפלטפורמה.',
  },
  {
    feature: '5. סוואפים וגישור חוצי-שרשראות מובנים',
    why: 'הנזילות-רב-שרשרתית; מצפים-לכל-2-נכסים-בלי-לצאת-מהאפליקציה.',
    leaders: 'Li.Fi, Socket, 1inch Fusion+, Jupiter',
    adoption: 'live',
    note: 'ציטוטי-גשר-אמת (Li.Fi, 60+ שרשראות) + ציטוטי-סוואף (Jupiter/Li.Fi) — סטודיו-הציטוטים בעמוד-זה. ביצוע-דורש-ארנק-חתימה.',
  },
  {
    feature: '6. הגנת-MEV (מכרזי-אצווה / זרימה-פרטית / תחרות-solvers)',
    why: 'התקפות-סנדוויץ׳ ממסות-כל-עסקה; ה-MEV חוזר-למשתמש.',
    leaders: 'CoW Swap, 1inch, UniswapX, MEV Blocker',
    adoption: 'planned',
    note: 'מבנה-הפקודות-המתוכנן ייטמע בנתיבים-פרטיים-ומכרזים.',
  },
  {
    feature: '7. מסחר-ללא-גז (כוונות + account-abstraction)',
    why: 'חותמים-כוונה, resolver משלם-גז — מסיר-את-החיכוך-#1.',
    leaders: '1inch Fusion, CoW Swap, UniswapX',
    adoption: 'planned',
    note: 'בתכנון אחרי שכבת-הפקודות.',
  },
  {
    feature: '8. פרפטואלס-עם-מנוף (נגזרות-על-השרשרת)',
    why: 'נפח-פרפטואלס-דקס $12.09T ב-2025 — שם-חיים-הסוחרים-המתקדמים.',
    leaders: 'Hyperliquid, dYdX v4, GMX v2, Jupiter Perps, Vertex, Bluefin',
    adoption: 'out',
    note: 'מחוץ-לתחום-לפי-החלטת-המפעיל (פוקוס-ספוט/עיגונים).',
  },
  {
    feature: '9. DCA / אסטרטגיות-אוטומטיות / כספות',
    why: 'אוטומציה-מחזיקה-משתמשי-זנב-ארוך: קניות-חוזרות, value-averaging, כספות-אוטומטיות.',
    leaders: 'Jupiter (DCA+VA), Meteora vaults, KyberSwap auto-reinvest',
    adoption: 'partial',
    note: 'כספת-AES-256-GCM + גריד-STEEM (אסטרטגיית-סריג-חיה) כבר-חיים; DCA-קלאסי בתכנון.',
  },
  {
    feature: '10. Hooks / נזילות-ניתנת-לתכנות',
    why: 'הדפוס-האדריכלי של 2025: בריכות-כפלטפורמות — עמלות, TWAMM, הנחות-מחזיקים, עקומות-מותאמות.',
    leaders: 'Uniswap v4, PancakeSwap v4/Infinity, Balancer v3',
    adoption: 'out',
    note: 'דורש-שכבת-חוזים-חכמים-משלנו על-שרשרת-חוץ — מחוץ-להיקף-הנוכחי.',
  },
  {
    feature: '11. סינון-ביטחון-טוקנים (ראג/הוניפוט לפני-סוואף)',
    why: 'עד-93% מבריכות-נבדקות בסולנה היו חשודות-ראג — סינון-סיכונים הוא עניין-הישרדות.',
    leaders: 'GoPlus-integrated routers, DEXScreener audit data',
    adoption: 'partial',
    note: 'תגיות-verified/organicScore של Jupiter ונתוני-נזילות-אמת מ-DexScreener מוצגים בסייר-הטוקנים.',
  },
  {
    feature: '12. גרפים-חיים, התראות-לווייתנים ורשימות-מעקב',
    why: 'UX-סוחר-מקצועי: מסכים-מרובים, התראות, מעקב-ארנקים.',
    leaders: 'DEXScreener, Birdeye, Hyperliquid UI, Uniswap Wallet',
    adoption: 'partial',
    note: 'Pro-View עם זרם-חי + שינויי-מחיר-אמת בגשר-החי; התראות-בתכנון.',
  },
  {
    feature: '13. פעולות-תיק (N-in-M-out / מיקומים-מאוחדים / margin-מאוחד)',
    why: 'משתמשים-מתקדמים מאזנים-תיק-שלם בטרנזקציה-אחת.',
    leaders: 'Odos, Vertex, Hyperliquid',
    adoption: 'partial',
    note: 'תיק-חי עם יתרות-אמת; איזון-תיק-אטומי בתכנון.',
  },
  {
    feature: '14. Stableswap + LP-תשואת-מקור (boosted pools)',
    why: 'מסחר-יציב-בשפשוף-נמוך + LP-מרוויח-עמלות-ותשואת-הלוואה-במקביל.',
    leaders: 'Curve, Balancer v3 (Aave), Thruster',
    adoption: 'out',
    note: 'מחוץ-להיקף — המנוע-הפנימי מתמקד בעיגון-1:1.',
  },
  {
    feature: '15. Launchpad / כלכלת-השקות + תמריצי-בונים',
    why: 'השקות-טוקנים (8.5M+ ב-pump.fun) = משפך-הנפח-הראשי; שווקים-הרשאתיים-מיישרים-מפתחים.',
    leaders: 'pump.fun→Raydium/PumpSwap, Meteora, Thruster Turbo, Hyperliquid HIP-3',
    adoption: 'partial',
    note: 'דלת-הפקדות: הטבעת-נכסים-מגובה-1:1 דרך peg-door — launchpad-ריבוני של נכסים-עטופים.',
  },
];

export function adoptionLabel(a: Adoption): string {
  switch (a) {
    case 'live': return 'חי';
    case 'partial': return 'חלקי';
    case 'planned': return 'בתכנון';
    case 'out': return 'מחוץ-לתחום';
  }
}
