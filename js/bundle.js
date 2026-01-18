/**
 * Thaasbai - Maldivian Card Games
 * Bundled version with multi-round scoring and multiplayer support
 * Currently includes: Dhiha Ei, Digu (coming soon)
 */

(function() {
    'use strict';

    // ============================================
    // WEBSOCKET MULTIPLAYER CONFIGURATION
    // ============================================

    // Socket.IO connection
    let socket = null;
    let currentUserId = null;
    let isConnected = false;

    // Get WebSocket server URL (same origin or configurable)
    function getServerUrl() {
        // Use same origin for production, or configure for development
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return window.location.origin;
        }
        return window.location.origin;
    }

    // Initialize WebSocket connection
    function initializeMultiplayer() {
        if (typeof io === 'undefined') {
            console.warn('Socket.IO not loaded - multiplayer disabled');
            return false;
        }

        try {
            const serverUrl = getServerUrl();
            socket = io(serverUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });

            socket.on('connect', () => {
                console.log('Connected to server');
                isConnected = true;
            });

            socket.on('connected', (data) => {
                currentUserId = data.sid;
                console.log('Session ID:', currentUserId);
            });

            socket.on('disconnect', () => {
                console.log('Disconnected from server');
                isConnected = false;
            });

            socket.on('connect_error', (error) => {
                console.error('Connection error:', error);
                isConnected = false;
            });

            console.log('Multiplayer initialized');
            return true;
        } catch (error) {
            console.error('Multiplayer initialization error:', error);
            return false;
        }
    }

    // Check if connected
    function isMultiplayerAvailable() {
        return socket && isConnected;
    }

    // ============================================
    // PRESENCE MANAGER
    // ============================================

    class PresenceManager {
        constructor(roomId, userId, position) {
            this.roomId = roomId;
            this.userId = userId;
            this.position = position;
            this.onPlayerDisconnected = null;
        }

        async setupPresence() {
            if (!socket) return;

            // Listen for player disconnections
            socket.on('player_disconnected', (data) => {
                if (this.onPlayerDisconnected) {
                    this.onPlayerDisconnected(data.position, data.players);
                }
            });
        }

        cleanup() {
            if (socket) {
                socket.off('player_disconnected');
            }
        }
    }

    // ============================================
    // LOBBY MANAGER
    // ============================================

    class LobbyManager {
        constructor() {
            this.currentRoomId = null;
            this.currentPosition = null;
            this.onPlayersChanged = null;
            this.onGameStart = null;
            this.onError = null;
            this.onPositionChanged = null;
            this.gameStartData = null;
        }

        setupSocketListeners() {
            if (!socket) {
                console.error('setupSocketListeners called but socket is null!');
                return;
            }
            console.log('setupSocketListeners called, setting up listeners');

            // Players changed
            socket.on('players_changed', (data) => {
                if (this.onPlayersChanged) {
                    this.onPlayersChanged(data.players);
                }
            });

            // Position changed (after swap)
            socket.on('position_changed', (data) => {
                // Update our position if we were moved
                for (const [sid, pos] of Object.entries(data.players || {})) {
                    if (data.players[this.currentPosition]?.oderId !== currentUserId) {
                        // Find our new position
                        for (let i = 0; i < 4; i++) {
                            if (data.players[i]?.oderId === currentUserId) {
                                this.currentPosition = i;
                                break;
                            }
                        }
                    }
                }
                if (this.onPlayersChanged) {
                    this.onPlayersChanged(data.players);
                }
                if (this.onPositionChanged) {
                    this.onPositionChanged(this.currentPosition);
                }
            });

            // Game started
            socket.on('game_started', (data) => {
                console.log('game_started event received:', data);
                this.gameStartData = data;
                if (this.onGameStart) {
                    console.log('Calling onGameStart callback');
                    this.onGameStart(data);
                } else {
                    console.error('onGameStart callback not set!');
                }
            });

            // Error handling
            socket.on('error', (data) => {
                if (this.onError) {
                    this.onError(data.message);
                }
            });
        }

        async createRoom(hostName) {
            if (!socket || !isConnected) {
                throw new Error('Not connected to server');
            }

            return new Promise((resolve, reject) => {
                socket.emit('create_room', { playerName: hostName });

                socket.once('room_created', (data) => {
                    this.currentRoomId = data.roomId;
                    this.currentPosition = data.position;
                    this.setupSocketListeners();

                    if (this.onPlayersChanged) {
                        this.onPlayersChanged(data.players);
                    }

                    resolve({ roomId: data.roomId, position: data.position });
                });

                socket.once('error', (data) => {
                    reject(new Error(data.message));
                });
            });
        }

        async joinRoom(roomId, playerName) {
            if (!socket || !isConnected) {
                throw new Error('Not connected to server');
            }

            return new Promise((resolve, reject) => {
                socket.emit('join_room', {
                    roomId: roomId.toUpperCase().trim(),
                    playerName
                });

                socket.once('room_joined', (data) => {
                    this.currentRoomId = data.roomId;
                    this.currentPosition = data.position;
                    this.setupSocketListeners();

                    if (this.onPlayersChanged) {
                        this.onPlayersChanged(data.players);
                    }

                    resolve({
                        roomId: data.roomId,
                        position: data.position,
                        players: data.players
                    });
                });

                socket.once('error', (data) => {
                    reject(new Error(data.message));
                });
            });
        }

        async setReady(ready) {
            if (!socket || this.currentPosition === null) return;
            socket.emit('set_ready', { ready });
        }

        async startGame(gameState, hands) {
            if (!socket || !this.currentRoomId) return;

            return new Promise((resolve, reject) => {
                socket.emit('start_game', { gameState, hands });

                // Game start is handled by game_started event
                const timeout = setTimeout(() => {
                    reject(new Error('Start game timeout'));
                }, 5000);

                socket.once('game_started', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                socket.once('error', (data) => {
                    clearTimeout(timeout);
                    reject(new Error(data.message));
                });
            });
        }

        async leaveRoom() {
            if (!socket) return;

            socket.emit('leave_room');

            // Clean up listeners
            socket.off('players_changed');
            socket.off('position_changed');
            socket.off('game_started');

            this.currentRoomId = null;
            this.currentPosition = null;
        }

        isHost() {
            return this.currentPosition === 0;
        }

        getRoomId() {
            return this.currentRoomId;
        }

        getPosition() {
            return this.currentPosition;
        }

        getGameStartData() {
            return this.gameStartData;
        }

        // Swap a player to the other team (host only)
        async swapPlayerTeam(fromPosition) {
            if (!this.isHost()) {
                throw new Error('Only host can assign teams');
            }

            if (!socket) return;

            socket.emit('swap_player', { fromPosition });
        }
    }

    // ============================================
    // GAME SYNC MANAGER
    // ============================================

    class GameSyncManager {
        constructor(roomId, userId, position) {
            this.roomId = roomId;
            this.userId = userId;
            this.localPosition = position;
            this.onRemoteCardPlayed = null;
            this.onGameStateChanged = null;
            this.onRoundStarted = null;
            this.isListening = false;
        }

        async initialize() {
            // No initialization needed for WebSocket
        }

        startListening() {
            if (this.isListening || !socket) return;
            this.isListening = true;

            // Listen for remote card plays
            socket.on('remote_card_played', (data) => {
                console.log('Remote card played:', data);
                if (this.onRemoteCardPlayed) {
                    this.onRemoteCardPlayed(data.card, data.position);
                }
            });

            // Listen for game state updates
            socket.on('game_state_updated', (data) => {
                if (this.onGameStateChanged) {
                    this.onGameStateChanged(data.gameState);
                }
            });

            // Listen for new rounds
            socket.on('round_started', (data) => {
                if (this.onRoundStarted) {
                    this.onRoundStarted(data.gameState, data.hands);
                }
            });
        }

        stopListening() {
            if (socket) {
                socket.off('remote_card_played');
                socket.off('game_state_updated');
                socket.off('round_started');
            }
            this.isListening = false;
        }

        async broadcastCardPlay(card, position) {
            if (!socket) return;

            socket.emit('card_played', {
                card: { suit: card.suit, rank: card.rank },
                position: position
            });
        }

        async broadcastGameState(state) {
            if (!socket) return;

            socket.emit('update_game_state', {
                gameState: {
                    currentPlayerIndex: state.currentPlayerIndex,
                    trickNumber: state.trickNumber,
                    superiorSuit: state.superiorSuit || null,
                    tricksWon: state.tricksWon,
                    tensCollected: state.tensCollected,
                    roundOver: state.roundOver || false,
                    roundResult: state.roundResult || null,
                    matchPoints: state.matchPoints,
                    matchOver: state.matchOver || false
                }
            });
        }

        async broadcastNewRound(initialState, hands) {
            if (!socket) return;

            const handsData = {};
            hands.forEach((hand, index) => {
                handsData[index] = hand.map(card => ({
                    suit: card.suit,
                    rank: card.rank
                }));
            });

            socket.emit('new_round', {
                gameState: initialState,
                hands: handsData
            });
        }

        cleanup() {
            this.stopListening();
        }
    }

    // ============================================
    // CONSTANTS
    // ============================================

    const POINTS_TO_WIN_MATCH = 7;

    // All win types give 1 point each
    const WIN_TYPES = {
        ALL_TENS: 'all-tens',
        SHUTOUT: 'shutout',
        NORMAL: 'normal'
    };

    // ============================================
    // UTILITIES
    // ============================================

    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getSuitSymbol(suit) {
        const symbols = {
            hearts: '\u2665',
            diamonds: '\u2666',
            clubs: '\u2663',
            spades: '\u2660'
        };
        return symbols[suit] || '';
    }

    function getSuitDisplay(suit) {
        return suit.charAt(0).toUpperCase() + suit.slice(1);
    }

    function sortCards(cards) {
        const suitOrder = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
        return [...cards].sort((a, b) => {
            if (suitOrder[a.suit] !== suitOrder[b.suit]) {
                return suitOrder[a.suit] - suitOrder[b.suit];
            }
            return b.rank - a.rank;
        });
    }

    // ============================================
    // CARD CLASS
    // ============================================

    class Card {
        static SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
        static RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

        constructor(suit, rank) {
            this.suit = suit;
            this.rank = rank;
            this.id = `${suit}-${rank}`;
        }

        getPower() {
            return this.rank;
        }

        isTen() {
            return this.rank === 10;
        }

        isRed() {
            return this.suit === 'hearts' || this.suit === 'diamonds';
        }

        getRankDisplay() {
            const displays = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J' };
            return displays[this.rank] || this.rank.toString();
        }

        getSuitSymbol() {
            return getSuitSymbol(this.suit);
        }

        toString() {
            return `${this.getRankDisplay()}${this.getSuitSymbol()}`;
        }

        equals(other) {
            return this.suit === other.suit && this.rank === other.rank;
        }
    }

    // ============================================
    // DECK CLASS
    // ============================================

    class Deck {
        constructor() {
            this.cards = [];
            this.initialize();
        }

        initialize() {
            this.cards = [];
            for (const suit of Card.SUITS) {
                for (const rank of Card.RANKS) {
                    this.cards.push(new Card(suit, rank));
                }
            }
        }

        shuffle() {
            shuffle(this.cards);
        }

        deal(numPlayers = 4) {
            this.shuffle();
            const hands = Array.from({ length: numPlayers }, () => []);
            const cardsPerPlayer = Math.floor(this.cards.length / numPlayers);

            for (let i = 0; i < this.cards.length; i++) {
                const playerIndex = i % numPlayers;
                if (hands[playerIndex].length < cardsPerPlayer) {
                    hands[playerIndex].push(this.cards[i]);
                }
            }
            return hands;
        }
    }

    // ============================================
    // PLAYER CLASS
    // ============================================

    // Maldivian names for AI players
    const MALDIVIAN_AI_NAMES = [
        'Ahmed AI', 'Fathima AI', 'Mohamed AI', 'Aisha AI',
        'Ibrahim AI', 'Mariyam AI', 'Ali AI', 'Hawwa AI',
        'Hassan AI', 'Aminath AI', 'Hussain AI', 'Safiya AI'
    ];

    class Player {
        constructor(position, team, isHuman = false) {
            this.position = position;
            this.team = team;
            this.isHuman = isHuman;
            this.hand = [];
            this.name = this.getDefaultName();
        }

        getDefaultName() {
            if (this.isHuman) {
                return 'You';
            }
            // Pick a consistent Maldivian name based on position
            return MALDIVIAN_AI_NAMES[this.position] || `Player ${this.position + 1}`;
        }

        setHand(cards) {
            this.hand = sortCards(cards);
        }

        hasSuit(suit) {
            return this.hand.some(card => card.suit === suit);
        }

        getCardsOfSuit(suit) {
            return this.hand.filter(card => card.suit === suit);
        }

        getValidCards(ledSuit) {
            if (!ledSuit) {
                return [...this.hand];
            }
            const suitCards = this.getCardsOfSuit(ledSuit);
            if (suitCards.length > 0) {
                return suitCards;
            }
            return [...this.hand];
        }

        canPlayCard(card, ledSuit) {
            const validCards = this.getValidCards(ledSuit);
            return validCards.some(c => c.equals(card));
        }

        playCard(card) {
            const index = this.hand.findIndex(c => c.equals(card));
            if (index === -1) {
                return null;
            }
            return this.hand.splice(index, 1)[0];
        }

        get cardCount() {
            return this.hand.length;
        }

        getTens() {
            return this.hand.filter(card => card.isTen());
        }

        sortHand() {
            this.hand = sortCards(this.hand);
        }
    }

    // ============================================
    // AI PLAYER CLASS
    // ============================================

    class AIPlayer extends Player {
        constructor(position, team) {
            super(position, team, false);
        }

        chooseCard(ledSuit, superiorSuit, trickCards, gameState) {
            const validCards = this.getValidCards(ledSuit);

            if (validCards.length === 1) {
                return validCards[0];
            }

            if (!ledSuit) {
                return this.chooseLeadCard(superiorSuit, gameState);
            }

            if (this.hasSuit(ledSuit)) {
                return this.chooseFollowCard(validCards, trickCards, superiorSuit, gameState);
            }

            return this.chooseOffSuitCard(validCards, trickCards, superiorSuit, gameState);
        }

        chooseLeadCard(superiorSuit, gameState) {
            const validCards = [...this.hand];

            if (superiorSuit && this.hasSuit(superiorSuit)) {
                const superiorCards = this.getCardsOfSuit(superiorSuit);
                const highSuperior = this.getHighestCard(superiorCards);
                if (highSuperior.getPower() >= 12) {
                    return highSuperior;
                }
            }

            const tens = this.getTens();
            for (const ten of tens) {
                const suitCards = this.getCardsOfSuit(ten.suit);
                const hasHighProtection = suitCards.some(c => c.getPower() > 10);
                if (hasHighProtection || (superiorSuit === ten.suit)) {
                    return ten;
                }
            }

            return this.getLowestCard(validCards);
        }

        chooseFollowCard(validCards, trickCards, superiorSuit, gameState) {
            const currentWinner = this.getCurrentTrickWinner(trickCards, superiorSuit);
            const partnerPosition = (this.position + 2) % 4;

            if (currentWinner && currentWinner.position === partnerPosition) {
                return this.getLowestCard(validCards);
            }

            const ledSuit = trickCards[0]?.card?.suit;
            const highestNeeded = this.getHighestTrickCard(trickCards, ledSuit, superiorSuit);
            const winningCards = validCards.filter(c => c.getPower() > highestNeeded);

            if (winningCards.length > 0) {
                const trickHasTen = trickCards.some(tc => tc.card?.isTen());
                if (trickHasTen) {
                    return this.getLowestCard(winningCards);
                }
                return this.getLowestCard(winningCards);
            }

            return this.getLowestCard(validCards);
        }

        chooseOffSuitCard(validCards, trickCards, superiorSuit, gameState) {
            const partnerPosition = (this.position + 2) % 4;
            const currentWinner = this.getCurrentTrickWinner(trickCards, superiorSuit);

            if (currentWinner && currentWinner.position === partnerPosition) {
                return this.getLowestCard(validCards);
            }

            if (superiorSuit) {
                const superiorCards = validCards.filter(c => c.suit === superiorSuit);
                if (superiorCards.length > 0) {
                    return this.getLowestCard(superiorCards);
                }
            }

            if (!superiorSuit) {
                const nonTens = validCards.filter(c => !c.isTen());
                if (nonTens.length > 0) {
                    return this.getLowestCard(nonTens);
                }
            }

            return this.getLowestCard(validCards);
        }

        getHighestCard(cards) {
            return cards.reduce((best, card) =>
                card.getPower() > best.getPower() ? card : best
            );
        }

        getLowestCard(cards) {
            const nonTens = cards.filter(c => !c.isTen());
            const searchCards = nonTens.length > 0 ? nonTens : cards;
            return searchCards.reduce((best, card) =>
                card.getPower() < best.getPower() ? card : best
            );
        }

        getHighestTrickCard(trickCards, ledSuit, superiorSuit) {
            let highest = 0;
            for (const tc of trickCards) {
                if (!tc.card) continue;
                if (superiorSuit && tc.card.suit === superiorSuit) {
                    highest = Math.max(highest, tc.card.getPower() + 100);
                } else if (tc.card.suit === ledSuit) {
                    highest = Math.max(highest, tc.card.getPower());
                }
            }
            return highest;
        }

        getCurrentTrickWinner(trickCards, superiorSuit) {
            if (trickCards.length === 0) return null;

            const ledSuit = trickCards[0]?.card?.suit;
            let winner = null;
            let highestPower = -1;

            for (const tc of trickCards) {
                if (!tc.card) continue;

                let power = 0;
                if (superiorSuit && tc.card.suit === superiorSuit) {
                    power = tc.card.getPower() + 100;
                } else if (tc.card.suit === ledSuit) {
                    power = tc.card.getPower();
                }

                if (power > highestPower) {
                    highestPower = power;
                    winner = { position: tc.position, card: tc.card };
                }
            }

            return winner;
        }
    }

    // ============================================
    // TRICK CLASS
    // ============================================

    class Trick {
        constructor() {
            this.cards = [];
            this.ledSuit = null;
            this.winner = null;
            this.complete = false;
        }

        addCard(card, position, player) {
            if (this.cards.length === 0) {
                this.ledSuit = card.suit;
            }

            this.cards.push({ card, position, player });

            if (this.cards.length === 4) {
                this.complete = true;
            }
        }

        determineWinner(superiorSuit) {
            if (this.cards.length === 0) {
                return null;
            }

            let winningPlay = this.cards[0];
            let highestPower = this.getEffectivePower(winningPlay.card, superiorSuit);

            for (let i = 1; i < this.cards.length; i++) {
                const play = this.cards[i];
                const power = this.getEffectivePower(play.card, superiorSuit);

                if (power > highestPower) {
                    highestPower = power;
                    winningPlay = play;
                }
            }

            this.winner = winningPlay;
            return winningPlay;
        }

        getEffectivePower(card, superiorSuit) {
            if (superiorSuit && card.suit === superiorSuit) {
                return 100 + card.getPower();
            }
            if (card.suit === this.ledSuit) {
                return card.getPower();
            }
            return 0;
        }

        getTens() {
            return this.cards
                .filter(play => play.card.isTen())
                .map(play => play.card);
        }

        get cardCount() {
            return this.cards.length;
        }

        isComplete() {
            return this.complete;
        }

        getCards() {
            return [...this.cards];
        }

        reset() {
            this.cards = [];
            this.ledSuit = null;
            this.winner = null;
            this.complete = false;
        }
    }

    // ============================================
    // RULES CLASS
    // ============================================

    class Rules {
        static canPlayCard(player, card, ledSuit) {
            return player.canPlayCard(card, ledSuit);
        }

        static handleSuperiorSuit(card, ledSuit, currentSuperior, player) {
            if (!ledSuit) {
                return { newSuperior: currentSuperior, established: false };
            }
            if (card.suit === ledSuit) {
                return { newSuperior: currentSuperior, established: false };
            }
            if (!currentSuperior) {
                return { newSuperior: card.suit, established: true };
            }
            return { newSuperior: currentSuperior, established: false };
        }

        static checkRoundWinner(state) {
            const { tensCollected, tricksWon, trickNumber } = state;
            const totalTensPlayed = tensCollected[0] + tensCollected[1];

            // When all 4 tens have been played, check who has more
            if (totalTensPlayed === 4) {
                // Team with more tens wins (All 10s type)
                if (tensCollected[0] > tensCollected[1]) {
                    const isShutout = tricksWon[1] === 0 && trickNumber === 13;
                    return {
                        winner: 0,
                        type: tensCollected[0] === 4 ? WIN_TYPES.ALL_TENS : (isShutout ? WIN_TYPES.SHUTOUT : WIN_TYPES.NORMAL),
                        points: 1,
                        message: tensCollected[0] === 4 ? 'Your team collected all four 10s!' : `Your team wins with ${tensCollected[0]} tens!`
                    };
                }
                if (tensCollected[1] > tensCollected[0]) {
                    const isShutout = tricksWon[0] === 0 && trickNumber === 13;
                    return {
                        winner: 1,
                        type: tensCollected[1] === 4 ? WIN_TYPES.ALL_TENS : (isShutout ? WIN_TYPES.SHUTOUT : WIN_TYPES.NORMAL),
                        points: 1,
                        message: tensCollected[1] === 4 ? 'Opponents collected all four 10s!' : `Opponents win with ${tensCollected[1]} tens!`
                    };
                }
                // 2-2 split - need to continue playing for tricks
            }

            // Only check other conditions after all 13 tricks
            if (trickNumber < 13) {
                return null;
            }

            // All 13 tricks complete - final scoring
            const team0Shutout = tricksWon[1] === 0;
            const team1Shutout = tricksWon[0] === 0;

            // 2-2 tens split - winner decided by tricks
            if (tensCollected[0] === 2 && tensCollected[1] === 2) {
                if (tricksWon[0] > tricksWon[1]) {
                    return {
                        winner: 0,
                        type: team0Shutout ? WIN_TYPES.SHUTOUT : WIN_TYPES.NORMAL,
                        points: 1,
                        message: team0Shutout ? 'Your team wins with a shutout!' : 'Your team wins with more tricks (2-2 tens)!'
                    };
                }
                if (tricksWon[1] > tricksWon[0]) {
                    return {
                        winner: 1,
                        type: team1Shutout ? WIN_TYPES.SHUTOUT : WIN_TYPES.NORMAL,
                        points: 1,
                        message: team1Shutout ? 'Opponents win with a shutout!' : 'Opponents win with more tricks (2-2 tens)!'
                    };
                }
                // Equal tricks with 2-2 tens = tie
                return { winner: -1, type: 'tie', points: 0, message: 'The round is a tie (2-2 tens, equal tricks)!' };
            }

            // Should not reach here if tens logic above works, but fallback to tricks
            if (tricksWon[0] > tricksWon[1]) {
                return {
                    winner: 0,
                    type: team0Shutout ? WIN_TYPES.SHUTOUT : WIN_TYPES.NORMAL,
                    points: 1,
                    message: 'Your team wins with most tricks!'
                };
            }
            if (tricksWon[1] > tricksWon[0]) {
                return {
                    winner: 1,
                    type: team1Shutout ? WIN_TYPES.SHUTOUT : WIN_TYPES.NORMAL,
                    points: 1,
                    message: 'Opponents win with most tricks!'
                };
            }

            return { winner: -1, type: 'tie', points: 0, message: 'The round is a tie!' };
        }

    }

    // ============================================
    // GAME CLASS
    // ============================================

    class Game {
        constructor() {
            this.deck = new Deck();
            this.players = [];
            this.currentTrick = null;
            this.currentPlayerIndex = 0;
            this.trickNumber = 0;
            this.superiorSuit = null;
            this.tricksWon = [0, 0];
            this.tensCollected = [0, 0];
            this.collectedTensCards = [[], []]; // Actual 10 cards collected by each team
            this.roundOver = false;
            this.roundResult = null;

            // Match points (persists across rounds)
            this.matchPoints = [0, 0];
            this.matchOver = false;
            this.matchWinner = null;

            // Track win types for display
            this.winTypeCount = [
                { normal: 0, 'all-tens': 0, shutout: 0 },
                { normal: 0, 'all-tens': 0, shutout: 0 }
            ];

            // Multiplayer properties
            this.isMultiplayer = false;
            this.localPlayerPosition = 0;
            this.syncManager = null;
            this.remotePlayers = {}; // Stores player names by position
            this.isHost = false;

            this.onStateChange = null;
            this.onTrickComplete = null;
            this.onRoundOver = null;
            this.onMatchOver = null;
            this.onSuperiorSuitEstablished = null;
            this.onCardPlayed = null;

            this.initializePlayers();
        }

        initializePlayers(multiplayer = false, localPosition = 0) {
            this.players = [];

            if (multiplayer) {
                // In multiplayer, all positions are human players (remote)
                for (let i = 0; i < 4; i++) {
                    const team = i % 2 === 0 ? 0 : 1; // Positions 0,2 = Team A, 1,3 = Team B
                    const isLocal = i === localPosition;
                    this.players.push(new Player(i, team, isLocal));
                }
            } else {
                // Single player mode - position 0 is human, rest are AI
                this.players.push(new Player(0, 0, true));
                this.players.push(new AIPlayer(1, 1));
                this.players.push(new AIPlayer(2, 0));
                this.players.push(new AIPlayer(3, 1));
            }
        }

        setMultiplayerMode(syncManager, localPosition, playerNames) {
            console.log('setMultiplayerMode called:', { localPosition, playerNames });
            this.isMultiplayer = true;
            this.localPlayerPosition = localPosition;
            this.syncManager = syncManager;
            this.remotePlayers = playerNames || {};
            this.isHost = localPosition === 0;

            // Reinitialize players for multiplayer
            this.initializePlayers(true, localPosition);

            // Apply player names after initialization
            if (playerNames) {
                this.setPlayerNames(playerNames);
            }

            // Set up remote card play handler
            if (syncManager) {
                syncManager.onRemoteCardPlayed = (cardData, position) => {
                    this.playRemoteCard(cardData, position);
                };
            }

            console.log('Multiplayer mode set. isMultiplayer:', this.isMultiplayer, 'localPosition:', this.localPlayerPosition);
        }

        setPlayerNames(names) {
            this.remotePlayers = names;
            // Update player names
            for (let i = 0; i < 4; i++) {
                if (names[i] && this.players[i]) {
                    this.players[i].name = names[i];
                }
            }
        }

        // Play a card from a remote player
        async playRemoteCard(cardData, position) {
            if (!this.isMultiplayer) return false;
            if (position !== this.currentPlayerIndex) {
                console.warn('Remote card played out of turn');
                return false;
            }

            const player = this.players[position];
            const card = player.hand.find(c =>
                c.suit === cardData.suit && c.rank === cardData.rank
            );

            if (!card) {
                console.error('Remote card not found in player hand');
                return false;
            }

            // Play the card internally without broadcasting
            return await this.playCardInternal(card, true);
        }

        startNewMatch() {
            this.matchPoints = [0, 0];
            this.matchOver = false;
            this.matchWinner = null;
            this.winTypeCount = [
                { normal: 0, 'all-tens': 0, shutout: 0 },
                { normal: 0, 'all-tens': 0, shutout: 0 }
            ];
            this.startRound();
        }

        startRound() {
            this.resetRound();
            this.dealCards();
            this.currentTrick = new Trick();
            this.notifyStateChange();
        }

        resetRound() {
            this.deck = new Deck();
            this.currentPlayerIndex = 0;
            this.trickNumber = 0;
            this.superiorSuit = null;
            this.tricksWon = [0, 0];
            this.tensCollected = [0, 0];
            this.collectedTensCards = [[], []];
            this.roundOver = false;
            this.roundResult = null;
            this.currentTrick = null;
        }

        dealCards() {
            const hands = this.deck.deal(4);
            for (let i = 0; i < 4; i++) {
                this.players[i].setHand(hands[i]);
            }
        }

        getCurrentPlayer() {
            return this.players[this.currentPlayerIndex];
        }

        isHumanTurn() {
            return this.getCurrentPlayer().isHuman;
        }

        getLedSuit() {
            return this.currentTrick ? this.currentTrick.ledSuit : null;
        }

        getValidCards() {
            const player = this.getCurrentPlayer();
            return player.getValidCards(this.getLedSuit());
        }

        async playCard(card) {
            if (this.roundOver) return false;

            // In multiplayer, broadcast the card play first
            if (this.isMultiplayer && this.currentPlayerIndex === this.localPlayerPosition) {
                if (this.syncManager) {
                    await this.syncManager.broadcastCardPlay(card, this.currentPlayerIndex);
                }
            }

            return await this.playCardInternal(card, false);
        }

        // Internal card play logic (used by both local and remote plays)
        async playCardInternal(card, isRemote = false) {
            if (this.roundOver) return false;

            const player = this.getCurrentPlayer();
            const ledSuit = this.getLedSuit();

            if (!Rules.canPlayCard(player, card, ledSuit)) {
                console.warn('Invalid card play attempted');
                return false;
            }

            const playedCard = player.playCard(card);
            if (!playedCard) return false;

            const superiorResult = Rules.handleSuperiorSuit(
                playedCard,
                ledSuit,
                this.superiorSuit,
                player
            );

            if (superiorResult.established) {
                this.superiorSuit = superiorResult.newSuperior;
                if (this.onSuperiorSuitEstablished) {
                    this.onSuperiorSuitEstablished(this.superiorSuit, player);
                }
            }

            this.currentTrick.addCard(playedCard, player.position, player);

            if (this.onCardPlayed) {
                this.onCardPlayed(playedCard, player);
            }

            if (this.currentTrick.isComplete()) {
                await this.completeTrick();
            } else {
                // Counter-clockwise: 0 → 3 → 2 → 1 → 0
                this.currentPlayerIndex = (this.currentPlayerIndex + 3) % 4;
                this.notifyStateChange();
            }

            return true;
        }

        async completeTrick() {
            const winner = this.currentTrick.determineWinner(this.superiorSuit);
            const winningTeam = winner.player.team;

            this.tricksWon[winningTeam]++;

            const tens = this.currentTrick.getTens();
            this.tensCollected[winningTeam] += tens.length;
            // Store actual 10 card objects for display
            tens.forEach(ten => this.collectedTensCards[winningTeam].push(ten));

            if (this.onTrickComplete) {
                await this.onTrickComplete(winner, this.currentTrick, tens);
            }

            this.trickNumber++;

            const roundResult = Rules.checkRoundWinner({
                tensCollected: this.tensCollected,
                tricksWon: this.tricksWon,
                trickNumber: this.trickNumber
            });

            if (roundResult) {
                this.roundOver = true;
                this.roundResult = roundResult;

                // Award match points and track win type
                if (roundResult.winner >= 0) {
                    this.matchPoints[roundResult.winner] += roundResult.points;
                    if (this.winTypeCount[roundResult.winner][roundResult.type] !== undefined) {
                        this.winTypeCount[roundResult.winner][roundResult.type]++;
                    }
                }

                // No automatic match win - games continue until someone leaves
                // Just call onRoundOver to continue to next round
                if (this.onRoundOver) {
                    this.onRoundOver(roundResult);
                }
                return;
            }

            this.currentTrick = new Trick();
            this.currentPlayerIndex = winner.position;
            this.notifyStateChange();
        }

        async playAITurn() {
            if (this.roundOver) return;

            const player = this.getCurrentPlayer();
            if (player.isHuman) return;

            await delay(600);

            const card = player.chooseCard(
                this.getLedSuit(),
                this.superiorSuit,
                this.currentTrick.getCards(),
                this.getGameState()
            );

            await this.playCard(card);
        }

        async continueGame() {
            if (this.isMultiplayer) {
                // In multiplayer, don't auto-play - wait for remote players
                // Only the UI needs to update to show waiting state
                this.notifyStateChange();
                return;
            }

            // Single player mode - AI plays automatically
            while (!this.roundOver && !this.isHumanTurn()) {
                await this.playAITurn();
            }
        }

        // Check if it's the local player's turn in multiplayer
        isLocalPlayerTurn() {
            if (!this.isMultiplayer) {
                return this.isHumanTurn();
            }
            return this.currentPlayerIndex === this.localPlayerPosition;
        }

        // Get the hand that should be shown (for multiplayer, only show local player's hand)
        getLocalHand() {
            return this.players[this.localPlayerPosition].hand;
        }

        // Reset for single player mode
        resetToSinglePlayer() {
            this.isMultiplayer = false;
            this.localPlayerPosition = 0;
            this.syncManager = null;
            this.remotePlayers = {};
            this.isHost = false;
            this.initializePlayers(false, 0);
        }

        getGameState() {
            return {
                currentPlayer: this.currentPlayerIndex,
                ledSuit: this.getLedSuit(),
                superiorSuit: this.superiorSuit,
                tricksWon: [...this.tricksWon],
                tensCollected: [...this.tensCollected],
                collectedTensCards: [
                    [...this.collectedTensCards[0]],
                    [...this.collectedTensCards[1]]
                ],
                trickNumber: this.trickNumber,
                trickCards: this.currentTrick ? this.currentTrick.getCards() : [],
                roundOver: this.roundOver,
                roundResult: this.roundResult,
                matchPoints: [...this.matchPoints],
                matchOver: this.matchOver,
                matchWinner: this.matchWinner,
                winTypeCount: [
                    { ...this.winTypeCount[0] },
                    { ...this.winTypeCount[1] }
                ]
            };
        }

        getPlayer(position) {
            return this.players[position];
        }

        getHumanPlayer() {
            return this.players[0];
        }

        notifyStateChange() {
            if (this.onStateChange) {
                this.onStateChange(this.getGameState());
            }
        }
    }

    // ============================================
    // CARD SPRITE CLASS
    // ============================================

    class CardSprite {
        static createCardElement(card, faceUp = true) {
            const element = document.createElement('div');
            element.className = 'card card-svg';
            element.dataset.cardId = card.id;
            element.dataset.suit = card.suit;
            element.dataset.rank = card.rank;

            if (faceUp) {
                element.classList.add(card.suit);
                const img = document.createElement('img');
                img.src = this.getCardSvgPath(card);
                img.alt = `${card.getRankDisplay()} of ${card.suit}`;
                img.draggable = false;
                element.appendChild(img);
            } else {
                element.classList.add('face-down');
                const img = document.createElement('img');
                img.src = 'cards/card-back.svg';
                img.alt = 'Card back';
                img.draggable = false;
                element.appendChild(img);
            }

            return element;
        }

        static getCardSvgPath(card) {
            // Map rank to filename
            // Card ranks: 2-10, 11=Jack, 12=Queen, 13=King, 14=Ace
            let filename;
            switch (card.rank) {
                case 14: filename = 'ace'; break;
                case 11: filename = 'jack'; break;
                case 12: filename = 'queen'; break;
                case 13: filename = 'king'; break;
                default: filename = card.rank.toString();
            }
            return `cards/${card.suit}/${filename}.svg`;
        }

        static getCardContent(card) {
            const rankDisplay = card.getRankDisplay();
            const suitSymbol = card.getSuitSymbol();

            return `
                <div class="card-corner top">
                    <span class="rank">${rankDisplay}</span>
                    <span class="suit">${suitSymbol}</span>
                </div>
                <div class="card-center">${suitSymbol}</div>
                <div class="card-corner bottom">
                    <span class="rank">${rankDisplay}</span>
                    <span class="suit">${suitSymbol}</span>
                </div>
            `;
        }

        static setPlayable(element, playable) {
            if (playable) {
                element.classList.add('playable');
                element.classList.remove('disabled');
            } else {
                element.classList.remove('playable');
                element.classList.add('disabled');
            }
        }

        static animatePlay(element) {
            element.classList.add('playing');
            setTimeout(() => element.classList.remove('playing'), 300);
        }

        static animateCollect(element) {
            element.classList.add('collecting');
        }
    }

    // ============================================
    // RENDERER CLASS
    // ============================================

    class Renderer {
        constructor() {
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
                matchPoints: {
                    0: document.getElementById('match-points-0'),
                    1: document.getElementById('match-points-1')
                },
                collectedTens: {
                    0: document.getElementById('collected-tens-0'),
                    1: document.getElementById('collected-tens-1')
                },
                winTypes: {
                    normal: [document.getElementById('normal-0'), document.getElementById('normal-1')],
                    'all-tens': [document.getElementById('all-tens-0'), document.getElementById('all-tens-1')],
                    shutout: [document.getElementById('shutout-0'), document.getElementById('shutout-1')]
                },
                superiorSuit: document.getElementById('superior-suit-display'),
                turnIndicator: document.getElementById('turn-indicator'),
                messageOverlay: document.getElementById('message-overlay'),
                messageTitle: document.getElementById('message-title'),
                messageText: document.getElementById('message-text'),
                messageButton: document.getElementById('message-button'),
                messageButtonSecondary: document.getElementById('message-button-secondary')
            };
        }

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

        renderPlayedCard(card, position) {
            const playedElement = this.elements.played[position];
            playedElement.innerHTML = '';

            const cardElement = CardSprite.createCardElement(card, true);
            CardSprite.animatePlay(cardElement);
            playedElement.appendChild(cardElement);
        }

        clearPlayedCards() {
            for (let i = 0; i < 4; i++) {
                this.elements.played[i].innerHTML = '';
            }
        }

        async animateCollectTrick(winnerPosition) {
            for (let i = 0; i < 4; i++) {
                const cardElement = this.elements.played[i].firstChild;
                if (cardElement) {
                    CardSprite.animateCollect(cardElement);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 500));
            this.clearPlayedCards();
        }

        updateScores(tricksWon, tensCollected) {
            this.elements.scores.team0Tens.textContent = tensCollected[0];
            this.elements.scores.team0Tricks.textContent = tricksWon[0];
            this.elements.scores.team1Tens.textContent = tensCollected[1];
            this.elements.scores.team1Tricks.textContent = tricksWon[1];
        }

        updateMatchPoints(matchPoints) {
            this.elements.matchPoints[0].textContent = matchPoints[0];
            this.elements.matchPoints[1].textContent = matchPoints[1];
        }

        updateWinTypeCounts(winTypeCount) {
            for (const type of ['normal', 'all-tens', 'shutout']) {
                this.elements.winTypes[type][0].textContent = winTypeCount[0][type];
                this.elements.winTypes[type][1].textContent = winTypeCount[1][type];
            }
        }

        updateCollectedTens(collectedTensCards) {
            for (let team = 0; team < 2; team++) {
                const container = this.elements.collectedTens[team];
                container.innerHTML = '';

                collectedTensCards[team].forEach(card => {
                    const tenElement = document.createElement('div');
                    tenElement.className = `collected-ten ${card.suit}`;
                    tenElement.innerHTML = `<span>10</span><span>${card.getSuitSymbol()}</span>`;
                    container.appendChild(tenElement);
                });
            }
        }

        clearCollectedTens() {
            this.elements.collectedTens[0].innerHTML = '';
            this.elements.collectedTens[1].innerHTML = '';
        }

        updateSuperiorSuit(suit) {
            const element = this.elements.superiorSuit;
            element.classList.remove('hearts', 'diamonds', 'clubs', 'spades');

            if (suit) {
                element.textContent = `👑 ${getSuitSymbol(suit)}`;
                element.classList.add(suit);
            } else {
                element.textContent = '👑 —';
            }
        }

        showTurnIndicator(position, isHuman) {
            const indicator = this.elements.turnIndicator;

            const positions = {
                0: { bottom: '140px', left: '50%', transform: 'translateX(-50%)' },
                1: { left: '140px', top: '50%', transform: 'translateY(-50%)' },
                2: { top: '140px', left: '50%', transform: 'translateX(-50%)' },
                3: { right: '140px', top: '50%', transform: 'translateY(-50%)' }
            };

            indicator.style.top = '';
            indicator.style.bottom = '';
            indicator.style.left = '';
            indicator.style.right = '';
            indicator.style.transform = '';

            Object.assign(indicator.style, positions[position]);
            indicator.classList.toggle('active', isHuman);
        }

        showMessage(title, text, buttonText = 'Continue') {
            return new Promise(resolve => {
                this.elements.messageTitle.textContent = title;
                this.elements.messageText.textContent = text;
                this.elements.messageButton.textContent = buttonText;
                this.elements.messageButton.style.display = '';
                this.elements.messageButtonSecondary.classList.add('hidden');
                this.elements.messageOverlay.classList.remove('hidden');

                const handleClick = () => {
                    this.elements.messageButton.removeEventListener('click', handleClick);
                    this.elements.messageOverlay.classList.add('hidden');
                    resolve();
                };

                this.elements.messageButton.addEventListener('click', handleClick);
            });
        }

        // Show message with two buttons, returns 'primary' or 'secondary'
        showMessageWithOptions(title, text, primaryText, secondaryText) {
            return new Promise(resolve => {
                this.elements.messageTitle.textContent = title;
                this.elements.messageText.textContent = text;
                this.elements.messageButton.textContent = primaryText;
                this.elements.messageButtonSecondary.textContent = secondaryText;
                this.elements.messageButton.style.display = '';
                this.elements.messageButtonSecondary.classList.remove('hidden');
                this.elements.messageOverlay.classList.remove('hidden');

                const handlePrimary = () => {
                    cleanup();
                    resolve('primary');
                };

                const handleSecondary = () => {
                    cleanup();
                    resolve('secondary');
                };

                const cleanup = () => {
                    this.elements.messageButton.removeEventListener('click', handlePrimary);
                    this.elements.messageButtonSecondary.removeEventListener('click', handleSecondary);
                    this.elements.messageButtonSecondary.classList.add('hidden');
                    this.elements.messageOverlay.classList.add('hidden');
                };

                this.elements.messageButton.addEventListener('click', handlePrimary);
                this.elements.messageButtonSecondary.addEventListener('click', handleSecondary);
            });
        }

        hideMessage() {
            this.elements.messageOverlay.classList.add('hidden');
        }

        flashMessage(text, duration = 1500) {
            this.elements.messageTitle.textContent = text;
            this.elements.messageText.textContent = '';
            this.elements.messageButton.style.display = 'none';
            this.elements.messageOverlay.classList.remove('hidden');

            // If duration is 0, message stays until manually hidden
            if (duration > 0) {
                setTimeout(() => {
                    this.elements.messageOverlay.classList.add('hidden');
                    this.elements.messageButton.style.display = '';
                }, duration);
            }
        }

        hideFlashMessage() {
            this.elements.messageOverlay.classList.add('hidden');
            this.elements.messageButton.style.display = '';
        }

        // Show sponsored popup with different color - auto-dismisses on user turn
        showSponsorMessage(title, text) {
            this.elements.messageTitle.textContent = title;
            this.elements.messageText.textContent = text;
            this.elements.messageButton.textContent = 'OK';
            this.elements.messageButton.style.display = '';
            this.elements.messageButtonSecondary.classList.add('hidden');
            this.elements.messageOverlay.classList.remove('hidden');
            this.elements.messageOverlay.classList.add('sponsor-popup');

            const handleClick = () => {
                this.elements.messageButton.removeEventListener('click', handleClick);
                this.elements.messageOverlay.classList.add('hidden');
                this.elements.messageOverlay.classList.remove('sponsor-popup');
            };

            this.elements.messageButton.addEventListener('click', handleClick);
        }

        // Show detailed sponsor popup with logo and info
        showSponsorDetails() {
            console.log('showSponsorDetails - elements:', this.elements.messageOverlay, this.elements.messageTitle);
            this.elements.messageTitle.innerHTML = `
                <svg viewBox="0 0 200 80" width="150" height="60" style="margin-bottom: 10px;">
                    <defs>
                        <linearGradient id="ooredooRedPopup" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#E60012"/>
                            <stop offset="100%" style="stop-color:#C4000F"/>
                        </linearGradient>
                    </defs>
                    <g transform="translate(15, 12)">
                        <circle cx="28" cy="28" r="26" fill="url(#ooredooRedPopup)"/>
                        <circle cx="20" cy="22" r="10" fill="white"/>
                        <circle cx="36" cy="22" r="8" fill="white"/>
                        <circle cx="28" cy="38" r="7" fill="white"/>
                        <path d="M22 30 Q28 32 34 28" stroke="white" stroke-width="4" fill="none"/>
                    </g>
                    <text x="75" y="48" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#E60012" letter-spacing="-1">ooredoo</text>
                    <text x="77" y="65" font-family="Arial, sans-serif" font-size="12" fill="#E60012" letter-spacing="2">MALDIVES</text>
                </svg>
            `;
            this.elements.messageText.innerHTML = `
                <div style="text-align: left; line-height: 1.6;">
                    <p style="margin-bottom: 12px;"><strong>Ooredoo Maldives</strong> - Enriching people's digital lives</p>
                    <p style="margin-bottom: 12px; font-size: 0.9em; opacity: 0.9;">Experience the fastest 4G+ network across the Maldives. Stay connected with family and friends.</p>
                    <p style="font-size: 0.85em; opacity: 0.7;">📞 929 | 🌐 ooredoo.mv</p>
                </div>
            `;
            this.elements.messageButton.textContent = 'Close';
            this.elements.messageButton.style.display = '';
            this.elements.messageButtonSecondary.classList.add('hidden');
            this.elements.messageOverlay.classList.remove('hidden');
            this.elements.messageOverlay.classList.add('sponsor-popup');
            console.log('Popup should now be visible, classes:', this.elements.messageOverlay.className);

            const handleClick = () => {
                this.elements.messageButton.removeEventListener('click', handleClick);
                this.elements.messageOverlay.classList.add('hidden');
                this.elements.messageOverlay.classList.remove('sponsor-popup');
                // Reset to textContent for future messages
                this.elements.messageTitle.textContent = '';
                this.elements.messageText.textContent = '';
            };

            this.elements.messageButton.addEventListener('click', handleClick);
        }

        // Hide sponsor message (called when user's turn starts)
        hideSponsorMessage() {
            if (this.elements.messageOverlay.classList.contains('sponsor-popup')) {
                this.elements.messageOverlay.classList.add('hidden');
                this.elements.messageOverlay.classList.remove('sponsor-popup');
            }
        }
    }

    // ============================================
    // UI MANAGER CLASS
    // ============================================

    class UIManager {
        constructor(game) {
            this.game = game;
            this.renderer = new Renderer();
            this.isProcessing = false;
            this.selectedCard = null;

            // Multiplayer components
            this.lobbyManager = null;
            this.syncManager = null;
            this.presenceManager = null;
            this.isMultiplayerMode = false;
            this.playerName = this.loadPlayerName();

            // Game timer (15 minutes for multiplayer)
            this.gameTimer = null;
            this.gameTimeRemaining = 15 * 60; // 15 minutes in seconds
            this.timerWarningShown = false;
            this.timerCriticalShown = false;

            // Lobby UI elements
            this.lobbyOverlay = document.getElementById('lobby-overlay');
            this.lobbyMenu = document.getElementById('lobby-menu');
            this.waitingRoom = document.getElementById('waiting-room');
            this.nameInputModal = document.getElementById('name-input-modal');
            this.lobbyError = document.getElementById('lobby-error');
            this.multiplayerStatus = document.getElementById('multiplayer-status');

            this.setupEventListeners();
            this.setupLobbyEventListeners();
            this.bindGameEvents();
        }

        // Load player name from localStorage
        loadPlayerName() {
            return localStorage.getItem('dhihaEi_playerName') || null;
        }

        // Save player name to localStorage
        savePlayerName(name) {
            localStorage.setItem('dhihaEi_playerName', name);
            this.playerName = name;
        }

        setupEventListeners() {
            const newGameBtn = document.getElementById('new-game-btn');
            newGameBtn.addEventListener('click', () => {
                if (this.isMultiplayerMode) {
                    this.confirmLeaveMultiplayer();
                } else {
                    this.startNewMatch();
                }
            });

            const menuBtn = document.getElementById('menu-btn');
            menuBtn.addEventListener('click', () => {
                this.returnToLobby();
            });
        }

        // Return to lobby from game
        async returnToLobby() {
            if (this.isMultiplayerMode) {
                this.confirmLeaveMultiplayer();
            } else {
                this.showLobby();
            }
        }

        setupLobbyEventListeners() {
            // Game Selection - Dhiha Ei card
            const dhihaEiCard = document.querySelector('.game-card[data-game="dhiha-ei"]');
            if (dhihaEiCard) {
                dhihaEiCard.querySelector('.game-select-btn').addEventListener('click', () => {
                    this.selectGame('dhiha-ei');
                });
            }

            // Back to games button
            const backBtn = document.getElementById('back-to-games');
            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    this.showGameSelection();
                });
            }

            // Play vs AI button
            document.getElementById('play-ai-btn').addEventListener('click', () => {
                this.startSinglePlayerGame();
            });

            // Quick Match button
            document.getElementById('quick-match-btn').addEventListener('click', () => {
                this.handleQuickMatch();
            });

            // Cancel Queue button
            document.getElementById('cancel-queue-btn').addEventListener('click', () => {
                this.cancelMatchmaking();
            });

            // Create Room button
            document.getElementById('create-room-btn').addEventListener('click', () => {
                this.handleCreateRoom();
            });

            // Join Room button
            document.getElementById('join-room-btn').addEventListener('click', () => {
                this.handleJoinRoom();
            });

            // Room code input - handle Enter key
            document.getElementById('room-code-input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.handleJoinRoom();
                }
            });

            // Copy room code button
            document.getElementById('copy-code-btn').addEventListener('click', () => {
                this.copyRoomCode();
            });

            // Ready button
            document.getElementById('ready-btn').addEventListener('click', () => {
                this.toggleReady();
            });

            // Start Game button (host only)
            document.getElementById('start-game-btn').addEventListener('click', () => {
                this.startMultiplayerGame();
            });

            // Leave Room button
            document.getElementById('leave-room-btn').addEventListener('click', () => {
                this.leaveRoom();
            });

            // Name input modal
            document.getElementById('name-confirm-btn').addEventListener('click', () => {
                this.confirmNameInput();
            });

            document.getElementById('name-cancel-btn').addEventListener('click', () => {
                this.cancelNameInput();
            });

            document.getElementById('player-name-input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.confirmNameInput();
                }
            });

            // Multiplayer leave button (during game)
            document.getElementById('mp-leave-btn').addEventListener('click', () => {
                this.confirmLeaveMultiplayer();
            });

            // Swap buttons for team assignment (host only)
            document.querySelectorAll('.swap-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const slot = e.target.closest('.player-slot');
                    if (slot) {
                        const position = parseInt(slot.dataset.position);
                        this.handleSwapPlayer(position);
                    }
                });
            });

            // Sponsor click handlers - show "cloud time" message
            const drinkSponsor = document.getElementById('drink-sponsor');
            const foodSponsor = document.getElementById('food-sponsor');
            const tableSponsor = document.getElementById('table-sponsor');

            if (drinkSponsor) {
                drinkSponsor.addEventListener('click', () => {
                    this.renderer.showSponsorMessage('Cloud Time ☁️', 'Refreshing Coke - Take a sip and relax!');
                });
            }

            if (foodSponsor) {
                foodSponsor.addEventListener('click', () => {
                    this.renderer.showSponsorMessage('Cloud Time ☁️', 'Crispy Chips - Crunch while you play!');
                });
            }

            if (tableSponsor) {
                tableSponsor.addEventListener('click', () => {
                    this.renderer.showSponsorMessage('Ooredoo Maldives 📶', 'Stay connected with the best network!');
                });
            }

            // Lobby sponsor click handlers - show detailed popup
            const matchmakingSponsor = document.getElementById('matchmaking-sponsor');
            const waitingRoomSponsor = document.getElementById('waiting-room-sponsor');

            if (matchmakingSponsor) {
                matchmakingSponsor.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.renderer.showSponsorDetails();
                });
            }

            if (waitingRoomSponsor) {
                waitingRoomSponsor.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.renderer.showSponsorDetails();
                });
            }
        }

        // Show drink callout (appears at 3 cards played)
        showDrinkCallout() {
            if (!this.drinkCalloutShown) {
                this.drinkCalloutShown = true;
                const callout = document.getElementById('drink-callout');
                if (callout) {
                    callout.classList.remove('hidden');
                    // Auto-hide after 4 seconds
                    setTimeout(() => callout.classList.add('hidden'), 4000);
                }
            }
        }

        // Show food callout (appears at 7 cards played)
        showFoodCallout() {
            if (!this.foodCalloutShown) {
                this.foodCalloutShown = true;
                const callout = document.getElementById('food-callout');
                if (callout) {
                    callout.classList.remove('hidden');
                    // Auto-hide after 4 seconds
                    setTimeout(() => callout.classList.add('hidden'), 4000);
                }
            }
        }

        // Show table callout (appears at 10 cards played)
        showTableCallout() {
            if (!this.tableCalloutShown) {
                this.tableCalloutShown = true;
                const callout = document.getElementById('table-callout');
                if (callout) {
                    callout.classList.remove('hidden');
                    // Auto-hide after 4 seconds
                    setTimeout(() => callout.classList.add('hidden'), 4000);
                }
            }
        }

        // Check card count and show appropriate callouts
        checkSponsorCallouts(cardsPlayed) {
            if (cardsPlayed === 3) {
                this.showDrinkCallout();
            } else if (cardsPlayed === 7) {
                this.showFoodCallout();
            } else if (cardsPlayed === 10) {
                this.showTableCallout();
            }
        }

        // Reset sponsor callout flags for new game
        resetSponsorTooltips() {
            this.drinkCalloutShown = false;
            this.foodCalloutShown = false;
            this.tableCalloutShown = false;
            // Hide any visible callouts
            const drinkCallout = document.getElementById('drink-callout');
            const foodCallout = document.getElementById('food-callout');
            const tableCallout = document.getElementById('table-callout');
            if (drinkCallout) drinkCallout.classList.add('hidden');
            if (foodCallout) foodCallout.classList.add('hidden');
            if (tableCallout) tableCallout.classList.add('hidden');
        }

        // Start random jumping animation for food items
        startFoodItemJumps() {
            if (this.jumpInterval) return;

            const drinkItem = document.querySelector('.drink-item');
            const foodItem = document.querySelector('.food-item');

            const triggerJump = (item) => {
                if (item) {
                    item.classList.add('jumping');
                    setTimeout(() => item.classList.remove('jumping'), 400);
                }
            };

            // Random jumps every 3-8 seconds
            const scheduleNextJump = () => {
                const delay = 3000 + Math.random() * 5000;
                this.jumpTimeout = setTimeout(() => {
                    // Randomly pick drink or food
                    if (Math.random() < 0.5) {
                        triggerJump(drinkItem);
                    } else {
                        triggerJump(foodItem);
                    }
                    scheduleNextJump();
                }, delay);
            };

            scheduleNextJump();
        }

        // Stop food item jumps
        stopFoodItemJumps() {
            if (this.jumpTimeout) {
                clearTimeout(this.jumpTimeout);
                this.jumpTimeout = null;
            }
        }

        // Handle swap player button click
        async handleSwapPlayer(position) {
            if (!this.lobbyManager || !this.lobbyManager.isHost()) return;

            try {
                await this.lobbyManager.swapPlayerTeam(position);
            } catch (error) {
                console.error('Error swapping player:', error);
                this.showError(error.message || 'Failed to swap player');
            }
        }

        // Show name input modal
        showNameInput(callback) {
            this.nameInputCallback = callback;
            this.nameInputModal.classList.remove('hidden');
            const input = document.getElementById('player-name-input');
            input.value = this.playerName || '';
            input.focus();
            input.select();
        }

        confirmNameInput() {
            const input = document.getElementById('player-name-input');
            const name = input.value.trim();

            if (name.length < 1) {
                this.showError('Please enter a name');
                return;
            }

            if (name.length > 10) {
                this.showError('Name must be 10 characters or less');
                return;
            }

            this.savePlayerName(name);
            this.nameInputModal.classList.add('hidden');

            if (this.nameInputCallback) {
                this.nameInputCallback(name);
                this.nameInputCallback = null;
            }
        }

        cancelNameInput() {
            this.nameInputModal.classList.add('hidden');
            this.nameInputCallback = null;
        }

        // Show error message in lobby
        showError(message) {
            this.lobbyError.textContent = message;
            this.lobbyError.classList.remove('hidden');
            setTimeout(() => {
                this.lobbyError.classList.add('hidden');
            }, 5000);
        }

        // Hide error
        hideError() {
            this.lobbyError.classList.add('hidden');
        }

        // Start single player game
        startSinglePlayerGame() {
            this.isMultiplayerMode = false;
            document.getElementById('game-container').classList.remove('multiplayer-mode');
            this.game.resetToSinglePlayer();
            this.hideLobby();
            this.hideMultiplayerStatus();
            this.startNewMatch();
        }

        // ===========================================
        // QUICK MATCH / MATCHMAKING
        // ===========================================

        async handleQuickMatch() {
            // Check for name first
            if (!this.playerName) {
                this.showNameInput((name) => this.joinMatchmakingQueue(name));
                return;
            }
            await this.joinMatchmakingQueue(this.playerName);
        }

        async joinMatchmakingQueue(playerName) {
            try {
                // Initialize multiplayer if needed
                if (!isMultiplayerAvailable()) {
                    if (!initializeMultiplayer()) {
                        this.showError('Could not connect to server');
                        return;
                    }
                    // Wait for connection
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
                        const checkConnection = () => {
                            if (isMultiplayerAvailable()) {
                                clearTimeout(timeout);
                                resolve();
                            } else {
                                setTimeout(checkConnection, 100);
                            }
                        };
                        checkConnection();
                    });
                }

                // Show matchmaking screen
                this.showMatchmakingScreen();

                // Set up socket listeners for matchmaking
                this.setupMatchmakingListeners();

                // Join the queue
                socket.emit('join_queue', { playerName });

            } catch (error) {
                console.error('Error joining matchmaking:', error);
                this.showError(error.message || 'Failed to join matchmaking');
                this.hideMatchmakingScreen();
            }
        }

        setupMatchmakingListeners() {
            if (!socket) return;

            // Queue joined confirmation
            socket.on('queue_joined', (data) => {
                console.log('Joined queue:', data);
                this.updateQueueCount(data.playersInQueue);
            });

            // Queue updates
            socket.on('queue_update', (data) => {
                console.log('Queue update:', data);
                this.updateQueueCount(data.playersInQueue);
            });

            // Match found!
            socket.on('match_found', (data) => {
                console.log('Match found!', data);
                this.onMatchFound(data);
            });

            // Left queue
            socket.on('queue_left', () => {
                console.log('Left queue');
            });
        }

        cleanupMatchmakingListeners() {
            if (!socket) return;
            socket.off('queue_joined');
            socket.off('queue_update');
            socket.off('match_found');
            socket.off('queue_left');
        }

        showMatchmakingScreen() {
            this.lobbyMenu.classList.add('hidden');
            this.waitingRoom.classList.add('hidden');
            document.getElementById('matchmaking-screen').classList.remove('hidden');
            this.updateQueueCount(1); // At least ourselves
        }

        hideMatchmakingScreen() {
            document.getElementById('matchmaking-screen').classList.add('hidden');
            this.lobbyMenu.classList.remove('hidden');
        }

        updateQueueCount(count) {
            const countEl = document.getElementById('queue-count');
            if (countEl) {
                countEl.textContent = count;
            }
        }

        cancelMatchmaking() {
            if (socket) {
                socket.emit('leave_queue');
            }
            this.cleanupMatchmakingListeners();
            this.hideMatchmakingScreen();
        }

        async onMatchFound(data) {
            console.log('onMatchFound called:', data);
            // Clean up matchmaking listeners
            this.cleanupMatchmakingListeners();

            // Show found animation
            const statusEl = document.querySelector('.matchmaking-status');
            if (statusEl) {
                statusEl.classList.add('found');
            }
            document.getElementById('queue-count').textContent = '4';

            // Create lobby manager for this match
            this.lobbyManager = new LobbyManager();
            this.lobbyManager.currentRoomId = data.roomId;
            this.lobbyManager.currentPosition = data.position;
            console.log('LobbyManager created with position:', data.position);

            // Set up callbacks
            this.lobbyManager.onPlayersChanged = (players) => {
                this.updatePlayerSlots(players);
            };

            this.lobbyManager.onGameStart = (gameData) => {
                this.onMultiplayerGameStart(gameData);
            };

            // Set up socket listeners
            this.lobbyManager.setupSocketListeners();

            // Set up presence
            this.presenceManager = new PresenceManager(data.roomId, currentUserId, data.position);
            await this.presenceManager.setupPresence();

            // Check if confirmation is required (quickplay)
            if (data.requiresConfirmation) {
                this.showConfirmationUI(data);
                this.setupConfirmationListeners();
            } else {
                // Original flow for non-confirmation matches
                await this.proceedWithMatch(data);
            }
        }

        showConfirmationUI(data) {
            // Update matchmaking screen to show confirmation
            const matchmakingScreen = document.getElementById('matchmaking-screen');
            const statusText = matchmakingScreen.querySelector('.matchmaking-status');

            if (statusText) {
                statusText.innerHTML = `
                    <div class="match-found-text">Match Found!</div>
                    <div class="confirm-countdown" id="confirm-countdown">30</div>
                    <button class="confirm-match-btn" id="confirm-match-btn">ACCEPT MATCH</button>
                    <div class="confirm-hint">Click to confirm your spot</div>
                `;
            }

            // Start countdown
            let timeLeft = data.confirmTimeout || 30;
            this.confirmCountdown = setInterval(() => {
                timeLeft--;
                const countdownEl = document.getElementById('confirm-countdown');
                if (countdownEl) {
                    countdownEl.textContent = timeLeft;
                    if (timeLeft <= 5) {
                        countdownEl.classList.add('urgent');
                    }
                }
                if (timeLeft <= 0) {
                    clearInterval(this.confirmCountdown);
                }
            }, 1000);

            // Set up confirm button
            const confirmBtn = document.getElementById('confirm-match-btn');
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    this.confirmMatch();
                };
            }

            this.matchData = data;
        }

        confirmMatch() {
            if (socket) {
                socket.emit('confirm_match');
            }

            // Update UI to show confirmed
            const confirmBtn = document.getElementById('confirm-match-btn');
            if (confirmBtn) {
                confirmBtn.textContent = 'CONFIRMED';
                confirmBtn.classList.add('confirmed');
                confirmBtn.disabled = true;
            }
        }

        setupConfirmationListeners() {
            if (!socket) return;

            // Player confirmed
            socket.on('player_confirmed', (data) => {
                console.log('Player confirmed:', data);
                // Could update UI to show who confirmed
            });

            // All players confirmed - proceed to game
            socket.on('all_confirmed', async (data) => {
                console.log('All confirmed!', data);
                this.cleanupConfirmationListeners();
                if (this.confirmCountdown) {
                    clearInterval(this.confirmCountdown);
                }
                await this.proceedWithMatch(this.matchData);
            });

            // Match timed out
            socket.on('match_timeout', (data) => {
                console.log('Match timeout:', data);
                this.cleanupConfirmationListeners();
                if (this.confirmCountdown) {
                    clearInterval(this.confirmCountdown);
                }
                this.showError(data.message || 'Match timed out');
                this.hideMatchmakingScreen();
            });

            // Match cancelled (others didn't confirm)
            socket.on('match_cancelled', (data) => {
                console.log('Match cancelled:', data);
                this.cleanupConfirmationListeners();
                if (this.confirmCountdown) {
                    clearInterval(this.confirmCountdown);
                }
                if (data.requeued) {
                    // Show re-queued message
                    this.showNotification('Requeued - waiting for new match');
                    // Reset matchmaking UI
                    this.setupMatchmakingListeners();
                    const statusText = document.querySelector('.matchmaking-status');
                    if (statusText) {
                        statusText.innerHTML = `
                            <div>Searching for players...</div>
                            <span id="queue-count">1</span><span>/4 players</span>
                        `;
                    }
                } else {
                    this.hideMatchmakingScreen();
                }
            });
        }

        cleanupConfirmationListeners() {
            if (!socket) return;
            socket.off('player_confirmed');
            socket.off('all_confirmed');
            socket.off('match_timeout');
            socket.off('match_cancelled');
        }

        async proceedWithMatch(data) {
            // Brief delay to show "4/4 players" then transition
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Hide matchmaking, show waiting room briefly then auto-start
            document.getElementById('matchmaking-screen').classList.add('hidden');

            // Update player slots
            this.updatePlayerSlots(data.players);

            // Show waiting room briefly
            this.showWaitingRoom(data.roomId);

            // For quick match, the host (position 0 after shuffle) auto-starts the game
            if (data.position === 0) {
                // Small delay to let everyone sync
                await new Promise(resolve => setTimeout(resolve, 500));
                this.startMultiplayerGame();
            }
        }

        // Handle create room
        async handleCreateRoom() {
            // Check for name first
            if (!this.playerName) {
                this.showNameInput((name) => this.createRoom(name));
                return;
            }
            await this.createRoom(this.playerName);
        }

        async createRoom(playerName) {
            try {
                // Initialize multiplayer if needed
                if (!isMultiplayerAvailable()) {
                    if (!initializeMultiplayer()) {
                        this.showError('Could not connect to server');
                        return;
                    }
                    // Wait for connection
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
                        const checkConnection = () => {
                            if (isMultiplayerAvailable()) {
                                clearTimeout(timeout);
                                resolve();
                            } else {
                                setTimeout(checkConnection, 100);
                            }
                        };
                        checkConnection();
                    });
                }

                // Create lobby manager
                this.lobbyManager = new LobbyManager();

                // Set up callbacks
                this.lobbyManager.onPlayersChanged = (players) => {
                    this.updatePlayerSlots(players);
                };

                this.lobbyManager.onGameStart = (data) => {
                    this.onMultiplayerGameStart(data);
                };

                // Create room
                const { roomId, position } = await this.lobbyManager.createRoom(playerName);

                // Show waiting room
                this.showWaitingRoom(roomId);

                // Set up presence
                this.presenceManager = new PresenceManager(roomId, currentUserId, position);
                await this.presenceManager.setupPresence();

            } catch (error) {
                console.error('Error creating room:', error);
                this.showError(error.message || 'Failed to create room');
            }
        }

        // Handle join room
        async handleJoinRoom() {
            const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();

            if (!roomCode || roomCode.length !== 6) {
                this.showError('Please enter a valid 6-character room code');
                return;
            }

            // Check for name first
            if (!this.playerName) {
                this.showNameInput((name) => this.joinRoom(roomCode, name));
                return;
            }

            await this.joinRoom(roomCode, this.playerName);
        }

        async joinRoom(roomCode, playerName) {
            try {
                // Initialize multiplayer if needed
                if (!isMultiplayerAvailable()) {
                    if (!initializeMultiplayer()) {
                        this.showError('Could not connect to server');
                        return;
                    }
                    // Wait for connection
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
                        const checkConnection = () => {
                            if (isMultiplayerAvailable()) {
                                clearTimeout(timeout);
                                resolve();
                            } else {
                                setTimeout(checkConnection, 100);
                            }
                        };
                        checkConnection();
                    });
                }

                // Create lobby manager
                this.lobbyManager = new LobbyManager();

                // Set up callbacks
                this.lobbyManager.onPlayersChanged = (players) => {
                    this.updatePlayerSlots(players);
                };

                this.lobbyManager.onGameStart = (data) => {
                    this.onMultiplayerGameStart(data);
                };

                // Join room
                const result = await this.lobbyManager.joinRoom(roomCode, playerName);

                // Show waiting room
                this.showWaitingRoom(result.roomId);

                // Set up presence
                this.presenceManager = new PresenceManager(result.roomId, currentUserId, result.position);
                await this.presenceManager.setupPresence();

            } catch (error) {
                console.error('Error joining room:', error);
                this.showError(error.message || 'Failed to join room');
            }
        }

        // Show spectator mode UI
        showSpectatorMode(roomId, players, gameState) {
            // Hide lobby
            this.lobbyOverlay.classList.add('hidden');

            // Show game board in spectator mode
            this.isSpectator = true;

            // Show spectator notification
            this.showNotification('Watching as spectator');

            // If game state exists, sync the game view
            if (gameState) {
                // Start a spectator game view
                this.startSpectatorGame(players, gameState);
            }
        }

        // Resume game as replacement for disconnected player
        async resumeAsReplacement(result) {
            // Hide lobby
            this.lobbyOverlay.classList.add('hidden');

            // Set up presence
            this.presenceManager = new PresenceManager(result.roomId, currentUserId, result.position);
            await this.presenceManager.setupPresence();

            // Show notification
            this.showNotification('Rejoined game');

            // Start multiplayer game with existing state
            const gameData = {
                gameState: result.gameState,
                hands: result.hands,
                players: result.players
            };

            this.onMultiplayerGameStart(gameData, result.position);
        }

        // Start spectator game view
        startSpectatorGame(players, gameState) {
            // Initialize game in spectator mode
            this.game = new Game();
            this.game.isMultiplayer = true;
            this.game.isSpectator = true;

            // Set up sync manager for receiving updates
            this.syncManager = new GameSyncManager(
                this.lobbyManager.getRoomId(),
                currentUserId,
                -1  // Spectator position
            );
            this.game.syncManager = this.syncManager;

            // Listen for remote card plays
            this.syncManager.onRemoteCardPlayed = (card, position) => {
                // Update game view
                this.handleRemoteCardPlay(card, position);
            };

            this.syncManager.startListening();

            // Render initial state
            this.renderGame();
        }

        // Update spectator count display
        updateSpectatorCount(spectators) {
            const count = Object.keys(spectators || {}).length;
            let spectatorDisplay = document.getElementById('spectator-count');

            if (!spectatorDisplay) {
                spectatorDisplay = document.createElement('div');
                spectatorDisplay.id = 'spectator-count';
                spectatorDisplay.className = 'spectator-count';
                document.body.appendChild(spectatorDisplay);
            }

            if (count > 0) {
                spectatorDisplay.textContent = `👁 ${count} watching`;
                spectatorDisplay.classList.remove('hidden');
            } else {
                spectatorDisplay.classList.add('hidden');
            }
        }

        // Show notification
        showNotification(message) {
            let notification = document.getElementById('game-notification');

            if (!notification) {
                notification = document.createElement('div');
                notification.id = 'game-notification';
                notification.className = 'game-notification';
                document.body.appendChild(notification);
            }

            notification.textContent = message;
            notification.classList.remove('hidden');
            notification.classList.add('show');

            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => {
                    notification.classList.add('hidden');
                }, 300);
            }, 3000);
        }

        // Show waiting room UI
        showWaitingRoom(roomId) {
            // Hide game selection and lobby menu
            const gameSelection = document.getElementById('game-selection');
            const gameLobby = document.getElementById('game-lobby');
            if (gameSelection) gameSelection.classList.add('hidden');
            if (gameLobby) gameLobby.classList.add('hidden');
            this.lobbyMenu.classList.add('hidden');
            this.waitingRoom.classList.remove('hidden');
            document.getElementById('room-code-display').textContent = roomId;

            const isHost = this.lobbyManager && this.lobbyManager.isHost();

            // Show/hide start button based on host status
            const startBtn = document.getElementById('start-game-btn');
            if (isHost) {
                startBtn.classList.remove('hidden');
            } else {
                startBtn.classList.add('hidden');
            }

            // Show/hide host hint for team assignment
            const hostHint = document.getElementById('host-team-hint');
            if (isHost) {
                hostHint.classList.remove('hidden');
            } else {
                hostHint.classList.add('hidden');
            }

            // Reset ready button
            const readyBtn = document.getElementById('ready-btn');
            readyBtn.classList.remove('ready');
            readyBtn.textContent = 'Ready';
        }

        // Update player slots in waiting room
        updatePlayerSlots(players) {
            const slots = document.querySelectorAll('.player-slot');
            const localPosition = this.lobbyManager ? this.lobbyManager.getPosition() : null;
            const isHost = this.lobbyManager && this.lobbyManager.isHost();

            let filledCount = 0;
            let allReady = true;

            slots.forEach((slot) => {
                const position = parseInt(slot.dataset.position);
                const player = players[position];

                slot.classList.remove('filled', 'ready', 'you');

                const statusSpan = slot.querySelector('.slot-status');
                const nameSpan = slot.querySelector('.slot-name');
                const readySpan = slot.querySelector('.slot-ready');
                const swapBtn = slot.querySelector('.swap-btn');

                if (player) {
                    filledCount++;
                    slot.classList.add('filled');

                    if (position === localPosition) {
                        slot.classList.add('you');
                    }

                    if (player.ready) {
                        slot.classList.add('ready');
                        readySpan.textContent = 'READY';
                    } else {
                        readySpan.textContent = '';
                        allReady = false;
                    }

                    statusSpan.textContent = position === 0 ? 'Host' : 'Player';
                    nameSpan.textContent = player.name || 'Unknown';

                    // Show swap button for host (can swap any non-host player)
                    if (swapBtn) {
                        if (isHost && position !== 0) {
                            swapBtn.classList.remove('hidden');
                        } else {
                            swapBtn.classList.add('hidden');
                        }
                    }
                } else {
                    statusSpan.textContent = 'Waiting...';
                    nameSpan.textContent = '';
                    readySpan.textContent = '';
                    allReady = false;

                    // Hide swap button for empty slots
                    if (swapBtn) {
                        swapBtn.classList.add('hidden');
                    }
                }
            });

            // Enable/disable start button for host
            const startBtn = document.getElementById('start-game-btn');
            if (isHost) {
                startBtn.disabled = !(filledCount === 4 && allReady);
            }
        }

        // Copy room code to clipboard
        async copyRoomCode() {
            const roomCode = document.getElementById('room-code-display').textContent;
            const copyBtn = document.getElementById('copy-code-btn');

            try {
                await navigator.clipboard.writeText(roomCode);
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = 'Copy';
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        }

        // Toggle ready status
        async toggleReady() {
            if (!this.lobbyManager) return;

            const readyBtn = document.getElementById('ready-btn');
            const isReady = readyBtn.classList.toggle('ready');

            readyBtn.textContent = isReady ? 'Not Ready' : 'Ready';

            await this.lobbyManager.setReady(isReady);
        }

        // Start multiplayer game (host only)
        async startMultiplayerGame() {
            if (!this.lobbyManager || !this.lobbyManager.isHost()) return;

            try {
                // Create a temporary game to deal cards
                this.game.startNewMatch();

                // Prepare initial game state
                const initialState = {
                    currentPlayerIndex: 0,
                    trickNumber: 0,
                    superiorSuit: null,
                    tricksWon: [0, 0],
                    tensCollected: [0, 0],
                    matchPoints: [0, 0],
                    roundOver: false,
                    matchOver: false
                };

                // Prepare hands data
                const handsData = {};
                this.game.players.forEach((player, index) => {
                    handsData[index] = player.hand.map(card => ({
                        suit: card.suit,
                        rank: card.rank
                    }));
                });

                await this.lobbyManager.startGame(initialState, handsData);
            } catch (error) {
                console.error('Error starting game:', error);
                this.showError(error.message || 'Failed to start game');
            }
        }

        // Called when multiplayer game starts
        async onMultiplayerGameStart(data) {
            console.log('onMultiplayerGameStart called with data:', data);
            this.isMultiplayerMode = true;
            document.getElementById('game-container').classList.add('multiplayer-mode');
            const roomId = this.lobbyManager.getRoomId();
            const localPosition = this.lobbyManager.getPosition();
            console.log('Room:', roomId, 'Local position:', localPosition);

            // Get player names from start data
            const players = data.players;
            const playerNames = {};
            for (let i = 0; i < 4; i++) {
                if (players && players[i]) {
                    playerNames[i] = players[i].name;
                }
            }
            console.log('Player names:', playerNames);

            // Create sync manager
            this.syncManager = new GameSyncManager(roomId, currentUserId, localPosition);
            await this.syncManager.initialize();

            // Set up game for multiplayer
            this.game.setMultiplayerMode(this.syncManager, localPosition, playerNames);

            // Reset game state to initial state from server
            if (data.gameState) {
                this.game.currentPlayerIndex = data.gameState.currentPlayerIndex || 0;
                this.game.trickNumber = data.gameState.trickNumber || 0;
                this.game.superiorSuit = data.gameState.superiorSuit || null;
                this.game.tricksWon = data.gameState.tricksWon || [0, 0];
                this.game.tensCollected = data.gameState.tensCollected || [0, 0];
                this.game.matchPoints = data.gameState.matchPoints || [0, 0];
                this.game.roundOver = false;
                this.game.matchOver = false;
            }

            // Reconstruct hands from server data for ALL players (including host)
            // This is needed because setMultiplayerMode reinitializes players
            this.reconstructHandsFromData(data.hands);

            // Reset the current trick
            this.game.currentTrick = new Trick();

            console.log('Game state after setup:', {
                isMultiplayer: this.game.isMultiplayer,
                localPosition: this.game.localPlayerPosition,
                currentPlayer: this.game.currentPlayerIndex,
                isLocalTurn: this.game.isLocalPlayerTurn()
            });

            // Set up round started listener for subsequent rounds
            this.syncManager.onRoundStarted = (gameState, hands) => {
                this.handleNewRound(gameState, hands);
            };

            // Start listening for remote actions
            this.syncManager.startListening();

            // Set up listener for all players ready for next round
            if (socket) {
                socket.on('all_ready_for_round', (data) => {
                    console.log('All players ready for next round');
                    this.onAllReadyForRound(data);
                });

                // Set up listener for player leaving game
                socket.on('player_left_game', (data) => {
                    console.log('Player left game:', data);
                    this.onPlayerLeftGame(data);
                });
            }

            // Hide lobby, show game
            this.hideLobby();
            this.showMultiplayerStatus(roomId);
            this.startGameTimer();
            this.updateDisplay();
        }

        // Reconstruct hands from server data
        reconstructHandsFromData(handsData) {
            if (!handsData) return;

            for (let i = 0; i < 4; i++) {
                if (handsData[i]) {
                    const cards = handsData[i].map(c => new Card(c.suit, c.rank));
                    this.game.players[i].setHand(cards);
                }
            }
            this.game.currentTrick = new Trick();
        }

        // Handle new round from host
        handleNewRound(gameState, hands) {
            this.reconstructHandsFromData(hands);

            // Update game state
            this.game.currentPlayerIndex = gameState.currentPlayerIndex || 0;
            this.game.trickNumber = gameState.trickNumber || 0;
            this.game.superiorSuit = gameState.superiorSuit || null;
            this.game.tricksWon = gameState.tricksWon || [0, 0];
            this.game.tensCollected = gameState.tensCollected || [0, 0];
            this.game.matchPoints = gameState.matchPoints || [0, 0];
            this.game.roundOver = false;
            this.game.currentTrick = new Trick();

            this.updateDisplay();
        }


        // Leave room
        async leaveRoom() {
            if (this.presenceManager) {
                this.presenceManager.cleanup();
                this.presenceManager = null;
            }

            if (this.lobbyManager) {
                await this.lobbyManager.leaveRoom();
                this.lobbyManager = null;
            }

            // Show game lobby menu (parent container must be visible too)
            this.waitingRoom.classList.add('hidden');
            document.getElementById('matchmaking-screen').classList.add('hidden');
            document.getElementById('game-lobby').classList.remove('hidden');
            this.lobbyMenu.classList.remove('hidden');
            document.getElementById('room-code-input').value = '';
        }

        // Confirm leaving multiplayer game
        async confirmLeaveMultiplayer() {
            if (confirm('Are you sure you want to leave the game?')) {
                await this.cleanupMultiplayer();
                this.showLobby();
            }
        }

        // Cleanup multiplayer
        async cleanupMultiplayer() {
            // Clean up socket listeners
            if (socket) {
                socket.off('all_ready_for_round');
                socket.off('player_left_game');
            }

            if (this.syncManager) {
                this.syncManager.cleanup();
                this.syncManager = null;
            }

            if (this.presenceManager) {
                this.presenceManager.cleanup();
                this.presenceManager = null;
            }

            if (this.lobbyManager) {
                await this.lobbyManager.leaveRoom();
                this.lobbyManager = null;
            }

            this.isMultiplayerMode = false;
            this.game.resetToSinglePlayer();
            this.hideMultiplayerStatus();
        }

        // Show game selection screen
        showGameSelection() {
            const gameSelection = document.getElementById('game-selection');
            const gameLobby = document.getElementById('game-lobby');

            if (gameSelection) gameSelection.classList.remove('hidden');
            if (gameLobby) gameLobby.classList.add('hidden');

            this.waitingRoom.classList.add('hidden');
            this.nameInputModal.classList.add('hidden');
            document.getElementById('matchmaking-screen').classList.add('hidden');
            this.hideError();
        }

        // Select a game and show its lobby
        selectGame(gameName) {
            const gameSelection = document.getElementById('game-selection');
            const gameLobby = document.getElementById('game-lobby');
            const selectedGameTitle = document.getElementById('selected-game-title');
            const currentGameName = document.getElementById('current-game-name');

            this.selectedGame = gameName;

            // Update titles based on selected game
            if (gameName === 'dhiha-ei') {
                if (selectedGameTitle) selectedGameTitle.textContent = 'Dhiha Ei';
                if (currentGameName) currentGameName.textContent = 'Dhiha Ei';
            } else if (gameName === 'digu') {
                if (selectedGameTitle) selectedGameTitle.textContent = 'Digu';
                if (currentGameName) currentGameName.textContent = 'Digu';
            }

            // Hide game selection, show game lobby with menu
            if (gameSelection) gameSelection.classList.add('hidden');
            if (gameLobby) gameLobby.classList.remove('hidden');
            this.lobbyMenu.classList.remove('hidden');
            this.waitingRoom.classList.add('hidden');
            document.getElementById('matchmaking-screen').classList.add('hidden');

            // Check if this is first load and prompt for name
            if (!this.playerName) {
                this.showNameInput((name) => {
                    // Name saved, continue showing lobby
                });
            }
        }

        // Show lobby overlay
        showLobby() {
            // Hide game container
            document.getElementById('game-container').classList.add('hidden');
            document.getElementById('game-container').classList.remove('multiplayer-mode');

            // Show lobby
            this.lobbyOverlay.classList.remove('hidden');
            this.showGameSelection();
        }

        // Hide lobby overlay
        hideLobby() {
            this.lobbyOverlay.classList.add('hidden');
            document.getElementById('game-container').classList.remove('hidden');
        }

        // Show multiplayer status bar
        showMultiplayerStatus(roomCode) {
            this.multiplayerStatus.classList.remove('hidden');
            document.getElementById('mp-room-code').textContent = roomCode;
        }

        // Hide multiplayer status bar
        hideMultiplayerStatus() {
            this.multiplayerStatus.classList.add('hidden');
            this.stopGameTimer();
        }

        // Start game timer for multiplayer
        startGameTimer() {
            this.gameTimeRemaining = 15 * 60; // 15 minutes
            this.timerWarningShown = false;
            this.timerCriticalShown = false;

            const timerEl = document.getElementById('mp-timer');
            const timerValue = document.getElementById('mp-timer-value');
            timerEl.classList.remove('hidden', 'warning', 'critical');

            this.updateTimerDisplay();

            this.gameTimer = setInterval(() => {
                this.gameTimeRemaining--;
                this.updateTimerDisplay();

                // Warning at 2 minutes
                if (this.gameTimeRemaining === 120 && !this.timerWarningShown) {
                    this.timerWarningShown = true;
                    timerEl.classList.add('warning');
                    this.renderer.flashMessage('⚠️ 2 minutes remaining!', 3000);
                }

                // Critical at 30 seconds
                if (this.gameTimeRemaining === 30 && !this.timerCriticalShown) {
                    this.timerCriticalShown = true;
                    timerEl.classList.remove('warning');
                    timerEl.classList.add('critical');
                    this.renderer.flashMessage('⚠️ 30 seconds remaining!', 2000);
                }

                // Time's up
                if (this.gameTimeRemaining <= 0) {
                    this.stopGameTimer();
                    this.handleTimeUp();
                }
            }, 1000);
        }

        // Update timer display
        updateTimerDisplay() {
            const timerValue = document.getElementById('mp-timer-value');
            const minutes = Math.floor(this.gameTimeRemaining / 60);
            const seconds = this.gameTimeRemaining % 60;
            timerValue.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        // Stop game timer
        stopGameTimer() {
            if (this.gameTimer) {
                clearInterval(this.gameTimer);
                this.gameTimer = null;
            }
            const timerEl = document.getElementById('mp-timer');
            if (timerEl) {
                timerEl.classList.add('hidden');
                timerEl.classList.remove('warning', 'critical');
            }
        }

        // Handle time up
        async handleTimeUp() {
            const state = this.game.getGameState();
            const team0Points = state.matchPoints[0];
            const team1Points = state.matchPoints[1];

            let winner, message;
            if (team0Points > team1Points) {
                winner = 'Your Team';
                message = `Time's up! Your team wins ${team0Points} - ${team1Points}!`;
            } else if (team1Points > team0Points) {
                winner = 'Opponent Team';
                message = `Time's up! Opponents win ${team1Points} - ${team0Points}!`;
            } else {
                winner = 'Draw';
                message = `Time's up! It's a draw at ${team0Points} - ${team1Points}!`;
            }

            await this.renderer.showMessage('⏱️ Time Up!', message, 'Back to Lobby');
            this.leaveMultiplayerGame();
        }

        // Update multiplayer turn indicator
        updateMultiplayerTurnIndicator() {
            const turnIndicator = document.getElementById('mp-turn-indicator');
            const localPosition = this.game.localPlayerPosition;
            const positionMap = this.getMultiplayerPositionMap(localPosition);

            // Remove active-turn from all player areas
            document.querySelectorAll('.player-area').forEach(area => {
                area.classList.remove('active-turn');
            });

            if (this.game.isLocalPlayerTurn()) {
                turnIndicator.textContent = 'Your Turn';
                turnIndicator.classList.add('your-turn');
                // Highlight player's own area
                document.getElementById('player-bottom').classList.add('active-turn');
            } else {
                const currentPlayer = this.game.players[this.game.currentPlayerIndex];
                const name = currentPlayer.name || `Player ${this.game.currentPlayerIndex + 1}`;
                turnIndicator.textContent = `${name}'s Turn`;
                turnIndicator.classList.remove('your-turn');

                // Highlight the current player's avatar
                const screenPos = positionMap[this.game.currentPlayerIndex];
                const screenPosIds = { 1: 'player-left', 2: 'player-top', 3: 'player-right' };
                if (screenPosIds[screenPos]) {
                    document.getElementById(screenPosIds[screenPos]).classList.add('active-turn');
                }
            }
        }

        bindGameEvents() {
            this.game.onStateChange = (state) => this.handleStateChange(state);
            this.game.onCardPlayed = (card, player) => this.handleCardPlayed(card, player);
            this.game.onTrickComplete = (winner, trick, tens) => this.handleTrickComplete(winner, trick, tens);
            this.game.onRoundOver = (result) => this.handleRoundOver(result);
            this.game.onMatchOver = (winner, points) => this.handleMatchOver(winner, points);
            this.game.onSuperiorSuitEstablished = (suit, player) => this.handleSuperiorSuit(suit, player);
        }

        async startNewMatch() {
            this.isProcessing = false;
            this.selectedCard = null;
            this.humanCardsPlayedThisGame = 0;
            this.resetSponsorTooltips();
            this.startFoodItemJumps();
            this.game.startNewMatch();
            this.renderer.clearPlayedCards();
            this.renderer.clearCollectedTens();
            this.renderer.updateSuperiorSuit(null);
            this.renderer.updateMatchPoints([0, 0]);
            this.renderer.updateWinTypeCounts([
                { normal: 0, 'all-tens': 0, shutout: 0 },
                { normal: 0, 'all-tens': 0, shutout: 0 }
            ]);
            this.updateDisplay();

            await this.game.continueGame();
        }

        async startNextRound() {
            this.isProcessing = false;
            this.selectedCard = null;
            this.game.startRound();
            this.renderer.clearPlayedCards();
            this.renderer.clearCollectedTens();
            this.renderer.updateSuperiorSuit(null);
            this.updateDisplay();

            await this.game.continueGame();
        }

        updateDisplay() {
            const state = this.game.getGameState();

            if (this.isMultiplayerMode) {
                // In multiplayer, show valid cards only for local player on their turn
                const isLocalTurn = this.game.isLocalPlayerTurn();
                const validCards = isLocalTurn ? this.game.getValidCards() : [];

                console.log('updateDisplay multiplayer:', {
                    isMultiplayerMode: this.isMultiplayerMode,
                    isMultiplayer: this.game.isMultiplayer,
                    localPosition: this.game.localPlayerPosition,
                    currentPlayer: this.game.currentPlayerIndex,
                    isLocalTurn,
                    validCardsCount: validCards.length
                });

                this.renderMultiplayerHands(validCards, (card) => this.handleCardClick(card));
                this.updateMultiplayerTurnIndicator();
            } else {
                // Single player mode
                const isHumanTurn = this.game.isHumanTurn();
                const validCards = isHumanTurn ? this.game.getValidCards() : [];

                // Hide sponsor popup when it's user's turn
                if (isHumanTurn) {
                    this.renderer.hideSponsorMessage();
                }

                this.renderer.renderAllHands(
                    this.game.players,
                    validCards,
                    (card) => this.handleCardClick(card),
                    this.selectedCard
                );
            }

            this.renderer.updateScores(state.tricksWon, state.tensCollected);
            this.renderer.updateMatchPoints(state.matchPoints);
            this.renderer.updateWinTypeCounts(state.winTypeCount);
            this.renderer.updateCollectedTens(state.collectedTensCards);
            this.renderer.updateSuperiorSuit(state.superiorSuit);
            this.renderer.showTurnIndicator(state.currentPlayer, this.game.isLocalPlayerTurn());

            // Always update avatars (works for both single and multiplayer)
            if (this.isMultiplayerMode) {
                this.updatePlayerLabels();
            } else {
                this.updateSinglePlayerAvatars();
            }
        }

        // Update avatars for single player mode (AI opponents)
        updateSinglePlayerAvatars() {
            // In single player: position 0=bottom (human), 1=left, 2=top (partner), 3=right
            const screenPosMap = {
                1: { area: 'player-left', pos: 1 },
                2: { area: 'player-top', pos: 2 },
                3: { area: 'player-right', pos: 3 }
            };

            // Remove active-turn from all
            document.querySelectorAll('.player-area').forEach(area => {
                area.classList.remove('active-turn');
            });

            // Highlight current player
            const currentPos = this.game.currentPlayerIndex;
            if (currentPos === 0) {
                document.getElementById('player-bottom').classList.add('active-turn');
            } else if (screenPosMap[currentPos]) {
                document.getElementById(screenPosMap[currentPos].area).classList.add('active-turn');
            }

            // Update each AI player's avatar
            for (const [gamePos, mapping] of Object.entries(screenPosMap)) {
                const player = this.game.players[parseInt(gamePos)];
                const areaId = mapping.area;

                const avatarIcon = document.querySelector(`#${areaId} .avatar-icon`);
                const cardCount = document.querySelector(`#${areaId} .card-count`);
                const label = document.querySelector(`#${areaId} .player-label`);

                if (avatarIcon && player) {
                    avatarIcon.textContent = player.name.charAt(0).toUpperCase();
                }
                if (cardCount && player) {
                    cardCount.textContent = player.hand.length;
                }
                if (label && player) {
                    label.textContent = player.name;
                }
            }
        }

        // Render hands in multiplayer mode
        renderMultiplayerHands(validCards, onCardClick) {
            const localPosition = this.game.localPlayerPosition;

            // Determine screen positions based on local player's position
            // Local player is always at bottom
            const positionMap = this.getMultiplayerPositionMap(localPosition);

            for (let i = 0; i < 4; i++) {
                const player = this.game.players[i];
                const screenPosition = positionMap[i];
                const handElement = this.getHandElementByScreenPosition(screenPosition);

                handElement.innerHTML = '';

                const isLocal = i === localPosition;

                // Only render cards for local player - opponents/partner show avatars with card counts
                if (!isLocal) {
                    continue;
                }

                player.hand.forEach(card => {
                    const cardElement = CardSprite.createCardElement(card, true);

                    if (validCards.length > 0) {
                        const isValid = validCards.some(c => c.equals(card));
                        CardSprite.setPlayable(cardElement, isValid);

                        if (isValid && onCardClick) {
                            cardElement.addEventListener('click', () => onCardClick(card));
                        }
                    }

                    handElement.appendChild(cardElement);
                });
            }
        }

        // Map game positions to screen positions based on local player
        getMultiplayerPositionMap(localPosition) {
            // Returns: { gamePosition: screenPosition }
            // Screen positions: 0=bottom, 1=left, 2=top, 3=right
            // Game positions follow counter-clockwise: 0 → 3 → 2 → 1 → 0

            const map = {};
            for (let i = 0; i < 4; i++) {
                // Calculate relative position from local player
                const relativePos = (i - localPosition + 4) % 4;
                // Map to screen position
                // 0 (self) -> bottom (0)
                // 1 (right of self) -> right (3)
                // 2 (across) -> top (2)
                // 3 (left of self) -> left (1)
                const screenPosMap = [0, 3, 2, 1];
                map[i] = screenPosMap[relativePos];
            }
            return map;
        }

        getHandElementByScreenPosition(screenPos) {
            const elements = {
                0: document.getElementById('hand-bottom'),
                1: document.getElementById('hand-left'),
                2: document.getElementById('hand-top'),
                3: document.getElementById('hand-right')
            };
            return elements[screenPos];
        }

        // Update player labels with actual names
        updatePlayerLabels() {
            const localPosition = this.game.localPlayerPosition;
            const positionMap = this.getMultiplayerPositionMap(localPosition);

            const labels = {
                0: document.querySelector('#player-bottom .player-label'),
                1: document.querySelector('#player-left .player-label'),
                2: document.querySelector('#player-top .player-label'),
                3: document.querySelector('#player-right .player-label')
            };

            const avatarIcons = {
                1: document.querySelector('#player-left .avatar-icon'),
                2: document.querySelector('#player-top .avatar-icon'),
                3: document.querySelector('#player-right .avatar-icon')
            };

            const cardCounts = {
                1: document.querySelector('#player-left .card-count'),
                2: document.querySelector('#player-top .card-count'),
                3: document.querySelector('#player-right .card-count')
            };

            for (let i = 0; i < 4; i++) {
                const screenPos = positionMap[i];
                const label = labels[screenPos];
                const player = this.game.players[i];

                if (label) {
                    if (i === localPosition) {
                        label.textContent = 'You';
                    } else {
                        const name = player.name || `Player ${i + 1}`;
                        label.textContent = name;

                        // Update avatar icon with first letter
                        if (avatarIcons[screenPos]) {
                            avatarIcons[screenPos].textContent = name.charAt(0).toUpperCase();
                        }

                        // Update card count
                        if (cardCounts[screenPos]) {
                            cardCounts[screenPos].textContent = player.hand.length;
                        }
                    }
                    label.classList.add('mp-name');
                }
            }
        }

        // Update card counts for all opponent/partner avatars
        updateCardCounts() {
            const localPosition = this.game.localPlayerPosition;
            const positionMap = this.getMultiplayerPositionMap(localPosition);

            const cardCounts = {
                1: document.querySelector('#player-left .card-count'),
                2: document.querySelector('#player-top .card-count'),
                3: document.querySelector('#player-right .card-count')
            };

            for (let i = 0; i < 4; i++) {
                if (i === localPosition) continue;

                const screenPos = positionMap[i];
                const player = this.game.players[i];

                if (cardCounts[screenPos]) {
                    cardCounts[screenPos].textContent = player.hand.length;
                }
            }
        }

        async handleCardClick(card) {
            if (this.isProcessing) return;

            // Check if it's the player's turn (handles both single and multiplayer)
            if (this.isMultiplayerMode) {
                if (!this.game.isLocalPlayerTurn()) return;
            } else {
                if (!this.game.isHumanTurn()) return;
            }

            // Check if this card is already selected
            if (this.selectedCard && this.selectedCard.equals(card)) {
                // Second click on same card - play it
                this.isProcessing = true;
                this.selectedCard = null;

                const success = await this.game.playCard(card);

                if (success) {
                    await this.game.continueGame();
                }

                this.isProcessing = false;
            } else {
                // First click or different card - select it
                this.selectedCard = card;
                this.updateDisplay();
            }
        }

        handleStateChange(state) {
            this.updateDisplay();
        }

        handleCardPlayed(card, player) {
            this.renderer.renderPlayedCard(card, player.position);
            this.updateDisplay();

            // Track local player's cards for sponsor callouts (works for both single and multiplayer)
            const isLocalPlayer = this.isMultiplayerMode
                ? player.position === this.game.localPlayerPosition
                : player.isHuman;

            if (isLocalPlayer) {
                this.humanCardsPlayedThisGame = (this.humanCardsPlayedThisGame || 0) + 1;
                this.checkSponsorCallouts(this.humanCardsPlayedThisGame);
            }
        }

        async handleTrickComplete(winner, trick, tens) {
            await delay(800);

            const winnerName = winner.player.isHuman ? 'You' : winner.player.name;
            let message = `${winnerName} won the trick!`;

            if (tens.length > 0) {
                const tensStr = tens.map(t => `${t.getSuitSymbol()}10`).join(', ');
                message += ` (+${tens.length} ten${tens.length > 1 ? 's' : ''}: ${tensStr})`;
            }

            this.renderer.flashMessage(message, 1200);
            await delay(1200);

            await this.renderer.animateCollectTrick(winner.position);

            const state = this.game.getGameState();
            this.renderer.updateScores(state.tricksWon, state.tensCollected);
        }

        async handleSuperiorSuit(suit, player) {
            this.renderer.updateSuperiorSuit(suit);

            const playerName = player.isHuman ? 'You' : player.name;
            const suitDisplay = `${getSuitSymbol(suit)} ${getSuitDisplay(suit)}`;

            await this.renderer.showMessage(
                'Superior Suit Established!',
                `${playerName} couldn't follow suit and played ${suitDisplay}. This suit now beats all others for the rest of the round!`,
                'Got it!'
            );
        }

        async handleRoundOver(result) {
            await delay(500);

            const state = this.game.getGameState();

            // Determine local player's team for correct win/loss display
            const localTeam = this.isMultiplayerMode ?
                this.game.players[this.game.localPlayerPosition].team : 0;
            const opponentTeam = localTeam === 0 ? 1 : 0;

            // Check if local player's team won
            const localTeamWon = result.winner === localTeam;
            const isTie = result.winner === -1 || result.winner === null;

            let title, bonusText = '';

            if (isTie) {
                title = 'Round Tied!';
            } else if (localTeamWon) {
                title = 'Round Won!';
            } else {
                title = 'Round Lost!';
            }

            if (result.points === 1) {
                const typeLabel = result.type === 'all-tens' ? 'All 10s' :
                                  result.type === 'shutout' ? 'Shutout' : 'Normal';
                bonusText = `\n\n+1 POINT (${typeLabel})`;
            }

            // Show scores from local player's perspective
            const text = result.message + bonusText +
                `\n\nRound Score:\nYour Team: ${state.tensCollected[localTeam]} tens, ${state.tricksWon[localTeam]} tricks\nOpponents: ${state.tensCollected[opponentTeam]} tens, ${state.tricksWon[opponentTeam]} tricks` +
                `\n\nMatch Score: You ${state.matchPoints[localTeam]} - ${state.matchPoints[opponentTeam]} Opp`;

            // In multiplayer, show ready check for next round
            if (this.isMultiplayerMode) {
                await this.renderer.showMessage(title, text, 'Ready for Next Round');
                this.showReadyForNextRound();
            } else {
                // AI game - show options for next round or end game
                const choice = await this.renderer.showMessageWithOptions(title, text, 'Next Round', 'End Game');
                if (choice === 'primary') {
                    this.startNextRound();
                } else {
                    // End game - show final score
                    await this.showAIGameFinalScore();
                }
            }
        }

        // Show final score for AI game
        async showAIGameFinalScore() {
            const state = this.game.getGameState();
            const team0Score = state.matchPoints[0];
            const team1Score = state.matchPoints[1];

            // Get player names for each team
            const team0Players = [];
            const team1Players = [];

            for (let i = 0; i < 4; i++) {
                const player = this.game.players[i];
                if (player.team === 0) {
                    team0Players.push(player.name);
                } else {
                    team1Players.push(player.name);
                }
            }

            // Determine winner
            let title;
            if (team0Score > team1Score) {
                title = 'You Won!';
            } else if (team1Score > team0Score) {
                title = 'You Lost!';
            } else {
                title = 'Tie Game!';
            }

            const scoreMessage = `Final Score:\n\nYour Team (${team0Players.join(' & ')}): ${team0Score}\nOpponents (${team1Players.join(' & ')}): ${team1Score}`;

            await this.renderer.showMessage(title, scoreMessage, 'Back to Menu');
            this.showLobby();
        }

        // Show ready check UI for next round
        showReadyForNextRound() {
            // Emit ready for next round
            if (socket) {
                socket.emit('ready_for_round');
            }

            // Show waiting message
            this.renderer.flashMessage('Waiting for all players to be ready...', 0);
        }

        // Called when all players are ready for next round (from server)
        onAllReadyForRound(data) {
            // Hide waiting message
            this.renderer.hideFlashMessage();

            // If we're the host, deal the new round
            if (this.lobbyManager && this.lobbyManager.isHost()) {
                this.game.startRound();
                this.renderer.clearPlayedCards();
                this.renderer.clearCollectedTens();
                this.renderer.updateSuperiorSuit(null);
                this.updateDisplay();

                // Sync new round to other players
                if (this.syncManager) {
                    const handsData = {};
                    this.game.players.forEach((player, index) => {
                        handsData[index] = player.hand.map(card => ({
                            suit: card.suit,
                            rank: card.rank
                        }));
                    });
                    this.syncManager.broadcastNewRound({
                        currentPlayerIndex: this.game.currentPlayerIndex,
                        trickNumber: this.game.trickNumber,
                        superiorSuit: null,
                        tricksWon: [0, 0],
                        tensCollected: [0, 0],
                        matchPoints: this.game.matchPoints
                    }, handsData);
                }
            }
            // Non-hosts wait for round_started event from host
        }

        // Called when a player leaves the game
        async onPlayerLeftGame(data) {
            const { playerName, reason } = data;

            // Stop any ongoing game actions
            this.isProcessing = true;

            // Hide any flash messages
            this.renderer.hideFlashMessage();

            // Build score summary with player names
            const reasonText = reason === 'disconnected' ? 'disconnected' : 'left the game';

            // Get team scores and player names
            const team0Score = this.game.matchPoints[0];
            const team1Score = this.game.matchPoints[1];

            // Get player names for each team
            const team0Players = [];
            const team1Players = [];

            for (let i = 0; i < 4; i++) {
                const player = this.game.players[i];
                const name = this.game.remotePlayers[i] || player.name;
                if (player.team === 0) {
                    team0Players.push(name);
                } else {
                    team1Players.push(name);
                }
            }

            // Build final score message
            let scoreMessage = `${playerName} has ${reasonText}.\n\n`;
            scoreMessage += `Final Score:\n\n`;
            scoreMessage += `Team 1 (${team0Players.join(' & ')}): ${team0Score}\n`;
            scoreMessage += `Team 2 (${team1Players.join(' & ')}): ${team1Score}`;

            await this.renderer.showMessage('Game Ended', scoreMessage, 'Leave Game');

            // Clean up and return to lobby
            await this.cleanupMultiplayer();
            this.showLobby();
        }

        async handleMatchOver(winner, points) {
            await delay(500);

            // Determine local player's team for correct win/loss display
            const localTeam = this.isMultiplayerMode ?
                this.game.players[this.game.localPlayerPosition].team : 0;
            const opponentTeam = localTeam === 0 ? 1 : 0;

            // Check if local player's team won
            const localTeamWon = winner === localTeam;

            let title, text;

            if (localTeamWon) {
                title = 'MATCH WON!';
                text = `Congratulations! You won the match!\n\nFinal Score: ${points[localTeam]} - ${points[opponentTeam]}`;
            } else {
                title = 'MATCH LOST';
                text = `The opponents won the match.\n\nFinal Score: ${points[localTeam]} - ${points[opponentTeam]}`;
            }

            if (this.isMultiplayerMode) {
                // In multiplayer, return to lobby after match
                text += '\n\nReturning to lobby...';
                await this.renderer.showMessage(title, text, 'OK');
                await this.cleanupMultiplayer();
                this.showLobby();
            } else {
                await this.renderer.showMessage(title, text, 'New Match');
                this.startNewMatch();
            }
        }

        init() {
            // Show lobby on startup
            this.showLobby();
        }
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    document.addEventListener('DOMContentLoaded', () => {
        console.log('Thaasbai - Initializing game...');

        const game = new Game();
        const ui = new UIManager(game);
        ui.init();

        console.log('Thaasbai - Game initialized!');

        // Expose for debugging/development
        window.thaasbai = {
            game,
            ui,
            getState: () => game.getGameState(),
            POINTS_TO_WIN: POINTS_TO_WIN_MATCH,
            isMultiplayerAvailable: () => isMultiplayerAvailable(),
            // Multiplayer utilities
            multiplayer: {
                LobbyManager,
                GameSyncManager,
                PresenceManager,
                getCurrentUserId: () => currentUserId,
                initializeMultiplayer
            }
        };

        // Global function for inline onclick sponsor popup
        window.showSponsorPopup = () => {
            console.log('showSponsorPopup called', { ui, renderer: ui?.renderer });
            if (ui && ui.renderer) {
                console.log('Calling showSponsorDetails');
                try {
                    ui.renderer.showSponsorDetails();
                    console.log('showSponsorDetails completed');
                } catch (e) {
                    console.error('Error in showSponsorDetails:', e);
                }
            } else {
                console.error('ui or ui.renderer is null');
            }
        };
    });

})();
