# 2D Infinite Canvas Viewport Feature

## Overview

This document specifies a Miro/Figma-like infinite canvas viewport for the Query Plan Visualizer. The viewport enables smooth pan and zoom navigation of query execution plan graphs.

---

## 1. Camera Model

### State Structure

```javascript
// Camera state - represents the viewport's view into world space
let camera = {
  x: 0,      // World X coordinate at viewport top-left
  y: 0,      // World Y coordinate at viewport top-left
  zoom: 1    // Scale factor (1.0 = 100%)
};

// Constants
const MIN_ZOOM = 0.1;   // 10%
const MAX_ZOOM = 6;     // 600%
const ZOOM_STEP = 1.1;  // 10% increment for buttons/keyboard

// Interaction state - tracks user input
let viewportState = {
  isPanning: false,
  isSpacePressed: false,
  startX: 0,              // Screen X where drag started
  startY: 0,              // Screen Y where drag started
  startCameraX: 0,        // Camera X when drag started
  startCameraY: 0,        // Camera Y when drag started
  pointerId: null         // Active pointer ID for capture
};

// Content bounds - updated when graph renders
let currentContentSize = {
  width: 0,
  height: 0
};
```

---

## 2. Coordinate Systems

### Three Spaces

1. **Screen Space**: Browser window coordinates (`event.clientX`, `event.clientY`)
2. **Viewport Space**: Relative to canvas element top-left
3. **World Space**: The infinite canvas where graph nodes live

### Transformation Functions

```javascript
/**
 * Convert screen coordinates to world coordinates
 */
function screenToWorld(screenX, screenY) {
  const rect = planCanvas.getBoundingClientRect();
  const viewportX = screenX - rect.left;
  const viewportY = screenY - rect.top;
  return {
    x: camera.x + viewportX / camera.zoom,
    y: camera.y + viewportY / camera.zoom
  };
}

/**
 * Convert world coordinates to screen coordinates
 */
function worldToScreen(worldX, worldY) {
  const rect = planCanvas.getBoundingClientRect();
  return {
    x: (worldX - camera.x) * camera.zoom + rect.left,
    y: (worldY - camera.y) * camera.zoom + rect.top
  };
}
```

---

## 3. CSS Transform

### The Formula

```javascript
function updateTransform(smooth = false) {
  const zoomContainer = planCanvas.querySelector('.zoom-container');

  // Optional smooth animation for button/keyboard zoom
  if (smooth) {
    zoomContainer.classList.add('smooth-transform');
    setTimeout(() => zoomContainer.classList.remove('smooth-transform'), 300);
  } else {
    zoomContainer.classList.remove('smooth-transform');
  }

  // Apply transform
  zoomContainer.style.transform =
    `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})`;
  zoomContainer.style.transformOrigin = '0 0';
}
```

### Required CSS

```css
.zoom-container {
  position: relative;
  transform-origin: 0 0;
}

.zoom-container.smooth-transform {
  transition: transform 300ms ease-out;
}
```

### Why This Works

- `transform-origin: 0 0` means scale pivots at top-left
- Translation is pre-multiplied by zoom to account for scaled coordinate space
- Order: translate first, then scale

---

## 4. User Interactions

### 4.1 Mouse Wheel: Zoom to Cursor

**Behavior**: Zoom in/out centered on cursor position. Point under cursor stays fixed.

**Sensitivity**: 1% per tick (0.99/1.01 multiplier) for smooth trackpad scrolling.

```javascript
planCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  e.stopPropagation();

  const rect = planCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;  // Viewport X
  const mouseY = e.clientY - rect.top;   // Viewport Y

  // Get world position BEFORE zoom
  const worldX = camera.x + mouseX / camera.zoom;
  const worldY = camera.y + mouseY / camera.zoom;

  // Apply zoom
  const zoomDelta = e.deltaY > 0 ? 0.99 : 1.01;
  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * zoomDelta));

  // Adjust camera so world point stays under cursor
  camera.x = worldX - mouseX / camera.zoom;
  camera.y = worldY - mouseY / camera.zoom;

  clampCameraToBounds();
  updateTransform();
}, { passive: false });
```

### 4.2 Space + Left Mouse Drag: Pan Mode

**Behavior**: Hold Space to enter pan mode, then drag with left mouse.

```javascript
// Keyboard handlers
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !viewportState.isSpacePressed) {
    e.preventDefault();
    viewportState.isSpacePressed = true;
    planCanvas.style.cursor = 'grab';
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    viewportState.isSpacePressed = false;
    if (!viewportState.isPanning) {
      planCanvas.style.cursor = 'default';
    }
  }
});
```

