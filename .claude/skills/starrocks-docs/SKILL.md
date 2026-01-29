---
name: starrocks-docs
description: Look up StarRocks query profile metrics and tuning documentation. Use when you need to understand what a metric means or how to optimize query performance.
allowed-tools: WebFetch, WebSearch, Read
---

# StarRocks Documentation Lookup

Look up information about `$ARGUMENTS` from StarRocks official documentation.

## Primary Documentation Sources

1. **Query Profile Operator Metrics** (most relevant for metric definitions):
   https://docs.starrocks.io/docs/best_practices/query_tuning/query_profile_operator_metrics

2. **Query Profile Tuning Recipes** (bottleneck patterns and fixes):
   https://docs.starrocks.io/docs/best_practices/query_tuning/query_profile_tuning_recipes/

3. **Query Planning** (optimizer behavior, join strategies, distribution):
   https://docs.starrocks.io/docs/best_practices/query_tuning/query_planning/

## Tasks

### 1. Search Documentation
- For metric definitions: fetch the Query Profile Operator Metrics page first
- For bottleneck patterns: fetch the Query Profile Tuning Recipes page
- For optimizer/planning questions: fetch the Query Planning page
- Use WebSearch for broader StarRocks documentation if needed

### 2. Explain the Metric/Concept
Provide:
- **Definition**: What the metric measures
- **Units**: Time (ns/us/ms/s), bytes, rows, count
- **Location**: CommonMetrics vs UniqueMetrics, which operator types have it
- **Interpretation**: What high/low values indicate

### 3. Performance Context
If relevant, explain:
- **Bottleneck patterns**: What issues this metric can reveal
- **Related metrics**: Other metrics to check alongside
- **Optimization tips**: How to improve if values are problematic

### 4. NorthStar Integration
Check if this metric is already displayed in NorthStar:
- Search `js/scanRender.js` for scan-related metrics
- Search `js/joinRender.js` for join-related metrics
- If not displayed, suggest whether it should be added

## Common Metric Categories

### Scan Operator Metrics
- Time: `ScanTime`, `IOTaskExecTime`, `IOTaskWaitTime`, `SegmentInit`, `SegmentRead`
- Rows: `RawRowsRead`, `RowsRead`, `PullRowNum`, filter metrics (`ZoneMapIndexFilterRows`, etc.)
- I/O: `BytesRead`, `CompressedBytesRead`, `IOTime`

### Join Operator Metrics
- Build: `BuildHashTableTime`, `HashTableMemoryUsage`, `RowsSpilled`
- Probe: `SearchHashTableTime`, `ProbeConjunctEvaluateTime`

### Common Bottleneck Patterns
- Cold storage: High `IOTaskExecTime` + `BytesRead`
- Thread starvation: High `IOTaskWaitTime` + low `PeakIOTasks`
- Data skew: Large gap between `__MAX_OF_*` and `__MIN_OF_*`
- Fragmentation: High `RowsetsReadCount`/`SegmentsReadCount` + long `SegmentInit`
- Missing filter pushdown: `PushdownPredicates` near 0, high `PredFilterRows`
