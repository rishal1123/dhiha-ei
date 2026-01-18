/**
 * UIManager class - Manages UI interactions and coordinates with Game and Renderer
 */
import { Renderer } from './Renderer.js';
import { delay, getSuitSymbol, getSuitDisplay } from '../utils/helpers.js';

export class UIManager {
    /**
     * Create UI Manager
     * @param {Game} game - Game instance
     */
    constructor(game) {
        this.game = game;
        this.renderer = new Renderer();
        this.isProcessing = false;
        this.selectedCard = null;

        this.setupEventListeners();
        this.bindGameEvents();
    }

    /**
     * Set up DOM event listeners
     */
    setupEventListeners() {
        const newGameBtn = document.getElementById('new-game-btn');
        newGameBtn.addEventListener('click', () => this.startNewGame());
    }

    /**
     * Bind game event callbacks
     */
    bindGameEvents() {
        this.game.onStateChange = (state) => this.handleStateChange(state);
        this.game.onCardPlayed = (card, player) => this.handleCardPlayed(card, player);
        this.game.onTrickComplete = (winner, trick, tens) => this.handleTrickComplete(winner, trick, tens);
        this.game.onGameOver = (result) => this.handleGameOver(result);
        this.game.onSuperiorSuitEstablished = (suit, player) => this.handleSuperiorSuit(suit, player);
    }

    /**
     * Start a new game
     */
    async startNewGame() {
        this.isProcessing = false;
        this.selectedCard = null;
        this.game.startGame();
        this.renderer.clearPlayedCards();
        this.renderer.updateSuperiorSuit(null);
        this.updateDisplay();

        // If AI goes first, start their turns
        await this.game.continueGame();
    }

    /**
     * Update the full display
     */
    updateDisplay() {
        const state = this.game.getGameState();
        const validCards = this.game.isHumanTurn() ? this.game.getValidCards() : [];

        this.renderer.renderAllHands(
            this.game.players,
            validCards,
            (card) => this.handleCardClick(card),
            this.selectedCard
        );

        this.renderer.updateScores(state.tricksWon, state.tensCollected);
        this.renderer.updateSuperiorSuit(state.superiorSuit);
        this.renderer.showTurnIndicator(state.currentPlayer, this.game.isHumanTurn());
    }

    /**
     * Handle human player clicking a card
     * First click selects, second click plays
     * @param {Card} card - Card clicked
     */
    async handleCardClick(card) {
        if (this.isProcessing) return;
        if (!this.game.isHumanTurn()) return;

        // Check if this card is already selected
        if (this.selectedCard && this.selectedCard.equals(card)) {
            // Second click on same card - play it
            this.isProcessing = true;
            this.selectedCard = null;

            const success = await this.game.playCard(card);

            if (success) {
                // Continue game (AI turns)
                await this.game.continueGame();
            }

            this.isProcessing = false;
        } else {
            // First click or different card - select it
            this.selectedCard = card;
            this.updateDisplay();
        }
    }

    /**
     * Clear selected card
     */
    clearSelection() {
        this.selectedCard = null;
    }

    /**
     * Handle game state change
     * @param {Object} state - New game state
     */
    handleStateChange(state) {
        this.updateDisplay();
    }

    /**
     * Handle card played event
     * @param {Card} card - Card played
     * @param {Player} player - Player who played
     */
    handleCardPlayed(card, player) {
        this.renderer.renderPlayedCard(card, player.position);
        this.updateDisplay();
    }

    /**
     * Handle trick completion
     * @param {Object} winner - Winner info
     * @param {Trick} trick - Completed trick
     * @param {Array<Card>} tens - 10s collected
     */
    async handleTrickComplete(winner, trick, tens) {
        // Brief pause to see the winning card
        await delay(800);

        // Show who won
        const winnerName = winner.player.isHuman ? 'You' : winner.player.name;
        let message = `${winnerName} won the trick!`;

        if (tens.length > 0) {
            const tensStr = tens.map(t => `${t.getSuitSymbol()}10`).join(', ');
            message += ` (+${tens.length} ten${tens.length > 1 ? 's' : ''}: ${tensStr})`;
        }

        this.renderer.flashMessage(message, 1200);
        await delay(1200);

        // Animate collecting cards
        await this.renderer.animateCollectTrick(winner.position);

        // Update scores
        const state = this.game.getGameState();
        this.renderer.updateScores(state.tricksWon, state.tensCollected);
    }

    /**
     * Handle superior suit being established
     * @param {string} suit - New superior suit
     * @param {Player} player - Player who established it
     */
    async handleSuperiorSuit(suit, player) {
        this.renderer.updateSuperiorSuit(suit);

        const playerName = player.isHuman ? 'You' : player.name;
        const suitDisplay = `${getSuitSymbol(suit)} ${getSuitDisplay(suit)}`;

        await this.renderer.showMessage(
            'Superior Suit Established!',
            `${playerName} couldn't follow suit and played ${suitDisplay}. This suit now beats all others for the rest of the game!`,
            'Got it!'
        );
    }

    /**
     * Handle game over
     * @param {Object} result - Game result
     */
    async handleGameOver(result) {
        await delay(500);

        const state = this.game.getGameState();
        let title, text;

        if (result.winner === 0) {
            title = 'You Win!';
        } else if (result.winner === 1) {
            title = 'You Lose!';
        } else {
            title = 'It\'s a Tie!';
        }

        text = result.message + `\n\nFinal Score:\nYour Team: ${state.tensCollected[0]} tens, ${state.tricksWon[0]} tricks\nOpponents: ${state.tensCollected[1]} tens, ${state.tricksWon[1]} tricks`;

        await this.renderer.showMessage(title, text, 'Play Again');
        this.startNewGame();
    }

    /**
     * Initialize the UI
     */
    init() {
        this.startNewGame();
    }
}
