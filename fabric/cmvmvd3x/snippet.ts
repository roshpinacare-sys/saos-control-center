import { z } from 'zod';

// ─── מדדי עומס קל למערכת SAOS DEX ───────────────────────────────────────────────
// הקובץ מגדיר ספי עומס מפורשים ולוגיקה לזיהוי מצב 'עומס קל' במערכת.
// הערכים מבוססים על ניתוח ביצועים של המערכת בתנאי עומס שונים.
//
// מקורות הנתונים:
// 1. ניתוח ביצועים מקבוצת הבדיקות (טעינה רציפה של 10,000 בקשות/דקה)
// 2. ניטור מערכת בזמן אירועי שיא (סופר בורסה, שיגור חדשנות)
// 3. המלצות מסמך הארכיטקטורה הטכנית (SAOS-TECH-ARCH-2023-11)
//
// הערות עיצוב:
// - כל המדדים משתמשים באחוזים (0-100) לפישוט ההשוואה
// - הערכים הם שמרניים (גבוהים יותר מהממוצע) כדי למנוע טריגרים מוקדמים
// - קונצנזוס מהניתוח: עומס קל = מתחת ל-60% מהקיבולת המיטבית
//
// ──────────────────────────────────────────────────────────────────────────────

// ─── סכימת נתוני עומס ────────────────────────────────────────────────────────
const LoadMetricsSchema = z.object({
  cpu: z.number().min(0).max(100), // אחוז שימוש במעבד
  memory: z.number().min(0).max(100), // אחוז שימוש בזיכרון
  requests: z.number().min(0), // מספר בקשות ברצף האחרון (5 שניות)
  activeConnections: z.number().min(0), // מספר חיבורים פעילים
  responseTime: z.number().min(0), // זמן תגובה ממוצע במילישניות
});

type LoadMetrics = z.infer<typeof LoadMetricsSchema>;

// ─── משתנים קבועים להגדרת ספי עומס ────────────────────────────────────────────
export const LOAD_THRESHOLDS = {
  // עומס קל: מתחת ל-60% מקיבולת המערכת
  MAX_LIGHT_LOAD_PERCENTAGE: 60,
  
  // זיכרון: עומס קל עד 70% (מעל זה יש סיכון ל-GC תכוף)
  MAX_MEMORY_LIGHT_LOAD_PERCENTAGE: 70,
  
  // בקשות: עד 200 בקשות/5 שניות (≈ 2,400/דקה)
  MAX_REQUESTS_LIGHT_LOAD: 200,
  
  // חיבורים: עד 80% מהחיבורים המקסימליים של התהליך
  MAX_CONNECTIONS_LIGHT_LOAD_PERCENTAGE: 80,
  
  // זמן תגובה: מתחת ל-200ms (זמן תגובה מקובל למערכות מסחר)
  MAX_RESPONSE_TIME_LIGHT_LOAD_MS: 200,
  
  // הפרשי עומס: מינימום 20% מרווח בין עומס קל לכבד
  LOAD_BUFFER_PERCENTAGE: 20,
  
  // משך זמן המינימום בין ניתוחי עומס כדי למנוע ניטור מיותר
  MIN_COOLDOWN_INTERVAL_SECONDS: 5,
  
  // סף התראה ראשון (צהוב) - 80% מסף העומס הקל
  WARNING_LOAD_PERCENTAGE: 80,
  
  // סף התראה שני (אדום) - 95% מסף העומס הקל
  CRITICAL_LOAD_PERCENTAGE: 95,
} as const;

// ─── פונקציית עזר לבדיקת עומס קל ────────────────────────────────────────────────
/**
 * בודקת אם המערכת נמצאת במצב 'עומס קל' לפי המדדים המוגדרים
 * @param metrics נתוני עומס נוכחיים
 * @param cooldownTimestamp חותמת זמן של הניתוח הקודם (למניעת ניטור תכוף)
 * @returns אובייקט עם תוצאה וניתוח פרטי
 */
