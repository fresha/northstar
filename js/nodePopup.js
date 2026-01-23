/**
 * Shared Node Popup - Reusable popup menu for navigating to nodes
 */

/**
 * Setup click handlers for node links in a table body
 * @param {HTMLElement} tbody - The table body element
 * @param {string} operatorType - The operator type ('scan' or 'join')
 */
export function setupNodeLinkHandlers(tbody, operatorType) {
  tbody.querySelectorAll('.node-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      const nodeId = parseInt(link.dataset.nodeId);
      showNodePopup(e, nodeId, operatorType);
    });
  });
}

/**
 * Show popup menu for node navigation
 * @param {Event} event - The click event
 * @param {number} nodeId - The plan_node_id
 * @param {string} operatorType - The operator type ('scan' or 'join')
 */
function showNodePopup(event, nodeId, operatorType) {
  // Remove any existing popup
  hideNodePopup();

  const label = operatorType === 'join' ? 'Join Node' : 'Node';

  const popup = document.createElement('div');
  popup.className = 'node-popup';
  popup.innerHTML = `
    <div class="node-popup-header">${label} ${nodeId}</div>
    <button class="node-popup-btn" data-action="plan">
      <span class="popup-icon">🗺️</span>
      <span>View in Query Plan</span>
    </button>
    <button class="node-popup-btn" data-action="raw">
      <span class="popup-icon">🔍</span>
      <span>Find in Raw JSON</span>
    </button>
  `;

  // Position popup near the click
  popup.style.position = 'fixed';
  popup.style.left = `${event.clientX}px`;
  popup.style.top = `${event.clientY}px`;
  popup.style.zIndex = '1000';

  document.body.appendChild(popup);

  // Adjust position if popup goes off-screen
  const rect = popup.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    popup.style.left = `${window.innerWidth - rect.width - 10}px`;
  }
  if (rect.bottom > window.innerHeight) {
    popup.style.top = `${window.innerHeight - rect.height - 10}px`;
  }

  // Handle button clicks
  popup.querySelectorAll('.node-popup-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      hideNodePopup();

      if (action === 'plan') {
        window.navigateToQueryPlanNode(nodeId);
      } else if (action === 'raw') {
        window.navigateToRawJsonNode(nodeId, operatorType);
      }
    });
  });

  // Close popup on outside click
  setTimeout(() => {
    document.addEventListener('click', hideNodePopupOnOutsideClick);
  }, 10);
}

/**
 * Hide node popup
 */
function hideNodePopup() {
  const existing = document.querySelector('.node-popup');
  if (existing) {
    existing.remove();
  }
  document.removeEventListener('click', hideNodePopupOnOutsideClick);
}

/**
 * Hide popup when clicking outside
 */
function hideNodePopupOnOutsideClick(e) {
  if (!e.target.closest('.node-popup')) {
    hideNodePopup();
  }
}
