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

## Test URLs

Start local server: `python -m http.server 8000`

**URL format:**
- Single: `?query={source}:{id}#{tab}`
- Compare: `?query={source}:{id}&optimised={source}:{id}#compare`
- `{source}` = `paste` (dpaste.com) or `gist` (GitHub Gist)
- `{tab}` = `scan`, `join`, `plan`, `raw`, or `compare`

**Single Query:**
- dpaste: `http://localhost:8000/?query=paste:EE8GYXBX3#scan`
- gist: `http://localhost:8000/?query=gist:0c68d2a633e149c05af5d0b66dc8f8c8#scan`

**Comparison (query = baseline, mixed sources supported):**
- `http://localhost:8000/?query=paste:EE8GYXBX3&optimised=paste:5K7A92EJB#compare`

## Domain Knowledge

StarRocks query profiles have nested structure: `Query.Execution.Fragment N.Pipeline (id=N).OPERATOR (plan_node_id=N)`. Operators have `CommonMetrics` (shared) and `UniqueMetrics` (operator-specific).

For traversal patterns, see `scanParser.js:12` (Fragment/Pipeline iteration) and `joinParser.js:11` (Topology parsing).
