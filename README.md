# NorthStar

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A client-side web application for analyzing StarRocks query profiles. Upload JSON query profile exports and get visual analysis of scan operators, join operators, and query execution plans.

**[Live Demo](https://gomezgoes-con.github.io/northstar/)**

## Features

### Scan Summary
Analyze CONNECTOR_SCAN operators with detailed metrics:
- Memory usage and allocation
- Read throughput and bytes read
- Row counts and timing breakdowns
- Sortable table with all scan operators

### Join Summary
Analyze HASH_JOIN operators including:
- Hash table memory usage
- Build vs probe time breakdown
- Row counts for both sides of joins
- Broadcast join detection

### Query Comparison
Compare two query profiles side-by-side:
- Memory usage comparison
- Time improvement analysis
- Scan metrics deltas
- Join metrics deltas
- Visual indicators for improvements/regressions

### Query Plan
Visualize the query execution plan:
- Tree view of operator hierarchy
- Fragment and pipeline structure
- Interactive plan exploration

## Usage

1. Open the application in a web browser
2. Select a tab based on what you want to analyze
3. Drag and drop a StarRocks query profile JSON file (or click to browse)
4. For Query Comparison, load both a baseline and optimized profile

## Tech Stack

- **Vanilla JavaScript** (ES6 modules)
- **HTML5** / **CSS3**
- No build tools or external dependencies

## Project Structure

```
northstar/
├── index.html          # Single HTML file with all tab structures
├── css/
│   └── styles.css      # All styles (CSS variables, components, tabs)
├── js/
│   ├── main.js         # Entry point, tab navigation, file loading
│   ├── utils.js        # Shared utilities
│   ├── scanParser.js   # CONNECTOR_SCAN operator parsing
│   ├── scanRender.js   # Scan Summary tab rendering
│   ├── joinParser.js   # HASH_JOIN operator parsing
│   ├── joinRender.js   # Join Summary tab rendering
│   ├── visualizer.js   # Query Plan tree visualization
│   └── compare.js      # Query Comparison tab
└── test_profiles/      # Sample query profile JSON files
```

## Local Development

Simply open `index.html` in a web browser. No build step required.

For local development with a server:
```bash
python -m http.server 8000
# Then open http://localhost:8000
```
