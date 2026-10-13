// fleet-keys-decode.ts — T-64: פענוח-סובלני לצרור-מפתחות-הצי (מפתח-הכשל מהביקורת-באפס-אמון).
//
// ההיסטוריה: rescue-absorb.ts בלע במקור base64(קובץ) (b64:true), אך reabsorb-מאוחר
// שמר את הצורה הישירה MAGIC+hex. כל-הצרכנים הניחו רק פורמט-אחד → base64-decode
// על-טקסט-גלוי הניב payload=0 → "ERR_CRYPTO_INVALID_IV" בכל-הרצה של border-sweep
// וקרוביו — וההעברה-החתומה של HIVE (escalation hive-rc-retry-scheduled) נשארה
// תקועה בלי-יכולת-ריצה. העוזר-הזה מקבל את שני-הפורמטים וכושל-בכנות אם-שניהם-נכשלו.
//
// אפס-תלויות מעבר לnode:crypto · אפס-הדפסת-תוכן (רק-זריקות-עם-מטא-ממוסק).
import crypto from 'crypto';

export const FLEET_MAGIC = 'SAOS-FLEET-VAULT-1';

/** מחזיר payload: salt(16) | iv(12) | tag(16) | ciphertext. זורק-בכנות אם-אין-פורמט-תקין. */
export function decodeFleetEnc(stored: string): Buffer {
  let raw = '';
  try {
    const dec = Buffer.from(stored, 'base64').toString('utf8');
    if (dec.startsWith(FLEET_MAGIC)) raw = dec; // פורמט-א: base64(MAGIC+hex)
  } catch { /* ממשיך-לפורמט-ב */ }
  if (!raw && stored.startsWith(FLEET_MAGIC)) raw = stored; // פורמט-ב: MAGIC+hex-ישיר
  if (!raw.startsWith(FLEET_MAGIC)) {
    throw new Error('fleet-enc: MAGIC-לא-נמצא-בשום-פורמט (base64-עטוף וגם-ישיר)');
  }
  const payload = Buffer.from(raw.slice(FLEET_MAGIC.length).replace(/\s+/g, ''), 'hex');
  if (payload.length < 44) {
    throw new Error(`fleet-enc: payload-קצר-מדי (${payload.length}B < 44)`);
  }
  return payload;
}

/** מפתח-גזירה scrypt מהסיסמה-במטא-מול-המלח-בפורמט. */
export function fleetKey(metaPass: string, payload: Buffer): Buffer {
  return crypto.scryptSync(metaPass, payload.subarray(0, 16), 32);
}
