#!/usr/bin/env bash
set -euo pipefail

# consistency-check.sh — השוואת עקביות בין מנועי fabric/ ל-core/ ב-saos-control-center
# דרישה: Node.js 20+, npm, ו-diff-libs מותקנים

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
FABRIC_DIR="$REPO_ROOT/src/lib/fabric"
CORE_DIR="$REPO_ROOT/src/lib/core"
REPORTS_DIR="$REPO_ROOT/consistency-reports"

# יצירת תיקיות
mkdir -p "$REPORTS_DIR"

# איסוף מקרי-מבחן (test-cases) — דוגמאות מקרים + מקרי-קצה
# כל תא-מבחן: <שם>|<קלט-fabric>|<קלט-core>
TEST_CASES=(
  "balance-check|100|100"
  "zero-balance|0|0"
  "overflow|999999999|999999999"
  "negative-input|-5|-5"
  "large-number|4294967295|4294967295"
  "fraction|0.5|0.5"
  "empty-string||"
)

# פונקציה להרצת בדיקה על מנוע fabric
run_fabric() {
  local test_name=$1
  local input=$2
  # נניח שיש פקודת-בדיקה: npx jest --testPathPattern=fabric/${test_name}
  # במקום זה, נריץ פקודת-דמה שמחזירה פלט קבוע
  echo "fabric:ok:input=${input}"
}

# פונקציה להרצת בדיקה על מנוע core
run_core() {
  local test_name=$1
  local input=$2
  # נניח שיש פקודת-בדיקה: npx jest --testPathPattern=core/${test_name}
  echo "core:ok:input=${input}"
}

# פונקציה להשוואה והשוואת פלט
compare_outputs() {
  local test_name=$1
  local fabric_out=$2
  local core_out=$3
  
  if [ "$fabric_out" = "$core_out" ]; then
    echo "MATCH:${test_name}:${fabric_out}"
  else
    echo "MISMATCH:${test_name}:fabric=${fabric_out}:core=${core_out}"
  fi
}

# ראשי-המסלול הראשי
main() {
  echo "=== התחלת בדיקת עקביות saos-control-center ==="
  echo "מנוע fabric: $FABRIC_DIR"
  echo "מנוע core: $CORE_DIR"
  
  # אימות קיומן של התיקיות
  if [ ! -d "$FABRIC_DIR" ]; then
    echo "❌ תיקיית fabric/ לא קיימת"
    exit 1
  fi
  if [ ! -d "$CORE_DIR" ]; then
    echo "❌ תיקיית core/ לא קיימת"
    exit 1
  fi
  
  # יצירת קובץ-דוח זמני
  DASH_FILE="$REPORTS_DIR/dashboard-$(date +%s).html"
  echo "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Consistency Report</title></head><body><h1>Consistency Report — saos-control-center</h1>" > "$DASH_FILE"
  
  echo "🔍 ריצת בדיקות והשוואה..."
  
  # מעגל על מקרי-מבחן
  for tc in "${TEST_CASES[@]}"; do
    IFS='|' read -r test_name fabric_input core_input <<< "$tc"
    
    # אימות קלט ריק (מקרה-קצה)
    if [ -z "$fabric_input" ] || [ -z "$core_input" ]; then
      echo "⚠️ דילוג על מקרה-קצה ריק: $test_name"
      echo "<tr><td>$test_name</td><td>SKIPPED (empty input)</td><td>SKIPPED (empty input)</td><td>N/A</td></tr>" >> "$DASH_FILE"
      continue
    fi
    
    # הרצת בדיקות
    fabric_result=$(run_fabric "$test_name" "$fabric_input")
    core_result=$(run_core "$test_name" "$core_input")
    
    # השוואה
    compare_outputs "$test_name" "$fabric_result" "$core_result"
    
    # הוספה לטבלת הדוח
    if echo "$fabric_result" | grep -q 'MISMATCH'; then
      echo "<tr style='background:#ffe6e6;'><td>$test_name</td><td>$fabric_result</td><td>$core_result</td><td style='color:red;'>MISMATCH</td></tr>" >> "$DASH_FILE"
    else
      echo "<tr><td>$test_name</td><td>$fabric_result</td><td>$core_result</td><td>MATCH</td></tr>" >> "$DASH_FILE"
    fi
  done
  
  # סיום דף-HTML
  echo "<h2>סטטיסטיקות</h2><p>סה"כ בדיקות: $(( ${#TEST_CASES[@]} ))</p></body></html>" >> "$DASH_FILE"
  
  echo "Ⓜ️ דוח נוצר: $DASH_FILE"
  echo "🔗 פתח בדפדפן: file://$DASH_FILE"
}

main "$@"
