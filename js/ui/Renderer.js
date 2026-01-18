/**
 * Renderer class - Handles all DOM rendering for the game
 */
import { CardSprite } from './CardSprite.js';
import { getSuitSymbol, getSuitDisplay } from '../utils/helpers.js';

export class Renderer {
    constructor() {
        // Cache DOM elements
        this.elements = {
            hands: {
                0: document.getElementById('hand-bottom'),
                1: document.getElementById('hand-left'),
                2: document.getElementById('hand-top'),
                3: document.getElementById('hand-right')
            },
            played: {
                0: document.getElementById('played-bottom'),
                1: document.getElementById('played-left'),
                2: document.getElementById('played-top'),
                3: document.getElementById('played-right')
            },
            scores: {
                team0Tens: document.getElementById('team0-tens'),
                team0Tricks: document.getElementById('team0-tricks'),
                team1Tens: document.getElementById('team1-tens'),
                team1Tricks: document.getElementById('team1-tricks')
            },
            superiorSuit: document.getElementById('superior-suit-display'),
            turnIndicator: document.getElementById('turn-indicator'),
            messageOverlay: document.getElementById('message-overlay'),
            messageTitle: document.getElementById('message-title'),
            messageText: document.getElementById('message-text'),
            messageButton: document.getElementById('message-button')
        };
    }

    /**
     * Render a player's hand
     * @param {Player} player - Player to render
     * @param {Array<Card>} validCards - Cards that can be played (for human)
     * @param {Function} onCardClick - Click handler for cards
     */
    renderHand(player, validCards = [], onCardClick = null, selectedCard = null) {
        const handElement = this.elements.hands[player.position];
        handElement.innerHTML = '';

        const isHuman = player.isHuman;

        player.hand.forEach(card => {
            const cardElement = CardSprite.createCardElement(card, isHuman);

            if (isHuman && validCards.length > 0) {
                const isValid = validCards.some(c => c.equals(card));
                CardSprite.setPlayable(cardElement, isValid);

                // Check if this card is selected
                if (selectedCard && selectedCard.equals(card)) {
                    cardElement.classList.add('selected');
                }

                if (isValid && onCardClick) {
                    cardElement.addEventListener('click', () => onCardClick(card));
                }
            }

            handElement.appendChild(cardElement);
        });
    }

    /**
     * Render all player hands
     * @param {Array<Player>} players - All players
     * @param {Array<Card>} validCards - Valid cards for human
     * @param {Function} onCardClick - Click handler
     * @param {Card} selectedCard - Currently selected card
     */
    renderAllHands(players, validCards = [], onCardClick = null, selectedCard = null) {
        players.forEach(player => {
            this.renderHand(
                player,
                player.isHuman ? validCards : [],
                player.isHuman ? onCardClick : null,
                player.isHuman ? selectedCard : null
            );
        });
    }

    /**
     * Render a card played to the center
     * @param {Card} card - Card played
     * @param {number} position - Player position
     */
    renderPlayedCard(card, position) {
        const playedElement = this.elements.played[position];
        playedElement.innerHTML = '';

        const cardElement = CardSprite.createCardElement(card, true);
        CardSprite.animatePlay(cardElement);
        playedElement.appendChild(cardElement);
    }

    /**
     * Clear all played cards from center
     */
    clearPlayedCards() {
        for (let i = 0; i < 4; i++) {
            this.elements.played[i].innerHTML = '';
        }
    }

    /**
     * Animate collecting trick cards
     * @param {number} winnerPosition - Position of winner
     */
    async animateCollectTrick(winnerPosition) {
        // Add collecting animation to all played cards
        for (let i = 0; i < 4; i++) {
            const cardElement = this.elements.played[i].firstChild;
            if (cardElement) {
                CardSprite.animateCollect(cardElement);
            }
        }

        // Wait for animation
        await new Promise(resolve => setTimeout(resolve, 500));

        // Clear cards
        this.clearPlayedCards();
    }

    /**
     * Update score display
     * @param {Array<number>} tricksWon - Tricks won by each team
     * @param {Array<number>} tensCollected - 10s collected by each team
     */
    updateScores(tricksWon, tensCollected) {
        this.elements.scores.team0Tens.textContent = tensCollected[0];
        this.elements.scores.team0Tricks.textContent = tricksWon[0];
        this.elements.scores.team1Tens.textContent = tensCollected[1];
        this.elements.scores.team1Tricks.textContent = tricksWon[1];
    }

    /**
     * Update superior suit display
     * @param {string|null} suit - Superior suit or null
     */
    updateSuperiorSuit(suit) {
        const element = this.elements.superiorSuit;

        // Remove all suit classes
        element.classList.remove('hearts', 'diamonds', 'clubs', 'spades');

        if (suit) {
            element.textContent = `Superior: ${getSuitSymbol(suit)} ${getSuitDisplay(suit)}`;
            element.classList.add(suit);
        } else {
            element.textContent = 'Superior Suit: None';
        }
    }

    /**
     * Show turn indicator
     * @param {number} position - Current player position
     * @param {boolean} isHuman - Whether it's human's turn
     */
    showTurnIndicator(position, isHuman) {
        const indicator = this.elements.turnIndicator;

        // Position the indicator based on current player
        const positions = {
            0: { bottom: '140px', left: '50%', transform: 'translateX(-50%)' },
            1: { left: '140px', top: '50%', transform: 'translateY(-50%)' },
            2: { top: '140px', left: '50%', transform: 'translateX(-50%)' },
            3: { right: '140px', top: '50%', transform: 'translateY(-50%)' }
        };

        // Reset position
        indicator.style.top = '';
        indicator.style.bottom = '';
        indicator.style.left = '';
        indicator.style.right = '';
        indicator.style.transform = '';

        // Apply new position
        Object.assign(indicator.style, positions[position]);

        indicator.classList.toggle('active', isHuman);
    }

    /**
     * Show message overlay
     * @param {string} title - Message title
     * @param {string} text - Message text
     * @param {string} buttonText - Button text
     * @returns {Promise} Resolves when button clicked
     */
    showMessage(title, text, buttonText = 'Continue') {
        return new Promise(resolve => {
            this.elements.messageTitle.textContent = title;
            this.elements.messageText.textContent = text;
            this.elements.messageButton.textContent = buttonText;
            this.elements.messageOverlay.classList.remove('hidden');

            const handleClick = () => {
                this.elements.messageButton.removeEventListener('click', handleClick);
                this.elements.messageOverlay.classList.add('hidden');
                resolve();
            };

            this.elements.messageButton.addEventListener('click', handleClick);
        });
    }

    /**
     * Hide message overlay
     */
    hideMessage() {
        this.elements.messageOverlay.classList.add('hidden');
    }

    /**
     * Flash a message briefly without blocking
     * @param {string} text - Message to flash
     * @param {number} duration - Duration in ms
     */
    flashMessage(text, duration = 1500) {
        this.elements.messageTitle.textContent = text;
        this.elements.messageText.textContent = '';
        this.elements.messageButton.style.display = 'none';
        this.elements.messageOverlay.classList.remove('hidden');

        setTimeout(() => {
            this.elements.messageOverlay.classList.add('hidden');
            this.elements.messageButton.style.display = '';
        }, duration);
    }
}
