---
name: analyze-profile
description: Analyze a StarRocks query profile JSON to discover available metrics, identify bottlenecks, and suggest which metrics would be valuable to display.
allowed-tools: Read, Grep, Glob
---

# Analyze StarRocks Query Profile

Analyze the query profile at `$ARGUMENTS` to discover metrics and identify performance characteristics.

## Tasks

### 1. Load and Parse Profile
- Read the JSON file from the provided path (default to `test_profiles/` directory if just a filename)
- Extract the `Query.Execution` structure
- Identify all Fragments, Pipelines, and Operators

### 2. Discover Available Metrics
For each operator type found (CONNECTOR_SCAN, HASH_JOIN_BUILD, HASH_JOIN_PROBE, AGGREGATE, EXCHANGE, etc.):
- List all `CommonMetrics` keys with example values
- List all `UniqueMetrics` keys with example values
- Note any `__MAX_OF_*` and `__MIN_OF_*` variants (useful for skew detection)

### 3. Identify Performance Characteristics
Analyze the profile for:
- **Slowest operators**: Which operators have highest `OperatorTotalTime`?
- **Data volume**: Which scans read the most `BytesRead` or `RawRowsRead`?
- **Join efficiency**: Check `hashTableMemoryUsage`, `rowsSpilled`
- **Filter effectiveness**: Compare `RawRowsRead` vs `RowsRead` for scans
- **Skew indicators**: Large gaps between `__MAX_OF_*` and `__MIN_OF_*` values

### 4. Output Report
Provide a structured report with:
1. **Profile Summary**: Query ID, duration, fragment count, operator count
2. **Operator Inventory**: Table of operator types and their counts
3. **Metric Discovery**: New/interesting metrics not currently displayed in the UI
4. **Bottleneck Analysis**: Top 3 performance concerns with specific values
5. **Recommendations**: Which metrics should be added to scan/join tables

## Reference
- Use `parseNumericValue()` pattern for time strings like "1.592ms"
- Current scan metrics are defined in `js/scanRender.js` METRICS_CONFIG
- Current join metrics are defined in `js/joinRender.js` JOIN_METRICS_CONFIG
