# NorthStar

A client-side web tool for analyzing StarRocks query profiles. Visualizes scan operators, join operators, and query execution plans from JSON profile exports.

## Tech Stack

Vanilla JavaScript (ES6 modules), HTML5, CSS3. No build tools or frameworks.

## Architecture

**Parser + Render separation**: Each feature has `*Parser.js` (extract/compute from JSON) and `*Render.js` (generate HTML, handle DOM). Data flows: JSON → Parser → Render.

Key files:
- `js/utils.js` - Shared utilities (`parseNumericValue`, `formatBytes`, `formatTime`)
- `js/visualizer.js` - Query Plan infinite canvas viewport
- `js/compare.js` - Query comparison (baseline vs optimized)

## Working on This Codebase

- **No npm/build tools** - Keep everything vanilla JS
- **Add to existing files** rather than creating new ones
- **Use `parseNumericValue()`** for all metric parsing (converts StarRocks time strings like `"1.592ms"` to seconds)
- **Test with** `test_profiles/` directory (real StarRocks query profile JSON files)

## Domain Knowledge

StarRocks query profiles have nested structure: `Query.Execution.Fragment N.Pipeline (id=N).OPERATOR (plan_node_id=N)`. Operators have `CommonMetrics` (shared) and `UniqueMetrics` (operator-specific).

For traversal patterns, see `scanParser.js:12` (Fragment/Pipeline iteration) and `joinParser.js:11` (Topology parsing).
