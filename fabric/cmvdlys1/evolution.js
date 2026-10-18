import fs from 'fs';
import path from 'path';

// פונקציה למציאת כל קבצי ה-evolution בתיקיית learning/
function findEvolutionFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    
    if (item.isDirectory()) {
      // דירקטוריה - חפש בתוכה
      files.push(...findEvolutionFiles(fullPath));
    } else if (item.isFile() && item.name.startsWith('evolution-') && item.name.endsWith('.json')) {
      // קובץ evolution JSON
      files.push(fullPath);
    }
  }
  
  return files;
}

// פונקציה לעדכון קובץ JSON
function updateEvolutionFile(filePath) {
  try {
    // קריאת הקובץ
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // שדות להסרה
    const fieldsToRemove = ['runs', 'hist', 'in_progress', 'pending', 'failure'];
    
    // הסרת השדות
    fieldsToRemove.forEach(field => {
      if (data.hasOwnProperty(field)) {
        delete data[field];
      }
    });
    
    // הוספת metadata אם לא קיים
    if (!data.metadata) {
      data.metadata = {};
    }
    
    // עדכון metadata
    data.metadata = {
      "system_type": "deterministic_simulation",
      "memory_management": "none",
      "report_validity": "static_only"
    };
    
    // כתיבה חזרה לקובץ
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    
    return true;
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    return false;
  }
}

// פונקציה לאימות JSON
function validateJson(filePath) {
  try {
    JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return true;
  } catch (error) {
    console.error(`JSON validation failed for ${filePath}:`, error);
    return false;
  }
}

// פונקציה ראשית
function main() {
  // נתיב לתיקיית learning/
  const learningDir = path.join(process.cwd(), 'learning');
  
  // בדיקה אם התיקייה קיימת
  if (!fs.existsSync(learningDir)) {
    console.error('Directory learning/ does not exist');
    return;
  }
  
  // מציאת כל קבצי ה-evolution
  const evolutionFiles = findEvolutionFiles(learningDir);
  
  if (evolutionFiles.length === 0) {
    console.log('No evolution files found in learning/ directory');
    return;
  }
  
  console.log(`Found ${evolutionFiles.length} evolution files`);
  
  // עדכון כל קובץ
  const results = evolutionFiles.map(filePath => {
    const success = updateEvolutionFile(filePath);
    const valid = success && validateJson(filePath);
    return {
      file: path.basename(filePath),
      updated: success,
      valid: valid
    };
  });
  
  // דווח על תוצאות
  console.log('\nProcessing Results:');
  results.forEach(result => {
    const status = result.valid ? 'SUCCESS' : 'FAILED';
    console.log(`${result.file}: ${status}`);
  });
}

// הפעלת הפונקציה הראשית
main();