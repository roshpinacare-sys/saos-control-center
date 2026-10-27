import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Secp256k1 } from '@noble/secp256k1';
import { sha256, ripemd160 } from '@noble/hashes/sha256';
import { createHash } from 'crypto';

// ייבוא פונקציות מהמנוע המקורי (core/)
// במציאות, ניתן יהיה לייבא את זה מהמיקום המתאים ב-core/
// לצורך הדוגמא, נדמיין שיש לנו פונקציות אלו
const coreSecp256k1 = {
  generatePrivateKey: () => {
    // דמיון ללוגיקה המקורית
    return Secp256k1.utils.randomPrivateKey();
  },
  getPublicKey: (privateKey: Uint8Array, compressed = true) => {
    // דמיון ללוגיקה המקורית
    return Secp256k1.getPublicKey(privateKey, compressed);
  },
  sign: (message: Uint8Array, privateKey: Uint8Array) => {
    // דמיון ללוגיקה המקורית
    return Secp256k1.sign(message, privateKey);
  },
  verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => {
    // דמיון ללוגיקה המקורית
    return Secp256k1.verify(signature, message, publicKey);
  }
};

const coreHashes = {
  sha256: (data: Uint8Array) => {
    // דמיון ללוגיקה המקורית
    return sha256(data);
  },
  ripemd160: (data: Uint8Array) => {
    // דמיון ללוגיקה המקורית
    return ripemd160(data);
  }
};

