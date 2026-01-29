/**
 * Digu Game - UI Renderer Module
 * Uses MutationObserver to apply styles to dynamically added cards
 * Updated for full viewport layout (no game container)
 */

(function() {
    'use strict';

    // Wait for DOM to be ready
    document.addEventListener('DOMContentLoaded', function() {
        initDiguRenderer();
    });

    function initDiguRenderer() {
        // Set up MutationObserver to watch for cards being added
        setupCardObserver();

        // Also apply styles to any existing cards
        applyStylesToAllCards();

        // Set up container styles for full viewport layout
        setupContainerStyles();

        // Set up game board for full viewport
        setupGameBoard();
    }

    function setupGameBoard() {
        const gameBoard = document.getElementById('digu-game-board');
        if (gameBoard) {
            // Ensure game board fills viewport
            gameBoard.style.position = 'fixed';
            gameBoard.style.top = '0';
            gameBoard.style.left = '0';
            gameBoard.style.width = '100vw';
            gameBoard.style.height = '100vh';
            gameBoard.style.display = 'flex';
            gameBoard.style.flexDirection = 'column';
            gameBoard.style.overflow = 'hidden';
        }

        // Ensure main content row (h-90) takes proper height
        const mainRow = document.querySelector('#digu-game-board > .row.h-90');
        if (mainRow) {
            mainRow.style.height = '90%';
            mainRow.style.flex = '1 1 auto';
        }

        // Ensure placeholder rows (h-5) have proper height
        const placeholderRows = document.querySelectorAll('#digu-game-board > .row.h-5');
        placeholderRows.forEach(function(row) {
            row.style.height = '5%';
            row.style.minHeight = '20px';
            row.style.flex = '0 0 auto';
        });

        // Ensure main content column has full height
        const mainCol = document.querySelector('#digu-game-board > .row.h-90 > .col');
        if (mainCol) {
            mainCol.style.height = '100%';
            mainCol.style.display = 'flex';
            mainCol.style.flexDirection = 'column';
        }

        // Set up nested row heights within main content column
        const nestedRows = document.querySelectorAll('#digu-game-board > .row.h-90 > .col > .row');
        nestedRows.forEach(function(row, index) {
            if (index === 0) {
                row.style.height = '15%';
            } else if (index === 1) {
                row.style.height = '55%';
            } else if (index === 2) {
                row.style.height = '30%';
            }
            row.style.flexShrink = '0';
        });

        // Ensure side columns (col-2) have full height
        const sideColumns = document.querySelectorAll('#digu-game-board .col-2');
        sideColumns.forEach(function(col) {
            col.style.height = '100%';
        });

        // Ensure nested rows within side columns have full height
        const sideNestedRows = document.querySelectorAll('#digu-game-board .col-2 > .row');
        sideNestedRows.forEach(function(row) {
            row.style.height = '100%';
        });
    }

    function setupContainerStyles() {
        // Ensure player hand container has proper styling
        const handEl = document.querySelector('.digu-player.bottom .digu-player-hand');
        if (handEl) {
            handEl.style.display = 'flex';
            handEl.style.alignItems = 'center';
            handEl.style.justifyContent = 'center';
            handEl.style.flexWrap = 'nowrap';
            handEl.style.overflow = 'visible';
            handEl.style.minHeight = '100px';
            handEl.style.width = '100%';
            handEl.style.height = '100%';
            handEl.style.position = 'relative';
            handEl.style.zIndex = '100';
        }

        // Ensure player container allows overflow and fills space
        const playerEl = document.getElementById('digu-player-0');
        if (playerEl) {
            playerEl.style.position = 'relative';
            playerEl.style.zIndex = '50';
            playerEl.style.overflow = 'visible';
            playerEl.style.width = '100%';
            playerEl.style.height = '100%';
            playerEl.style.display = 'flex';
            playerEl.style.alignItems = 'center';
            playerEl.style.justifyContent = 'center';
        }

        // Ensure the column containing player 0 has full height
        const playerCol = document.querySelector('#digu-game-board .row:last-of-type .col.h-100, #digu-game-board .row:last-of-type .col');
        if (playerCol && playerCol.contains(playerEl)) {
            playerCol.style.height = '100%';
        }

        // Ensure Row 3 (player hand row) is properly sized
        const row3 = document.querySelector('#digu-game-board > .row.h-90 > .col > .row:last-of-type');
        if (row3) {
            row3.style.overflow = 'visible';
            row3.style.zIndex = '50';
            row3.style.minHeight = '100px';
        }
    }

    function setupCardObserver() {
        // Watch the player hand container for card additions
        const handEl = document.querySelector('.digu-player.bottom .digu-player-hand');

        if (!handEl) {
            // If not found yet, retry after a short delay
            setTimeout(setupCardObserver, 100);
            return;
        }

        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    // Apply styles to newly added cards
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.classList && node.classList.contains('card')) {
                                applyCardStyles(node);
                            }
                            // Also check for cards within added nodes
                            const cards = node.querySelectorAll ? node.querySelectorAll('.card') : [];
                            cards.forEach(applyCardStyles);
                        }
                    });

                    // Re-apply margin-left based on current order
                    updateCardMargins();
                }
            });
        });

        observer.observe(handEl, {
            childList: true,
            subtree: true
        });

        // Also watch the game board for when the hand container is replaced
        const gameBoard = document.getElementById('digu-game-board');
        if (gameBoard) {
            const boardObserver = new MutationObserver(function(mutations) {
                // Check if we need to reattach to a new hand container
                const newHandEl = document.querySelector('.digu-player.bottom .digu-player-hand');
                if (newHandEl && newHandEl !== handEl) {
                    setupContainerStyles();
                    setupGameBoard();
                    applyStylesToAllCards();
                }
            });

            boardObserver.observe(gameBoard, {
                childList: true,
                subtree: true
            });
        }
    }

    function applyStylesToAllCards() {
        const handEl = document.querySelector('.digu-player.bottom .digu-player-hand');
        if (handEl) {
            const cards = handEl.querySelectorAll('.card');
            cards.forEach(function(card, index) {
                applyCardStyles(card);
            });
            updateCardMargins();
        }
    }

    function updateCardMargins() {
        const handEl = document.querySelector('.digu-player.bottom .digu-player-hand');
        if (!handEl) return;

        const cards = handEl.querySelectorAll('.card');
        cards.forEach(function(card, index) {
            // Negative margin for card overlap (except first card)
            if (index > 0) {
                card.style.marginLeft = '-20px';
            } else {
                card.style.marginLeft = '0';
            }
        });
    }

    function applyCardStyles(cardEl) {
        if (!cardEl || !cardEl.classList || !cardEl.classList.contains('card')) return;

        // Responsive card sizing using clamp
        cardEl.style.width = 'clamp(45px, 8vw, 80px)';
        cardEl.style.height = 'clamp(63px, 11.2vw, 112px)';
        cardEl.style.cursor = 'pointer';
        cardEl.style.transition = 'transform 0.2s';
        cardEl.style.background = 'white';
        cardEl.style.borderRadius = '6px';
        cardEl.style.border = '1px solid rgba(0,0,0,0.2)';
        cardEl.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
        cardEl.style.position = 'relative';
        cardEl.style.flexShrink = '0';
        cardEl.style.display = 'inline-block';

        // Ensure card image fills the card
        const img = cardEl.querySelector('img');
        if (img) {
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            img.style.display = 'block';
        }
    }

    // Expose functions globally
    window.DiGuRenderer = {
        init: initDiguRenderer,
        applyCardStyles: applyCardStyles,
        applyStylesToAllCards: applyStylesToAllCards,
        setupContainerStyles: setupContainerStyles,
        setupGameBoard: setupGameBoard
    };

    // Re-apply styles when window resizes
    window.addEventListener('resize', function() {
        setupGameBoard();
        setupContainerStyles();
        applyStylesToAllCards();
    });

    // Also re-apply when lobby is hidden (game starts)
    const lobbyObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const target = mutation.target;
                if (target.id === 'lobby-overlay' && target.classList.contains('hidden')) {
                    // Game has started, apply styles after a short delay
                    setTimeout(function() {
                        setupGameBoard();
                        setupContainerStyles();
                        applyStylesToAllCards();
                    }, 100);
                }
            }
        });
    });

    // Start observing lobby when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        const lobby = document.getElementById('lobby-overlay');
        if (lobby) {
            lobbyObserver.observe(lobby, { attributes: true });
        }
    });

})();
