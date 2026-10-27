#!/usr/bin/env bash
# compare-engines.sh — השוואת פלט מנועי fabric/ לעומת core/ ב-saos-control-center
# תוכנן להרצה מתוך תיקיית השורש של saos-control-center

set -euo pipefail

# --- 1. הגדרת קלטי טסט סטנדרטיים (מפתחות, חתימות, גיבובים) ---
# קלטים בינאריים מייצגים מקרים שימושיים מרכזיים בקריפטו
TEST_INPUTS=(
  # מפתח פרטי (32 בתים)
  "0x1111111111111111111111111111111111111111111111111111111111111111"
  # כתובת ציבורייה (20 בתים)
  "0x2222222222222222222222222222222222222222"
  # הודעת טסט (טקסט)
  "Hello SAOS Cryptography Test"
  # חתימה דטרמיניסטית (64 hex = 32 bytes)
  "aa21de5 balance inquiry"
  # גיבוב SHA-256 input
  "test hash input 2026"
)

# --- 2. פונקציות עזר ---
run_core() {
  local input="$1"
  # ניסה למצוא פונקציה/סקрипט ב-core/ שטופל את הקלט
  if [ -d "core" ] && [ -x "core/process.sh" ]; then
    echo "$(cat "$input" | ./core/process.sh)"
  else
    echo "SKIP: core/ not available or process.sh missing" >&2
    return 1
  fi
}

run_fabric() {
  local input="$1"
  # ניסה למצוא פונקציה/סקрипט ב-fabric/ שטופל את הקלט
  if [ -d "fabric" ] && [ -x "fabric/process.sh" ]; then
    echo "$(cat "$input" | ./fabric/process.sh)"
  else
    echo "SKIP: fabric/ not available or process.sh missing" >&2
    return 1
  fi
}

compare_outputs() {
  local input="$1"
  local core_out="$2"
  local fabric_out="$3"
  local status="PASS"
  
  # אם אחד מהם כשל — כשלון
  if [ "$core_out" = "SKIP" ] || [ "$fabric_out" = "SKIP" ]; then
    status="SKIP (missing component)"
  elif [ "$core_out" != "$fabric_out" ]; then
    status="FAIL"
  fi
  echo "$status|$core_out|$fabric_out"
}

# --- 3. הרצה והשוואה ---
HTML_REPORT="/tmp/saos_engine_comparison_$(date +%s).html"

cat > "$HTML_REPORT" << 'HTML_HEADER'
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>SAOS Engine Comparison Report</title>
  <style>
    body { font-family: var(--font-jbmono), monospace; background: var(--canvas); color: var(--text-1); }
    .pass { color: var(--green); }
    .fail { color: var(--red); }
    .skip { color: var(--amber); }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 8px; border: 1px solid var(--line); text-align: left; }
    th { background: var(--card); }
  </style>
</head>
<body>
  <h1>SAOS Engine Consistency Report</h1>
  <table>
    <thead>
      <tr><th>Input</th><th>Status</th><th>Core Output</th><th>Fabric Output</th></tr>
    </thead>
    <tbody>
HTML_HEADER

for input in "${TEST_INPUTS[@]}"; do
  core_out=$(run_core "$input" 2>/dev/null || echo "SKIP")
  fabric_out=$(run_fabric "$input" 2>/dev/null || echo "SKIP")
  result=$(compare_outputs "$input" "$core_out" "$fabric_out")
  
  status=$(echo "$result" | cut -d'|' -f1)
  core_val=$(echo "$result" | cut -d'|' -f2)
  fabric_val=$(echo "$result" | cut -d'|' -f3)
  
  case "$status" in
    PASS) cls="pass" ;;
    FAIL) cls="fail" ;;
    *) cls="skip" ;;
  esac
  
  cat >> "$HTML_REPORT" << EOF
    <tr class="$cls"><td>$input</td><td>$status</td><td>$core_val</td><td>$fabric_val</td></tr>
EOF
done

cat >> "$HTML_REPORT" << 'HTML_FOOTER'
    </tbody>
  </table>
  <h2>Summary</h2>
  <p>Report generated: $(date)</p>
</body>
</html>
HTML_FOOTER

echo "Report written to $HTML_REPORT"