### 4.3 Right Mouse Drag: Direct Pan

**Behavior**: Right-click and drag to pan immediately.

```javascript
// Disable context menu
planCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Start pan on right-click or space+left-click
planCanvas.addEventListener('pointerdown', (e) => {
  const shouldPan = (e.button === 0 && viewportState.isSpacePressed) || e.button === 2;

  if (shouldPan) {
    e.preventDefault();
    viewportState.isPanning = true;
    viewportState.pointerId = e.pointerId;
    viewportState.startX = e.clientX;
    viewportState.startY = e.clientY;
    viewportState.startCameraX = camera.x;
    viewportState.startCameraY = camera.y;

    planCanvas.style.cursor = 'grabbing';
    planCanvas.setPointerCapture(e.pointerId);  // Track mouse outside canvas
  }
});
```

### 4.4 Pan Movement

```javascript
planCanvas.addEventListener('pointermove', (e) => {
  if (viewportState.isPanning && e.pointerId === viewportState.pointerId) {
    const dx = e.clientX - viewportState.startX;
    const dy = e.clientY - viewportState.startY;

    // Move camera opposite to drag direction, scaled by zoom
    camera.x = viewportState.startCameraX - dx / camera.zoom;
    camera.y = viewportState.startCameraY - dy / camera.zoom;

    clampCameraToBounds();
    updateTransform();
  }
});

planCanvas.addEventListener('pointerup', (e) => {
  if (viewportState.isPanning && e.pointerId === viewportState.pointerId) {
    viewportState.isPanning = false;
    viewportState.pointerId = null;
    planCanvas.style.cursor = viewportState.isSpacePressed ? 'grab' : 'default';
    planCanvas.releasePointerCapture(e.pointerId);
  }
});
```

### 4.5 Double-Click: Fit to View

```javascript
planCanvas.addEventListener('dblclick', () => fitToView());
```

### 4.6 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `+` or `=` | Zoom in 10% (smooth) |
| `-` or `_` | Zoom out 10% (smooth) |
| `0` or `F` | Fit to view |
| `Home` | Jump to graph origin |
| Arrow keys | Pan viewport 80px |
| `Space` + drag | Pan mode |

```javascript
window.addEventListener('keydown', (e) => {
  const PAN_STEP = 80;

  switch(e.key) {
    case '+':
    case '=':
      e.preventDefault();
      zoomToCenter(ZOOM_STEP, true);  // smooth = true
      break;
    case '-':
    case '_':
      e.preventDefault();
      zoomToCenter(1 / ZOOM_STEP, true);
      break;
    case '0':
    case 'f':
    case 'F':
      e.preventDefault();
      fitToView();
      break;
    case 'Home':
      e.preventDefault();
      camera.x = 0;
      camera.y = 0;
      clampCameraToBounds();
      updateTransform(true);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      panBy(PAN_STEP, 0);
      break;
    case 'ArrowRight':
      e.preventDefault();
      panBy(-PAN_STEP, 0);
      break;
    case 'ArrowUp':
      e.preventDefault();
      panBy(0, PAN_STEP);
      break;
    case 'ArrowDown':
      e.preventDefault();
      panBy(0, -PAN_STEP);
      break;
  }
});
```

---

## 5. Core Functions

### 5.1 Fit to View

Centers and scales content to fit the viewport.

```javascript
function fitToView(smooth = true) {
  const containerRect = planCanvas.getBoundingClientRect();
  const contentWidth = currentContentSize.width;
  const contentHeight = currentContentSize.height;

  if (contentWidth === 0 || contentHeight === 0) return;

  // Calculate scale to fit with padding
  const padding = 40;
  const scaleX = (containerRect.width - padding * 2) / contentWidth;
  const scaleY = (containerRect.height - padding * 2) / contentHeight;
  const scale = Math.min(scaleX, scaleY, 1);  // Don't zoom beyond 100%

  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));

  // Center content
  camera.x = -(containerRect.width / camera.zoom - contentWidth) / 2;
  camera.y = -(containerRect.height / camera.zoom - contentHeight) / 2;

  updateTransform(smooth);
}
```

### 5.2 Zoom to Center

For button/keyboard zoom (not cursor-relative).

```javascript
function zoomToCenter(zoomDelta, smooth = true) {
  const rect = planCanvas.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  // Get world position at center before zoom
  const worldX = camera.x + centerX / camera.zoom;
  const worldY = camera.y + centerY / camera.zoom;

  // Apply zoom
  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * zoomDelta));

  // Keep center point fixed
  camera.x = worldX - centerX / camera.zoom;
  camera.y = worldY - centerY / camera.zoom;

  clampCameraToBounds();
  updateTransform(smooth);
}
```

