import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { secp256k1 } from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';

// ממשק למנועי ההשוואה
interface Engine {
  name: string;
  process: (input: string) => Promise<string>;
}

// ממשק לתוצאות ההשוואה
interface ComparisonResult {
  input: string;
  outputs: Record<string, string>;
  matches: Record<string, boolean>;
  inconsistencies: string[];
}

// מנועי ההשוואה הזמינים
const engines: Engine[] = [
  {
    name: 'noble-secp256k1',
    process: async (input) => {
      const hash = sha256(input);
      const privateKey = secp256k1.utils.randomPrivateKey();
      const publicKey = secp256k1.getPublicKey(privateKey);
      return `Hash: ${Buffer.from(hash).toString('hex')}\nPublic Key: ${Buffer.from(publicKey).toString('hex')}`;
    }
  },
  {
    name: 'noble-hashes',
    process: async (input) => {
      const sha256Hash = sha256(input);
      const ripemd160Hash = ripemd160(input);
      return `SHA256: ${Buffer.from(sha256Hash).toString('hex')}\nRIPEMD160: ${Buffer.from(ripemd160Hash).toString('hex')}`;
    }
  },
  {
    name: 'core-engine',
    process: async (input) => {
      // זה מדמה את מנוע ה-core/ המקורי
      // ביישום אמיתי, כאן יהיה קריאה למנוע ה-core/
      const hash = createHash('sha256').update(input).digest('hex');
      return `Core Hash: ${hash}`;
    }
  }
];

// פונקציית עזר להשוואת תוצאות
function compareResults(outputs: Record<string, string>): Record<string, boolean> {
  const results: Record<string, boolean> = {};
  const engineNames = Object.keys(outputs);
  
  // השווה כל זוג מנועים
  for (let i = 0; i < engineNames.length; i++) {
    for (let j = i + 1; j < engineNames.length; j++) {
      const engine1 = engineNames[i];
      const engine2 = engineNames[j];
      results[`${engine1} vs ${engine2}`] = outputs[engine1] === outputs[engine2];
    }
  }
  
  return results;
}

// פונקציית עזר לאיתור אי התאמות
function findInconsistencies(results: Record<string, string>, matches: Record<string, boolean>): string[] {
  const inconsistencies: string[] = [];
  
  for (const [comparison, isMatch] of Object.entries(matches)) {
    if (!isMatch) {
      const [engine1, engine2] = comparison.split(' vs ');
      inconsistencies.push(`אי התאמה בין ${engine1} ל-${engine2}:\n${engine1}: ${results[engine1]}\n${engine2}: ${results[engine2]}`);
    }
  }
  
  return inconsistencies;
}

// פונקציה ראשית לעיבוד קלט יחיד
async function processInput(input: string): Promise<ComparisonResult> {
  const outputs: Record<string, string> = {};
  
  // עיבוד הקלט בכל המנועים
  for (const engine of engines) {
    try {
      outputs[engine.name] = await engine.process(input);
    } catch (error) {
      outputs[engine.name] = `שגיאה: ${(error as Error).message}`;
    }
  }
  
  // השוואת התוצאות
  const matches = compareResults(outputs);
  
  // איתור אי התאמות
  const inconsistencies = findInconsistencies(outputs, matches);
  
  return {
    input,
    outputs,
    matches,
    inconsistencies
  };
}

// פונקציה להדפסת דוח מפורט
function printReport(result: ComparisonResult): void {
  console.log(`\n=== דוח השוואה עבור קלט: "${result.input}" ===`);
  console.log('\nתוצאות:');
  
  for (const [engine, output] of Object.entries(result.outputs)) {
    console.log(`\n[${engine}]:`);
    console.log(output);
  }
  
  console.log('\nהתאמות:');
  for (const [comparison, isMatch] of Object.entries(result.matches)) {
    console.log(`${comparison}: ${isMatch ? '✓' : '✗'}`);
  }
  
  if (result.inconsistencies.length > 0) {
    console.log('\nאי התאמות פוטנציאליות:');
    result.inconsistencies.forEach(inconsistency => {
      console.log(`\n${inconsistency}`);
    });
  } else {
    console.log('\n✓ כל התוצאות תואמות');
  }
}

