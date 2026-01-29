# NorthStar

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A client-side web application for analyzing StarRocks query profiles. Upload JSON query profile exports and get visual analysis of scan operators, join operators, and query execution plans.

**[Live Demo](https://gomezgoes-con.github.io/northstar/)**

## Features

### Overview
Get a high-level view of query performance:
- Query summary with duration, fragments, and state
- Pipeline timeline visualization showing execution flow
- Quick stats for identifying bottlenecks at a glance

### Scan Summary
Analyze CONNECTOR_SCAN operators with detailed metrics organized into logical groups:
- **Output**: Pull rows, bytes read
- **Operator Time**: Total time with skew detection (max/min ratio across tablets)
- **Scan Time**: Hierarchical breakdown with IO Wait/IO Exec percentages
- **Index Filters**: Zone map, bloom filter, short key, and delete vector filtering
- **Predicate Filters**: Raw rows, predicate filter effectiveness, pushdown count
- **Runtime Filters**: Join-pushed filter effectiveness
- **Storage**: Tablet, rowset, and segment counts for fragmentation analysis

Color-coded group headers and sortable columns with sticky table name.

### Join Summary
Analyze HASH_JOIN operators with metrics organized into logical groups:
- **Summary**: Plan node ID, join type, distribution mode, total time, predicates
- **Probe Side** (cyan): Pull/push rows, output bytes, operator time with %, hash table search time, conjunct evaluation time
- **Build Side** (orange): Push/input rows, hash table memory, peak revocable memory, operator time with %, build time, rows spilled

Color-coded group headers and sortable columns for easy analysis.

### Query Plan
Visualize the query execution plan:
- Interactive tree view with pan and zoom
- Expandable nodes with detailed metrics
- Color-coded operator types (scan, join, exchange, aggregate, etc.)
- Row count labels on edges
- Minimap for navigation
- Click node IDs in tables to navigate directly to nodes

### Raw JSON
View and search the raw query profile:
- Collapsible JSON tree viewer
- Searchable with highlighting
- Keyboard navigation (Enter/Shift+Enter)
- Copy to clipboard

### Query Comparison
Compare two query profiles side-by-side:
- Memory usage comparison
- Time improvement analysis
- Scan and join metrics deltas
- Visual indicators for improvements/regressions

### Additional Features
- **Dark/Light Theme**: Toggle between themes with the Nord color palette
- **URL Sharing**: Share query profiles via GitHub Gist or dpaste links
- **Global Query Loading**: Load once, analyze across all tabs
- **Node Navigation**: Click node IDs in scan/join tables to jump to Query Plan

## Usage

1. Open the application in a web browser
2. Click "Load Query" or drag and drop a StarRocks query profile JSON
3. Switch between tabs to analyze different aspects
4. Use the theme toggle (sun/moon icon) to switch between dark and light mode
5. Click "Share" to generate a shareable link

## Tech Stack

- **Vanilla JavaScript** (ES6 modules)
- **HTML5** / **CSS3**
- **Nord Theme** color palette
- No build tools or external dependencies

## Project Structure

```
northstar/
├── index.html            # Single HTML file with all tab structures
├── css/
│   └── styles.css        # Nord theme, CSS variables, components
├── js/
│   ├── main.js           # Entry point, tab navigation, file loading
│   ├── utils.js          # Shared utilities (parsing, formatting)
│   ├── overviewParser.js # Query overview and pipeline analysis
│   ├── overviewRender.js # Overview tab rendering
│   ├── scanParser.js     # CONNECTOR_SCAN operator parsing
│   ├── scanRender.js     # Scan Summary tab rendering
│   ├── joinParser.js     # HASH_JOIN operator parsing
│   ├── joinRender.js     # Join Summary tab rendering
│   ├── visualizer.js     # Query Plan tree visualization
│   ├── compare.js        # Query Comparison tab
│   ├── rawJson.js        # Raw JSON viewer with search
│   ├── nodePopup.js      # Node ID click-to-navigate popup
│   ├── theme.js          # Dark/light theme management
│   ├── queryState.js     # Global query state management
│   ├── urlLoader.js      # URL sharing (Gist, dpaste)
│   └── analytics.js      # Privacy-respecting analytics
└── test_profiles/        # Sample query profile JSON files
```

## Local Development

Simply open `index.html` in a web browser. No build step required.

For local development with a server:
```bash
python -m http.server 8000
# Then open http://localhost:8000
```

## License

MIT
