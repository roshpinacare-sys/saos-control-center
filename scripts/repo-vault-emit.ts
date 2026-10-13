// ═══ שליפת-סוד-בלוע-מהמעטפת-אל-צינור (T-64 · שרשרת-הריבונות) ═════════════════
// החוליה-החסרה: המעטפת-הבלועה מכילה את סיסמת-כספת-הסודות (hq-vault-pass) —
// הסקריפט-הזה שולף אותה ומדפיס אותה **ל-stdout בלבד** לצורך-צינור:
//
//   PASS="$(bun scripts/repo-vault-emit.ts --name hq-vault-pass)"    # זיכרון-בלבד
//   HQ_VAULT_PASS="$PASS" bun sanbox/scripts/vault-restore.ts
//
// כללי-ברזל:
//  - מסרב-לרוץ-כש-stdout הוא מסוף (TTY) — מיועד-לצינור בלבד, לא לעיניים.
//  - אף-ערך-סוד לא נכתב לדיסק, לקבלה או ליומן. הפלט-היחיד: הסוד הגולמי ב-stdout.
//  - כל-הודעות-הדרך → stderr. כישלון → exit 1.
import { openRepoVault } from '../src/lib/repo-vault';

const args = process.argv.slice(2);
function argOf(flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}
const name = argOf('--name');
if (!name || !/^[a-z0-9-]{2,40}$/.test(name)) {
  console.error('שימוש: bun scripts/repo-vault-emit.ts --name <שם-בלוע-קנוני>');
  process.exit(1);
}
if (process.stdout.isTTY) {
  console.error('✖ מסורבל-למסוף — הסקריפט מיועד לצינור בלבד (אין-הדפסת-סודות-למסך).');
  process.exit(1);
}

let secret: string | undefined;
try {
  const { bundle } = openRepoVault();
  secret = bundle.absorbed?.[name];
} catch (e) {
  console.error(`✖ פתיחת-המעטפת-נכשלה: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
if (typeof secret !== 'string' || secret.length === 0) {
  console.error(`✖ אין-בלוע-בשם "${name}" במעטפת. הרץ repo-vault-absorb.ts תחילה.`);
  process.exit(1);
}
process.stdout.write(secret);