### 5.3 Pan By Delta

```javascript
function panBy(dx, dy, smooth = false) {
  camera.x -= dx / camera.zoom;
  camera.y -= dy / camera.zoom;
  clampCameraToBounds();
  updateTransform(smooth);
}
```

### 5.4 Clamp Camera to Bounds

Prevents panning infinitely far from content.

```javascript
function clampCameraToBounds() {
  if (currentContentSize.width === 0 || currentContentSize.height === 0) return;

  const rect = planCanvas.getBoundingClientRect();
  const viewportWidth = rect.width / camera.zoom;
  const viewportHeight = rect.height / camera.zoom;
  const contentWidth = currentContentSize.width;
  const contentHeight = currentContentSize.height;

  // Allow centering when viewport > content
  const marginX = Math.max(0, (viewportWidth - contentWidth) / 2);
  const marginY = Math.max(0, (viewportHeight - contentHeight) / 2);

  // Allow 50% overscroll beyond content
  const overscroll = 0.5;
  const minX = -contentWidth * overscroll - marginX;
  const maxX = contentWidth * (1 + overscroll) - viewportWidth + marginX;
  const minY = -contentHeight * overscroll - marginY;
  const maxY = contentHeight * (1 + overscroll) - viewportHeight + marginY;

  if (maxX > minX) camera.x = Math.max(minX, Math.min(maxX, camera.x));
  if (maxY > minY) camera.y = Math.max(minY, Math.min(maxY, camera.y));
}
```

---

## 6. UI Components

### 6.1 Floating Toolbar (Bottom-Right)

```html
<div class="canvas-toolbar">
  <button id="viewportZoomIn" data-tooltip="Zoom In (+)">
    <svg><!-- Plus icon --></svg>
  </button>
  <button id="viewportZoomOut" data-tooltip="Zoom Out (-)">
    <svg><!-- Minus icon --></svg>
  </button>
  <button id="viewportReset" data-tooltip="Fit to View (0)">
    <svg><!-- Fit icon --></svg>
  </button>
</div>
```

```css
.canvas-toolbar {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  gap: 4px;
  background: rgba(22, 27, 34, 0.95);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  z-index: 300;
}

.canvas-toolbar button {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

.canvas-toolbar button:hover {
  background: var(--bg-tertiary);
  color: var(--accent);
}
```

### 6.2 Zoom Indicator

Shows current zoom level, auto-hides after 1.5s.

```html
<div class="zoom-indicator">100%</div>
```

```css
.zoom-indicator {
  position: absolute;
  bottom: 70px;
  right: 16px;
  background: rgba(22, 27, 34, 0.95);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0;
  transition: opacity 0.3s;
  z-index: 300;
}

.zoom-indicator.visible { opacity: 1; }
.zoom-indicator.at-100 { color: var(--accent); border-color: var(--accent); }
.zoom-indicator.at-limit { color: var(--warning); border-color: var(--warning); }
```

```javascript
function updateZoomIndicator() {
  const indicator = document.querySelector('.zoom-indicator');
  const percent = Math.round(camera.zoom * 100);
  indicator.textContent = `${percent}%`;

  indicator.classList.remove('at-100', 'at-limit');
  if (Math.abs(camera.zoom - 1) < 0.01) indicator.classList.add('at-100');
  else if (camera.zoom <= MIN_ZOOM || camera.zoom >= MAX_ZOOM) indicator.classList.add('at-limit');

  indicator.classList.add('visible');
  clearTimeout(indicatorTimeout);
  indicatorTimeout = setTimeout(() => indicator.classList.remove('visible'), 1500);
}
```

### 6.3 Minimap (Bottom-Left)

Overview of entire graph with viewport rectangle.

```html
<div class="viewport-minimap">
  <div class="minimap-content">
    <div class="minimap-nodes"><!-- Simplified node dots --></div>
    <div class="minimap-viewport"></div>
  </div>
</div>
```

```css
.viewport-minimap {
  position: absolute;
  bottom: 70px;
  left: 16px;
  width: 180px;
  height: 120px;
  background: rgba(22, 27, 34, 0.95);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  z-index: 300;
  cursor: pointer;
}

.minimap-viewport {
  position: absolute;
  border: 2px solid var(--accent);
  background: rgba(0, 212, 170, 0.1);
  border-radius: 2px;
}

.minimap-node {
  position: absolute;
  border-radius: 2px;
}
.minimap-node.scan { background: var(--warning); }
.minimap-node.join { background: var(--danger); }
.minimap-node.exchange { background: #58a6ff; }
```

**Click-to-Navigate**:

