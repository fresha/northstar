# NorthStar - Claude Code Context

## Project Overview

NorthStar is a client-side web application for analyzing StarRocks query profiles. It processes JSON query profile exports and provides visual analysis of scan operators, join operators, and query execution plans.

**Tech Stack:** Vanilla JavaScript (ES6 modules), HTML5, CSS3 - No build tools or frameworks.

## Architecture

```
northstar/
├── index.html          # Single HTML file with all tab structures
├── css/
│   └── styles.css      # All styles (CSS variables, components, tabs)
├── js/
│   ├── main.js         # Entry point, tab navigation, file loading
│   ├── utils.js        # Shared utilities (parseNumericValue, formatBytes, formatTime)
│   ├── scanParser.js   # CONNECTOR_SCAN operator parsing
│   ├── scanRender.js   # Scan Summary tab rendering
│   ├── joinParser.js   # HASH_JOIN operator parsing, Topology parsing
│   ├── joinRender.js   # Join Summary tab rendering
│   ├── visualizer.js   # Query Plan tree visualization
│   └── compare.js      # Query Comparison tab (baseline vs optimized)
└── test_profiles/      # Sample StarRocks query profile JSON files
```

## Module Pattern

Each feature follows a **Parser + Render** separation:

| Module | Responsibility |
|--------|----------------|
| `*Parser.js` | Extract data from StarRocks JSON, compute metrics |
| `*Render.js` | Generate HTML, handle DOM updates, sorting |

**Data flow:**
```
JSON → Parser (extract/compute) → Render (display)
```

## Key Data Structures

### StarRocks Query Profile JSON
```javascript
{
  "Query": {
    "Summary": { "Query ID": "...", "Total": "1.5s", ... },
    "Execution": {
      "Topology": "JSON string of node relationships",
      "QueryAllocatedMemoryUsage": "1.23 GB",
      "Fragment 0": {
        "Pipeline (id=1)": {
          "CONNECTOR_SCAN (plan_node_id=0)": {
            "CommonMetrics": { "PullRowNum": "1000", ... },
            "UniqueMetrics": { "BytesRead": "1.5 MB", ... }
          }
        }
      }
    }
  }
}
```

### Traversal Pattern
To iterate through operators:
```javascript
for (const fragKey of Object.keys(execution)) {
  if (!fragKey.startsWith('Fragment ')) continue;
  const fragment = execution[fragKey];

  for (const pipeKey of Object.keys(fragment)) {
    const pipeMatch = pipeKey.match(/Pipeline \(id=(\d+)\)/);
    if (!pipeMatch) continue;
    const pipeline = fragment[pipeKey];

    for (const opKey of Object.keys(pipeline)) {
      const opMatch = opKey.match(/(.+) \(plan_node_id=(-?\d+)\)/);
      if (!opMatch) continue;
      // Process operator...
    }
  }
}
```

## Important Concepts

### Time Values
- StarRocks reports time as strings: `"1.592ms"`, `"26s134ms"`
- `parseNumericValue()` in utils.js converts to **seconds**
- `formatTime()` converts seconds back to human-readable

### Metrics Sources
- **CommonMetrics**: Shared across operator types (PullRowNum, PushRowNum, OperatorTotalTime)
- **UniqueMetrics**: Operator-specific (BytesRead for scans, HashTableMemoryUsage for joins)

### Join Operators
- Each HASH_JOIN has plan_node_id shared by HASH_JOIN_PROBE and HASH_JOIN_BUILD
- Time metrics in joins are **averages per instance**, not total query time
- Topology JSON contains node relationships (children array)

### Broadcast Joins
- EXCHANGE_SINK PushRowNum = rows **before** broadcast
- EXCHANGE_SOURCE PullRowNum = rows **after** broadcast (multiplied)

## Coding Guidelines

### Do
- Use ES6 modules with explicit imports/exports
- Keep parser logic separate from rendering
- Use `parseNumericValue()` for all metric parsing
- Follow existing CSS variable naming (`--bg-primary`, `--accent`, etc.)
- Add to existing files rather than creating new ones when possible

### Don't
- Don't use build tools or npm packages - keep it vanilla JS
- Don't inline styles - use CSS classes
- Don't create unnecessary wrapper functions
- Don't add console.log statements (remove after debugging)

### CSS Conventions
- Use CSS variables from `:root` for colors
- Grid for layouts, flexbox for alignment
- Mobile responsiveness not required (desktop tool)

### HTML Structure
- Each tab is a `.tab-panel` with `id="tab-{name}"`
- Each tab has its own drop zone and dashboard container
- Tables use `thead` with group headers + column headers pattern

## Testing

Load files from `test_profiles/` directory to test changes. Files contain real StarRocks query profile exports.

## Common Tasks

### Adding a new metric to a table
1. Add column config to `*_METRICS_CONFIG` array in `*Render.js`
2. Extract value in `extract*Metrics()` function in `*Parser.js`

### Adding a new comparison metric
1. Add to `loadCompareFile()` data extraction in `compare.js`
2. Add card definition in `renderComparison()`
3. Use `generateCompareCardsHTML()` for computed values

### Adding a new tab
1. Add tab button in `index.html` nav
2. Add `.tab-panel` section in `index.html`
3. Create `*Parser.js` and `*Render.js` modules
4. Wire up in `main.js`
