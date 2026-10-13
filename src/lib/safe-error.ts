// FIX(R16-b·m5): הנתיבים-הציבוריים-החזירו e.message-גולמי (200) — פנימי-Prisma/RPC
// עלול-היה-לדלוף-לאנונימיים. עתה: לאנונימיים — פסק-כנה-גנרי; לבעלים — הפירוט-המלא.
import { NextRequest } from 'next/server';
import { requireOwner } from '@/lib/auth';

export async function safeErr(req: NextRequest, e: unknown, fallback: string): Promise<{ ok: false; error: string }> {
  let owner: { id: string; scope: string; label: string } | null = null;
  try { owner = await requireOwner(req); } catch { /* session check best-effort */ }
  const msg = e instanceof Error ? e.message : String(e).slice(0, 200);
  return { ok: false, error: owner ? msg : `${fallback} (פירוט-מלא זמין לסשן-הבעלים בלבד — R16-b·m5)` };
}