```javascript
minimap.addEventListener('click', (e) => {
  const minimapRect = minimap.getBoundingClientRect();
  const canvasRect = planCanvas.getBoundingClientRect();

  // Calculate minimap scale
  const scale = Math.min(
    (minimapRect.width - 16) / currentContentSize.width,
    (minimapRect.height - 16) / currentContentSize.height
  );

  // Click position to world coordinates
  const clickX = (e.clientX - minimapRect.left - 8) / scale;
  const clickY = (e.clientY - minimapRect.top - 8) / scale;

  // Center camera on clicked point
  camera.x = clickX - (canvasRect.width / camera.zoom) / 2;
  camera.y = clickY - (canvasRect.height / camera.zoom) / 2;

  clampCameraToBounds();
  updateTransform(true);
});
```

---

## 7. DOM Structure

### Positioning Hierarchy

```
.plan-container (position: relative, overflow: visible)
├── .plan-header
├── .plan-canvas (position: static, overflow: hidden)
│   └── .zoom-container (CSS transform applied here)
│       ├── <svg> (edges)
│       └── <div> (nodes)
├── .zoom-indicator (position: absolute)
├── .canvas-toolbar (position: absolute)
└── .viewport-minimap (position: absolute)
```

**Critical**: UI overlays (toolbar, minimap, zoom indicator) must be children of `.plan-container`, NOT `.plan-canvas`. This ensures they are not clipped by `overflow: hidden`.

---

## 8. State Preservation

### When Nodes Expand/Collapse

Camera position must be preserved when the graph re-renders.

```javascript
function recalculateLayout() {
  // Save camera before re-render
  const previousCamera = { ...camera };
  const wasInitialized = !!planCanvas._viewportCleanup;

  // Re-render graph
  renderTreeWithSVG(layout, graph);

  // Restore camera after re-render
  if (wasInitialized) {
    camera = previousCamera;
    setupViewport();  // Re-attach event listeners (DOM was replaced)
    updateTransform();
  } else {
    setupViewport();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitToView());
    });
  }
}
```

### Cleanup on Reset

```javascript
function cleanupViewport() {
  if (planCanvas._viewportCleanup) {
    planCanvas._viewportCleanup();
    delete planCanvas._viewportCleanup;
  }
  viewportState.isPanning = false;
  viewportState.isSpacePressed = false;
  viewportState.pointerId = null;
}
```

---

## 9. Edge Rendering Coordinates

### Important: No SVG Transform

Edges must use the same coordinate system as nodes. Do NOT use `<g transform="translate(...)">` on the SVG.

```javascript
// Node position (CSS)
nodeElement.style.left = `${pos.x + PADDING}px`;
nodeElement.style.top = `${pos.y + PADDING}px`;

// Edge position (SVG path) - SAME coordinate system
const x1 = fromPos.x + fromWidth / 2 + PADDING;
const y1 = fromPos.y + fromHeight + PADDING;
const x2 = toPos.x + toWidth / 2 + PADDING;
const y2 = toPos.y + PADDING;

edgePath = `M ${x1} ${y1} ... ${x2} ${y2}`;
```

---

## 10. Performance Notes

### Current Approach (Sufficient for <100 Nodes)

- Full DOM re-render on layout change
- CSS transforms for pan/zoom (GPU accelerated)
- No virtualization needed

### Future Optimization (If Needed for 100+ Nodes)

1. **Viewport culling**: Only render visible nodes
2. **Incremental updates**: Update only changed nodes on expand/collapse
3. **CSS containment**: Add `contain: layout style` to nodes

---

## 11. Browser Compatibility

| Feature | Required |
|---------|----------|
| Pointer Events | Chrome 55+, Firefox 59+, Safari 13+ |
| CSS Transform | All modern browsers |
| Wheel event (passive: false) | All modern browsers |
| setPointerCapture | All modern browsers |

---

## 12. Checklist for Implementation

- [ ] Camera state variables (camera, viewportState, currentContentSize)
- [ ] Transform functions (screenToWorld, updateTransform)
- [ ] Wheel zoom with cursor anchoring
- [ ] Space + drag pan mode
- [ ] Right-click drag pan
- [ ] Keyboard shortcuts (+/-/0/F/arrows/Home)
- [ ] Double-click fit to view
- [ ] Bounds clamping (clampCameraToBounds)
- [ ] Smooth animations (CSS transition class)
- [ ] Floating toolbar with buttons
- [ ] Zoom indicator with auto-hide
- [ ] Minimap with click-to-navigate
- [ ] Camera preservation on re-render
- [ ] Cleanup on reset
- [ ] UI elements positioned on plan-container (not plan-canvas)