// פונקציה לשמירת דוח לקובץ
function saveReport(result: ComparisonResult, filename?: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultFilename = `comparison-report-${timestamp}.json`;
  const filepath = filename ? join(process.cwd(), filename) : join(process.cwd(), defaultFilename);
  
  const report = {
    timestamp,
    input: result.input,
    outputs: result.outputs,
    matches: result.matches,
    inconsistencies: result.inconsistencies
  };
  
  try {
    writeFileSync(filepath, JSON.stringify(report, null, 2));
    console.log(`\nדוח נשמר ב: ${filepath}`);
  } catch (error) {
    console.error(`\nשגיאה בשמירת הדוח: ${(error as Error).message}`);
  }
}

// פונקציה לבדיקות אוטומטיות
async function runAutomatedTests(): Promise<void> {
  console.log('\n=== הפעלת בדיקות אוטומטיות ===');
  
  const testInputs = [
    'קלט מבחן 1',
    'קלט מבחן 2',
    '',
    'קלט ארוך יותר עם תווים מיוחדים !@#$%^&*()'
  ];
  
  for (const input of testInputs) {
    console.log(`\nבדיקה עם קלט: "${input}"`);
    const result = await processInput(input);
    printReport(result);
    
    // שמירת דוח עבור כל בדיקה אוטומטית
    saveReport(result, `auto-test-${Date.now()}.json`);
  }
}

// פונקציה ראשית
async function main() {
  console.log('=== מנהל השוואת מנועי קריפטוגרפיה ===');
  console.log('מנועים זמינים:');
  engines.forEach(engine => console.log(`- ${engine.name}`));
  
  // בדיקת ארגומנטים שורת הפקודה
  if (process.argv.includes('--test')) {
    await runAutomatedTests();
    return;
  }
  
  if (process.argv.includes('--file')) {
    const filePath = process.argv[process.argv.indexOf('--file') + 1];
    if (!filePath) {
      console.error('\nשגיאה: נדרש שם קובץ');
      process.exit(1);
    }
    
    try {
      const inputs = readFileSync(filePath, 'utf-8').split('\n').filter(line => line.trim() !== '');
      console.log(`\nעיבוד ${inputs.length} קלטים מהקובץ: ${filePath}`);
      
      for (const input of inputs) {
        const result = await processInput(input);
        printReport(result);
        saveReport(result);
      }
    } catch (error) {
      console.error(`\nשגיאה בקריאת הקובץ: ${(error as Error).message}`);
      process.exit(1);
    }
    return;
  }
  
  // קלט אינטראקטיבי
  console.log('\nהזן קלט להשוואה (הקש Enter פעמיים לסיום):');
  
  const inputs: string[] = [];
  let input = '';
  
  for await (const chunk of process.stdin) {
    const line = chunk.toString();
    if (line === '\n') {
      if (input === '') break;
      inputs.push(input);
      input = '';
    } else {
      input += line.trim();
    }
  }
  
  if (inputs.length === 0) {
    console.log('\nלא נמצא קלט. מפעיל בדיקות אוטומטיות...');
    await runAutomatedTests();
    return;
  }
  
  console.log(`\nעיבוד ${inputs.length} קלטים...`);
  
  for (const input of inputs) {
    const result = await processInput(input);
    printReport(result);
    saveReport(result);
  }
}

// הפעלת התוכנית
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`\nשגיאה כללית: ${(error as Error).message}`);
    process.exit(1);
  });
}

// ייצוא לשימוש כמודול
export { processInput, printReport, saveReport, runAutomatedTests, engines };