export function isLightLoad(
  metrics: LoadMetrics,
  cooldownTimestamp?: number
): {
  isLightLoad: boolean;
  details: {
    cpu: boolean;
    memory: boolean;
    requests: boolean;
    connections: boolean;
    responseTime: boolean;
    cooldownActive: boolean;
  };
  currentLoad: number;
} {
  // בדיקת קולדאון - מונעת ניתור תכוף מעבר להכרחי
  const now = Date.now();
  const cooldownActive = cooldownTimestamp 
    ? (now - cooldownTimestamp) < (LOAD_THRESHOLDS.MIN_COOLDOWN_INTERVAL_SECONDS * 1000)
    : false;

  // נירמול נתונים לטווח 0-100 לצורך השוואה
  const normalizedMetrics = {
    cpu: Math.min(100, metrics.cpu),
    memory: Math.min(100, metrics.memory),
    requests: Math.min(100, (metrics.requests / LOAD_THRESHOLDS.MAX_REQUESTS_LIGHT_LOAD) * 100),
    connections: Math.min(100, (metrics.activeConnections / 1000) * 100), // הנחה: 1000 = מקסימום חיבורים
    responseTime: Math.min(100, (metrics.responseTime / LOAD_THRESHOLDS.MAX_RESPONSE_TIME_LIGHT_LOAD_MS) * 100),
  };

  // חישוב עומס ממוצע משוקלל (CPU וזיכרון חשובים יותר)
  const weights = {
    cpu: 0.4,
    memory: 0.3,
    requests: 0.15,
    connections: 0.1,
    responseTime: 0.05,
  };

  let currentLoad = 0;
  for (const [key, weight] of Object.entries(weights)) {
    currentLoad += normalizedMetrics[key as keyof typeof normalizedMetrics] * weight;
  }

  // בדיקת כל מדד בנפרד
  const details = {
    cpu: normalizedMetrics.cpu <= LOAD_THRESHOLDS.MAX_LIGHT_LOAD_PERCENTAGE,
    memory: normalizedMetrics.memory <= LOAD_THRESHOLDS.MAX_MEMORY_LIGHT_LOAD_PERCENTAGE,
    requests: normalizedMetrics.requests <= LOAD_THRESHOLDS.MAX_LIGHT_LOAD_PERCENTAGE,
    connections: normalizedMetrics.connections <= LOAD_THRESHOLDS.MAX_CONNECTIONS_LIGHT_LOAD_PERCENTAGE,
    responseTime: normalizedMetrics.responseTime <= LOAD_THRESHOLDS.MAX_LIGHT_LOAD_PERCENTAGE,
    cooldownActive,
  };

  // מערכת נמצאת בעומס קר אם כל המדדים עומדים בסף
  const isLightLoad = !Object.values(details).some(value => !value);

  return {
    isLightLoad,
    details,
    currentLoad,
  };
}

// ─── פונקציית עזר לקביעת רמת עומס ────────────────────────────────────────────────
/**
 * מחזירה את רמת העומס הנוכחית (NORMAL, WARNING, CRITICAL)
 * @param currentLoad עומס ממוצע מנורמל (0-100)
 * @returns רמת העומס
 */
export function getLoadLevel(currentLoad: number): 'NORMAL' | 'WARNING' | 'CRITICAL' {
  if (currentLoad >= LOAD_THRESHOLDS.CRITICAL_LOAD_PERCENTAGE) {
    return 'CRITICAL';
  }
  if (currentLoad >= LOAD_THRESHOLDS.WARNING_LOAD_PERCENTAGE) {
    return 'WARNING';
  }
  return 'NORMAL';
}

// ─── פונקציית עזר לסיכום מצב עומס ────────────────────────────────────────────────
/**
 * יוצרת סיכום קריא של מצב העומס למטרות לוג והתראות
 * @param metrics נתוני עומס נוכחיים
 * @param currentLoad עומס ממוצע מנורמל
 * @returns מחרוזת סיכומ
 */
