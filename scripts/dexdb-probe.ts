import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
// FIX(R16-c·m6): התסריט שייך-לסכימת-הדקס (BlockHeader/ChainSnapshot) — ננעל-מפורשות
// ל-dex.db כדי-שלא-ייגרר-בשוגג-אל-האם (DATABASE_URL-סביבתי/וקטור-הזיהום-המתועד-R12-a).
// Task 13-c: the pinned dex.db default died with the pre-reset sandbox —
// candidates now resolve against the live saos-dex repo first (env pin wins).
process.env.DATABASE_URL = process.env.DEX_DB_PIN
  ?? ["file:/home/z/git-audit/saos-dex/db/dex.db", "file:/home/z/my-project/saos-dex/db/dex.db"].find((u) => fs.existsSync(u.slice(5)))
  ?? "file:/home/z/git-audit/saos-dex/db/dex.db";
const db = new PrismaClient();
try {
  const tables = await db.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  console.log(`tables=${tables.map(t=>t.name).join(",")}`);
  const h = await db.$queryRawUnsafe<{ mh: string }[]>(`SELECT CAST(MAX(height) AS TEXT) as mh FROM BlockHeader`);
  console.log(`maxHeight=${h[0]?.mh}`);
  const snap = await db.$queryRawUnsafe<{ c: string }[]>(`SELECT CAST(COUNT(*) AS TEXT) as c FROM ChainSnapshot`);
  console.log(`snapshots=${snap[0]?.c}`);
} catch (e) { console.error("ERR:", (e as Error).message.slice(0, 300)); }
finally { await db.$disconnect(); }
