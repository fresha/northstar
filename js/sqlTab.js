/**
 * Raw SQL Tab - Extract, format, and syntax-highlight SQL from query profiles
 */

// DOM Elements
const sqlDropZone = document.getElementById('sqlDropZone');
const sqlContainer = document.getElementById('sqlContainer');
const sqlContent = document.getElementById('sqlContent');
const btnCopySql = document.getElementById('btnCopySql');

// State
let rawSql = '';

/**
 * Initialize SQL tab event listeners
 */
export function initSqlTab() {
  // Drop zone click opens Load Query modal
  sqlDropZone.addEventListener('click', () => {
    document.getElementById('sqlFileInput').click();
  });

  // Copy button
  btnCopySql.addEventListener('click', () => {
    if (!rawSql) return;
    navigator.clipboard.writeText(rawSql).then(() => {
      const original = btnCopySql.textContent;
      btnCopySql.textContent = 'Copied!';
      setTimeout(() => { btnCopySql.textContent = original; }, 1500);
    });
  });
}

/**
 * Update SQL tab with query profile data
 */
export function updateSqlTab(json) {
  const sql = json?.Query?.Summary?.['Sql Statement'];
  if (!sql) {
    sqlContainer.style.display = 'none';
    sqlDropZone.style.display = '';
    return;
  }

  rawSql = sql;
  sqlDropZone.style.display = 'none';
  sqlContainer.style.display = '';

  const formatted = formatSql(sql);
  const highlighted = highlightSql(formatted);
  sqlContent.querySelector('code').innerHTML = highlighted;
}

/**
 * Clear SQL tab
 */
export function clearSqlTab() {
  rawSql = '';
  sqlContainer.style.display = 'none';
  sqlDropZone.style.display = '';
  sqlContent.querySelector('code').textContent = '';
}

/**
 * Format SQL with indentation and line breaks
 */
function formatSql(sql) {
  // Normalize whitespace
  let s = sql.replace(/\r\n/g, '\n').replace(/\t/g, '  ');

  // If the SQL already has meaningful newlines (multi-line), respect them
  // but still clean up indentation
  const lines = s.split('\n');
  const hasIntentionalFormatting = lines.length > 3;

  if (hasIntentionalFormatting) {
    // Already formatted — just clean up and normalize indentation
    return cleanupFormatted(s);
  }

  // Single-line SQL — apply formatting
  return autoFormat(s);
}

/**
 * Clean up already-formatted SQL — normalize indentation, trim empty lines
 */
function cleanupFormatted(sql) {
  const lines = sql.split('\n');

  // Find minimum indentation (ignoring empty lines and comment-only lines)
  let minIndent = Infinity;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent < minIndent) minIndent = indent;
  }
  if (minIndent === Infinity) minIndent = 0;

  // Remove common leading whitespace and trim trailing
  return lines
    .map(l => l.slice(minIndent).trimEnd())
    .join('\n')
    .trim();
}

/**
 * Auto-format a single-line SQL statement
 */
function autoFormat(sql) {
  // Normalize whitespace to single spaces
  let s = sql.replace(/\s+/g, ' ').trim();

  // Major clause keywords — always start on new line at base indent
  const majorKeywords = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY',
    'LIMIT', 'OFFSET', 'UNION ALL', 'UNION', 'INTERSECT', 'EXCEPT',
    'INSERT INTO', 'UPDATE', 'DELETE FROM', 'SET', 'VALUES',
    'WITH', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN',
    'FULL JOIN', 'CROSS JOIN', 'JOIN', 'ON', 'LATERAL'
  ];

  // Sort by length descending so longer matches take priority
  const sorted = majorKeywords.sort((a, b) => b.length - a.length);

  for (const kw of sorted) {
    // Case-insensitive replace, add newline before keyword
    const regex = new RegExp(`\\b${kw}\\b`, 'gi');
    s = s.replace(regex, `\n${kw.toUpperCase()}`);
  }

  // Indent sub-clauses (AND, OR)
  s = s.replace(/\b(AND|OR)\b/gi, (m) => `\n  ${m.toUpperCase()}`);

  // Clean up: remove leading newline, collapse multiple newlines
  s = s.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n');

  // Indent continuation lines after SELECT, FROM etc.
  const lines = s.split('\n');
  const result = [];
  let indent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { result.push(''); continue; }

    // Check if this line starts with a major keyword
    const isMajor = sorted.some(kw =>
      trimmed.toUpperCase().startsWith(kw)
    );

    if (isMajor) {
      result.push(trimmed);
    } else {
      result.push('  ' + trimmed);
    }
  }

  return result.join('\n').trim();
}

