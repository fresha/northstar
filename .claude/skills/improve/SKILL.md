---
name: improve
description: Suggest and implement quality of life improvements for a specific tab or feature in NorthStar. Use when you want to enhance usability, add features, or polish the UI.
allowed-tools: Read, Grep, Glob, Edit, Write
---

# Improve NorthStar Feature

Analyze and improve `$ARGUMENTS` (a tab name like "scan", "join", "overview", "plan", "raw", "compare", or a specific feature).

## Process

### 1. Understand Current State
- Read the relevant parser and render files
- Identify current functionality and UI elements
- Note any existing patterns or conventions

### 2. Identify Improvement Opportunities

#### UX Improvements
- [ ] Row highlighting for problematic values (skew >10x, zero pushdown, high spill)
- [ ] Filter/search functionality
- [ ] Column visibility toggles
- [ ] Export to CSV
- [ ] Keyboard shortcuts
- [ ] Better loading states
- [ ] Empty state messaging

#### Visual Improvements
- [ ] Color coding for severity levels
- [ ] Progress bars or sparklines for metrics
- [ ] Hover states with more detail
- [ ] Responsive design fixes
- [ ] Consistent spacing and alignment

#### Functional Improvements
- [ ] New computed columns (ratios, percentages, deltas)
- [ ] Sorting enhancements
- [ ] Click-to-navigate between tabs
- [ ] Tooltips with explanations
- [ ] Bookmarking/saving state

### 3. Propose Improvements
Present a prioritized list of improvements:
- **Quick wins**: Can be done in <30 lines of code
- **Medium effort**: Require new functions or CSS
- **Larger features**: Need new files or significant refactoring

For each improvement, explain:
- What it does
- Why it's valuable
- How to implement it (brief technical approach)

### 4. Implement (if requested)
When implementing:
- Follow existing code patterns
- Use existing utilities from `utils.js`
- Match existing CSS variable usage from `styles.css`
- Keep changes focused and minimal
- Test with existing test profiles

## Tab-Specific Guidance

### Scan Tab (`js/scanRender.js`)
- METRICS_CONFIG defines all columns
- Types: string, predicate, time, timeWithScanPct, bytes, rows, number, skew
- Group headers use headerClass for coloring
- Sorting in sortTable(), rendering in renderTableBody()

### Join Tab (`js/joinRender.js`)
- JOIN_METRICS_CONFIG defines columns
- Three groups: Summary, Probe Side, Build Side
- Similar patterns to scan tab

### Overview Tab (`js/overviewRender.js`)
- Pipeline timeline visualization
- Fragment breakdown
- Quick stats cards

### Query Plan Tab (`js/visualizer.js`)
- Canvas-based pan/zoom
- Node rendering with expandable metrics
- Edge labels for row counts
- Minimap navigation

### Raw JSON Tab (`js/rawJson.js`)
- Collapsible tree view
- Search with highlighting
- Navigation between matches

### Compare Tab (`js/compare.js`)
- Side-by-side profile loading
- Delta calculations
- Improvement/regression indicators

## Implementation Patterns

### Adding a filter/search:
```javascript
// Add input to HTML or create dynamically
// Filter currentData array based on input
// Re-render table body
```

### Adding row highlighting:
```javascript
// In renderTableBody, check conditions
// Add CSS class like 'row-warning' or 'row-danger'
// Define styles in styles.css
```

### Adding export to CSV:
```javascript
// Map METRICS_CONFIG to headers
// Map currentData to rows
// Create blob and trigger download
```

### Adding keyboard shortcuts:
```javascript
// Add event listener on document
// Check key combinations
// Trigger appropriate actions
```