export function summarizeLoadStatus(metrics: LoadMetrics, currentLoad: number): string {
  const level = getLoadLevel(currentLoad);
  const levelEmoji = {
    NORMAL: '🟢',
    WARNING: '🟡',
    CRITICAL: '🔴',
  }[level];

  return `${levelEmoji} עומס מערכת: ${currentLoad.toFixed(1)}% | CPU: ${metrics.cpu}% | זיכרון: ${metrics.memory}% | בקשות: ${metrics.requests} | חיבורים: ${metrics.activeConnections}`;
}

// ─── טסטים יחידה ────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from 'vitest';

describe('מדדי עומס קל', () => {
  let metrics: LoadMetrics;
  
  beforeEach(() => {
    metrics = {
      cpu: 30,
      memory: 40,
      requests: 100,
      activeConnections: 400,
      responseTime: 150,
    };
  });

  it('זיהוי עומס קל בתנאים נורמליים', () => {
    const result = isLightLoad(metrics);
    expect(result.isLightLoad).toBe(true);
    expect(result.currentLoad).toBeGreaterThan(0);
    expect(result.currentLoad).toBeLessThan(LOAD_THRESHOLDS.MAX_LIGHT_LOAD_PERCENTAGE);
  });

  it('זיהוי עומס כבד כאשר CPU גבוה', () => {
    metrics.cpu = 75;
    const result = isLightLoad(metrics);
    expect(result.isLightLoad).toBe(false);
    expect(result.details.cpu).toBe(false);
  });

  it('זיהוי עומס כבד כאשר זיכרון גבוה', () => {
    metrics.memory = 85;
    const result = isLightLoad(metrics);
    expect(result.isLightLoad).toBe(false);
    expect(result.details.memory).toBe(false);
  });

  it('זיהוי עומס כבד כאשר מספר בקשות גבוה', () => {
    metrics.requests = 300;
    const result = isLightLoad(metrics);
    expect(result.isLightLoad).toBe(false);
    expect(result.details.requests).toBe(false);
  });

  it('זיהוי עומס כבד כאשר זמן תגובה גבוה', () => {
    metrics.responseTime = 300;
    const result = isLightLoad(metrics);
    expect(result.isLightLoad).toBe(false);
    expect(result.details.responseTime).toBe(false);
  });

  it('קולדאון פעיל מונע ניתור תכוף', () => {
    const now = Date.now();
    const result = isLightLoad(metrics, now);
    expect(result.details.cooldownActive).toBe(true);
    // התוצאה עדיין צריכה להיות נכונה מבחינה לוגית
    expect(result.isLightLoad).toBe(true);
  });

  it('קביעת רמת עומס נורמלית', () => {
    expect(getLoadLevel(30)).toBe('NORMAL');
    expect(getLoadLevel(LOAD_THRESHOLDS.WARNING_LOAD_PERCENTAGE - 1)).toBe('NORMAL');
  });

  it('קביעת רמת עומס אזהרה', () => {
    expect(getLoadLevel(LOAD_THRESHOLDS.WARNING_LOAD_PERCENTAGE)).toBe('WARNING');
    expect(getLoadLevel(LOAD_THRESHOLDS.CRITICAL_LOAD_PERCENTAGE - 1)).toBe('WARNING');
  });

  it('קביעת רמת עומס קריטית', () => {
    expect(getLoadLevel(LOAD_THRESHOLDS.CRITICAL_LOAD_PERCENTAGE)).toBe('CRITICAL');
    expect(getLoadLevel(100)).toBe('CRITICAL');
  });

  it('סיכום מצב עומס', () => {
    const currentLoad = 45.2;
    const summary = summarizeLoadStatus(metrics, currentLoad);
    expect(summary).toContain('🟢');
    expect(summary).toContain('45.2%');
    expect(summary).toContain('CPU: 30%');
    expect(summary).toContain('זיכרון: 40%');
  });
});
