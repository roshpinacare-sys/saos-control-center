// ═══ Secure-first secret-material loading (FIX Task 3-b · F2) ═══════════════
// הבעיה-שנמדדה: קבצי-חומר-המפתחות שהועלו-ל-upload/ חיים-על tmpfs שכופה 777
// (עולם-קריא — לא-ניתן-לתיקון-במקום). העתקים-בטוחים byte-identical הוקמו ב-
// ~/.devgate/secrets/saos-keys/ (0600-קבצים, 0700-תיקייה) — מקור-האמת-החדש.
// החוזה: קריאה secure-first; נפילה-ללגאסי upload/ עם אזהרה-קולנית (F2c); אף-מקור →
// null (fail-closed לקורא). אף-פונקציה כאן לא רושמת/מחזירה תוכן-קובץ — רק נתיב
// והרשאות-אוקטליות לאזהרה.
import fs from 'fs';
import os from 'os';
import path from 'path';

export const SECURE_MATERIAL_DIR =
  process.env.SECURE_MATERIAL_DIR || path.join(os.homedir(), '.devgate', 'secrets', 'saos-keys');

export interface MaterialSource {
  path: string; // הנתיב-שנבחר (מועבר-לקורא-בלבד — לעולם לא ללוג)
  legacy: boolean; // true = נתיב-לגאסי upload/ (tmpfs 777)
  mode: string; // הרשאות-אוקטליות (לאזהרה-בלבד)
}

/** secure-first: העתק-המוגן קודם; לגאסי אחריו. null = אין-חומר בשום-מקור. */
export function secureMaterialPath(name: string, legacyDirs: string[] = ['upload', '../upload']): MaterialSource | null {
  const secure = path.join(SECURE_MATERIAL_DIR, name);
  try {
    if (fs.existsSync(secure)) {
      const st = fs.statSync(secure);
      if (st.isFile() && st.size > 0) return { path: secure, legacy: false, mode: (st.mode & 0o777).toString(8) };
    }
  } catch { /* המשך ללגאסי */ }
  for (const dir of legacyDirs) {
    const p = path.resolve(process.cwd(), dir, name);
    try {
      if (!fs.existsSync(p)) continue;
      const st = fs.statSync(p);
      if (!st.isFile() || st.size === 0) continue;
      // FIX(3-b · F2c): אזהרה-קולנית על-שימוש-בלגאסי + בדיקת-הרשאות — אפס-תוכן-בלוג
      const loose = (st.mode & 0o077) !== 0;
      console.warn(
        `[secure-material] ⚠ LEGACY fallback in use: ${dir}/${name} (mode=${(st.mode & 0o777).toString(8)}${loose ? ' — group/other-readable!' : ''}); ההעתק-המוגן צריך להיות ב-${SECURE_MATERIAL_DIR}/${name} (תוכן-הקובץ לעולם לא נרשם)`,
      );
      return { path: p, legacy: true, mode: (st.mode & 0o777).toString(8) };
    } catch { /* מועמד-הבא */ }
  }
  return null;
}

/** קריאת-חומר secure-first — מחזיר תוכן או null (fail-closed לקורא). */
export function readSecureMaterial(name: string, legacyDirs?: string[]): string | null {
  const src = secureMaterialPath(name, legacyDirs);
  if (!src) return null;
  try {
    return fs.readFileSync(src.path, 'utf8');
  } catch {
    return null;
  }
}