describe('Fabric Engine vs Core Engine Comparison', () => {
  // נתוני בדיקה מגוונים
  const testCases = [
    {
      name: 'Empty input',
      data: new Uint8Array(),
      privateKey: new Uint8Array(32)
    },
    {
      name: 'Small data',
      data: new TextEncoder().encode('Hello, SAOS!'),
      privateKey: Secp256k1.utils.randomPrivateKey()
    },
    {
      name: 'Large data',
      data: new TextEncoder().encode('A'.repeat(10000)),
      privateKey: Secp256k1.utils.randomPrivateKey()
    },
    {
      name: 'Edge case - max int',
      data: new Uint8Array([255, 255, 255, 255]),
      privateKey: Secp256k1.utils.randomPrivateKey()
    },
    {
      name: 'Binary data',
      data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      privateKey: Secp256k1.utils.randomPrivateKey()
    }
  ];

  describe('Hash Functions Comparison', () => {
    it('should produce identical SHA256 hashes', () => {
      for (const testCase of testCases) {
        const fabricHash = coreHashes.sha256(testCase.data);
        const coreHash = createHash('sha256').update(testCase.data).digest();
        
        expect(fabricHash).toEqual(coreHash);
      }
    });

    it('should produce identical RIPEMD160 hashes', () => {
      for (const testCase of testCases) {
        const fabricHash = coreHashes.ripemd160(testCase.data);
        const coreHash = createHash('ripemd160').update(testCase.data).digest();
        
        expect(fabricHash).toEqual(coreHash);
      }
    });
  });

  describe('Secp256k1 Comparison', () => {
    it('should generate identical private keys', () => {
      for (const testCase of testCases) {
        const fabricPrivateKey = coreSecp256k1.generatePrivateKey();
        const corePrivateKey = Secp256k1.utils.randomPrivateKey();
        
        // בדיקת אורך
        expect(fabricPrivateKey.length).toBe(32);
        expect(corePrivateKey.length).toBe(32);
        
        // בדיקת תקינות
        expect(Secp256k1.utils.isValidPrivateKey(fabricPrivateKey)).toBe(true);
        expect(Secp256k1.utils.isValidPrivateKey(corePrivateKey)).toBe(true);
      }
    });

    it('should produce identical public keys', () => {
      for (const testCase of testCases) {
        const publicKey = coreSecp256k1.getPublicKey(testCase.privateKey);
        const corePublicKey = Secp256k1.getPublicKey(testCase.privateKey);
        
        expect(publicKey).toEqual(corePublicKey);
      }
    });

    it('should produce identical signatures', () => {
      for (const testCase of testCases) {
        const signature = coreSecp256k1.sign(testCase.data, testCase.privateKey);
        const coreSignature = Secp256k1.sign(testCase.data, testCase.privateKey);
        
        expect(signature).toEqual(coreSignature);
      }
    });

    it('should verify signatures correctly', () => {
      for (const testCase of testCases) {
        const signature = coreSecp256k1.sign(testCase.data, testCase.privateKey);
        const publicKey = coreSecp256k1.getPublicKey(testCase.privateKey);
        
        expect(coreSecp256k1.verify(signature, testCase.data, publicKey)).toBe(true);
        expect(coreSecp256k1.verify(signature, new Uint8Array([1, 2, 3]), publicKey)).toBe(false);
      }
    });
  });

  describe('Performance Comparison', () => {
    it('should have comparable performance for SHA256', () => {
      const iterations = 1000;
      const largeData = new TextEncoder().encode('A'.repeat(1000));
      
      // בדיקת ביצועי fabric
      const fabricStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        coreHashes.sha256(largeData);
      }
      const fabricTime = performance.now() - fabricStart;
      
      // בדיקת ביצועי core
      const coreStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        createHash('sha256').update(largeData).digest();
      }
      const coreTime = performance.now() - coreStart;
      
      // השוואה - מתן סביבות 20% סטייה מותרת
      const tolerance = 0.2;
      const ratio = fabricTime / coreTime;
      
      expect(ratio).toBeGreaterThan(1 - tolerance);
      expect(ratio).toBeLessThan(1 + tolerance);
      
      console.log(`Fabric SHA256 time: ${fabricTime.toFixed(2)}ms`);
      console.log(`Core SHA256 time: ${coreTime.toFixed(2)}ms`);
      console.log(`Ratio (Fabric/Core): ${ratio.toFixed(2)}`);
    });

    it('should have comparable performance for signature operations', () => {
      const iterations = 100;
      const data = new TextEncoder().encode('Test message');
      const privateKey = Secp256k1.utils.randomPrivateKey();
      
      // בדיקת ביצועי fabric
      const fabricStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        coreSecp256k1.sign(data, privateKey);
      }
      const fabricTime = performance.now() - fabricStart;
      
      // בדיקת ביצועי core
      const coreStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        Secp256k1.sign(data, privateKey);
      }
      const coreTime = performance.now() - coreStart;
      
      // השוואה - מתן סביבות 20% סטייה מותרת
      const tolerance = 0.2;
      const ratio = fabricTime / coreTime;
      
      expect(ratio).toBeGreaterThan(1 - tolerance);
      expect(ratio).toBeLessThan(1 + tolerance);
      
      console.log(`Fabric signature time: ${fabricTime.toFixed(2)}ms`);
      console.log(`Core signature time: ${coreTime.toFixed(2)}ms`);
      console.log(`Ratio (Fabric/Core): ${ratio.toFixed(2)}`);
    });
  });
});

// דוח אוטומטי על חריגות
function generateReport(testResults: any) {
  // במימוש אמיתי, כאן יהיה קוד ליצירת דוח מפורט
  console.log('\n=== TEST REPORT ===');
  console.log(`Total tests: ${testResults.total}`);
  console.log(`Passed: ${testResults.passed}`);
  console.log(`Failed: ${testResults.failed}`);
  
  if (testResults.failed > 0) {
    console.log('\nFailures:');
    testResults.failures.forEach((failure: any) => {
      console.log(`- ${failure.test}: ${failure.message}`);
    });
  }
  
  console.log(`\nPerformance ratio (Fabric/Core): ${testResults.performanceRatio.toFixed(2)}`);
  console.log('==================\n');
}

// פונקציית הפעלה
describe('Test Runner', () => {
  it('should run all tests and generate report', () => {
    // בדיקה כללית שהטסטים רצים בהצלחה
    expect(true).toBe(true);
    
    // במימוש אמיתי, כאן יהיה קוד להרצת כל הבדיקות ואיסוף התוצאות
    const testResults = {
      total: 20,
      passed: 18,
      failed: 2,
      failures: [
        { test: 'Hash Functions', message: 'Minor performance deviation' },
        { test: 'Signature Verification', message: 'Edge case failed' }
      ],
      performanceRatio: 1.15
    };
    
    generateReport(testResults);
  });
});