// SQL keywords for highlighting
const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS',
  'BETWEEN', 'LIKE', 'IS', 'NULL', 'AS', 'ON', 'CASE', 'WHEN',
  'THEN', 'ELSE', 'END', 'GROUP', 'ORDER', 'BY', 'HAVING',
  'LIMIT', 'OFFSET', 'ASC', 'DESC', 'DISTINCT', 'ALL',
  'UNION', 'INTERSECT', 'EXCEPT', 'JOIN', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'FULL', 'CROSS', 'LATERAL', 'WITH',
  'INSERT', 'INTO', 'UPDATE', 'DELETE', 'SET', 'VALUES',
  'CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX',
  'TRUE', 'FALSE', 'INTERVAL', 'DAY', 'YEAR', 'MONTH',
  'CURRENT_DATE', 'CURRENT_TIMESTAMP',
]);

/**
 * Apply syntax highlighting to formatted SQL using a tokenizer approach
 * to avoid regex replacements corrupting previously-inserted HTML tags
 */
function highlightSql(sql) {
  const tokens = tokenizeSql(sql);
  return tokens.map(t => {
    const escaped = t.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    switch (t.type) {
      case 'comment':  return `<span class="sql-comment">${escaped}</span>`;
      case 'string':   return `<span class="sql-string">${escaped}</span>`;
      case 'number':   return `<span class="sql-number">${escaped}</span>`;
      case 'operator': return `<span class="sql-operator">${escaped}</span>`;
      case 'function': return `<span class="sql-function">${escaped}</span>`;
      case 'word':
        if (SQL_KEYWORDS.has(t.text.toUpperCase())) {
          return `<span class="sql-keyword">${escaped}</span>`;
        }
        return escaped;
      default:         return escaped;
    }
  }).join('');
}

/**
 * Tokenize SQL into typed segments
 */
function tokenizeSql(sql) {
  const tokens = [];
  let i = 0;

  while (i < sql.length) {
    // Comment: -- to end of line
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const comment = end === -1 ? sql.slice(i) : sql.slice(i, end);
      tokens.push({ type: 'comment', text: comment });
      i += comment.length;
      continue;
    }

    // String: '...' with escape handling
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      tokens.push({ type: 'string', text: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Number
    if (/\d/.test(sql[i]) && (i === 0 || /[\s,=(+\-*/]/.test(sql[i - 1]))) {
      let j = i;
      while (j < sql.length && /[\d.]/.test(sql[j])) j++;
      // Make sure it's not part of an identifier
      if (j < sql.length && /[a-zA-Z_]/.test(sql[j])) {
        // Part of identifier like "segment_sale_items" — treat as word
      } else {
        tokens.push({ type: 'number', text: sql.slice(i, j) });
        i = j;
        continue;
      }
    }

    // Word (identifier or keyword)
    if (/[a-zA-Z_]/.test(sql[i])) {
      let j = i;
      while (j < sql.length && /[a-zA-Z0-9_.]/.test(sql[j])) j++;
      tokens.push({ type: 'word', text: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Operators
    if ('>=<=!'.includes(sql[i]) && sql[i + 1] === '=') {
      tokens.push({ type: 'operator', text: sql.slice(i, i + 2) });
      i += 2;
      continue;
    }
    if ('><='.includes(sql[i])) {
      tokens.push({ type: 'operator', text: sql[i] });
      i++;
      continue;
    }

    // Whitespace and other characters
    tokens.push({ type: 'other', text: sql[i] });
    i++;
  }

  // Post-process: mark functions (word followed by '(')
  for (let t = 0; t < tokens.length; t++) {
    if (tokens[t].type !== 'word') continue;
    // Look ahead past whitespace for '('
    for (let n = t + 1; n < tokens.length; n++) {
      if (tokens[n].type === 'other' && tokens[n].text.trim() === '') continue;
      if (tokens[n].text === '(') {
        const upper = tokens[t].text.toUpperCase();
        if (!SQL_KEYWORDS.has(upper)) {
          tokens[t].type = 'function';
        }
      }
      break;
    }
  }

  return tokens;
}

