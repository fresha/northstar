---
name: explain
description: Explain how NorthStar works - architecture, data flow, specific features, or code patterns. Use when onboarding, understanding the codebase, or learning how a feature is implemented.
allowed-tools: Read, Grep, Glob
---

# Explain NorthStar Codebase

Explain `$ARGUMENTS` - a feature, component, or concept in the NorthStar codebase.

## Architecture Overview

NorthStar is a **client-side** web application for analyzing StarRocks query profiles.

### Tech Stack
- Vanilla JavaScript (ES6 modules)
- HTML5 / CSS3 with Nord theme
- No build tools or dependencies

### Core Pattern: Parser + Render Separation
Each feature follows this pattern:
- `*Parser.js` - Extract and compute data from JSON
- `*Render.js` - Generate HTML, handle DOM, manage UI state

### Data Flow
```
JSON Profile → Parser → Structured Data → Render → DOM
                ↓
           queryState.js (global state)
```

## Key Files to Reference

| File | Purpose |
|------|---------|
| `js/main.js` | Entry point, tab navigation, file loading |
| `js/utils.js` | Shared utilities (`parseNumericValue`, `formatBytes`, `formatTime`) |
| `js/queryState.js` | Global state management for loaded profiles |
| `js/scanParser.js` | Parse CONNECTOR_SCAN operators from profile |
| `js/scanRender.js` | Render scan table with METRICS_CONFIG |
| `js/joinParser.js` | Parse HASH_JOIN operators |
| `js/joinRender.js` | Render join table with JOIN_METRICS_CONFIG |
| `js/overviewParser.js` | Parse fragments/pipelines for overview |
| `js/overviewRender.js` | Render overview dashboard |
| `js/visualizer.js` | Query plan tree visualization (pan/zoom canvas) |
| `js/compare.js` | Query comparison functionality |
| `js/nodePopup.js` | Click-to-navigate popup for node IDs |
| `css/styles.css` | All styles, CSS variables, Nord theme |

## Explanation Tasks

### If explaining a feature/tab:
1. Identify the relevant parser and render files
2. Explain the data extraction logic (what metrics, how traversed)
3. Explain the rendering logic (table structure, groupings, styling)
4. Show the METRICS_CONFIG or equivalent configuration
5. Describe any special behaviors (sorting, computed values, percentages)

### If explaining a pattern/concept:
1. Find examples of the pattern in the codebase
2. Explain the purpose and benefits
3. Show code snippets illustrating the pattern
4. Explain how to extend or modify it

### If explaining data flow:
1. Trace from JSON input to final UI
2. Show which functions are called in sequence
3. Explain any transformations or computations
4. Identify where state is stored

## Common Topics

### "How does the scan table work?"
- `scanParser.js:findConnectorScans()` - Recursively finds all CONNECTOR_SCAN operators
- `scanRender.js:METRICS_CONFIG` - Defines columns, types, groups, styling
- `scanRender.js:renderTableBody()` - Renders cells based on type (time, bytes, rows, skew)

### "How are percentages calculated?"
- `timeWithScanPct` type in scanRender.js
- Pre-computes `scanTime` for each row, then calculates `(value / scanTime) * 100`

### "How does the skew column work?"
- `computeSkew()` function extracts `__MAX_OF_*` and `__MIN_OF_*` values
- Calculates ratio, formats as "Nx", applies color class based on severity

### "How do color-coded headers work?"
- `headerClass` property in METRICS_CONFIG
- CSS classes like `.output-header`, `.scan-time-header` in styles.css
- Applied during `renderTable()` group header row creation
