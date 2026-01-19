/**
 * Thaasbai - Maldivian Card Games
 * Bundled version with multi-round scoring and multiplayer support
 * Currently includes: Dhiha Ei, Digu (coming soon)
 */

(function() {
    'use strict';

    // ============================================
    // MOBILE PWA DETECTION AND SETUP (iOS & Android)
    // ============================================

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /Android/.test(navigator.userAgent);
    const isMobile = isIOS || isAndroid || /webOS|BlackBerry|Opera Mini|IEMobile/.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true ||
                         window.matchMedia('(display-mode: standalone)').matches ||
                         window.matchMedia('(display-mode: fullscreen)').matches;
    const isMobilePWA = isMobile && isStandalone;

    // Apply mobile PWA fixes for both iOS and Android
    if (isMobile) {
        // Prevent bounce/rubber-banding
        document.addEventListener('touchmove', function(e) {
            // Allow scrolling within scrollable elements
            if (e.target.closest('.digu-player-hand')) return;
            e.preventDefault();
        }, { passive: false });

        // Prevent double-tap zoom
        let lastTouchEnd = 0;
        document.addEventListener('touchend', function(e) {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, { passive: false });

        // Add device classes for CSS targeting
        document.documentElement.classList.add('mobile');
        if (isIOS) {
            document.documentElement.classList.add('ios');
        }
        if (isAndroid) {
            document.documentElement.classList.add('android');
        }
        if (isStandalone) {
            document.documentElement.classList.add('standalone');
            if (isIOS) document.documentElement.classList.add('ios-standalone');
            if (isAndroid) document.documentElement.classList.add('android-standalone');
        }
    }

    // Prevent context menu on long press (iOS/Android)
    document.addEventListener('contextmenu', function(e) {
        if (e.target.closest('.card, .pile, button, .clickable')) {
            e.preventDefault();
        }
    });

    // ============================================
    // AUTO-SCALING FOR ALL SCREEN SIZES
    // Base resolution: 2020x1080 (187.04 x 100 scale units)
    // Elements scale proportionally via dynamic --scale CSS variable
    // Rotates 90deg when viewport is portrait (width < height)
    // ============================================

    // Base dimensions in scale units (at --scale: 10.8px, this equals 2020x1080)
    const BASE_WIDTH_UNITS = 187.04;   // 2020 / 10.8
    const BASE_HEIGHT_UNITS = 100;      // 1080 / 10.8
    const BASE_SCALE = 10.8;            // Base --scale value in pixels
    let currentGameScale = 1;           // Store current scale factor for drag clone

    // Detect mobile/touch device
    function isMobileDevice() {
        return 'ontouchstart' in window ||
               navigator.maxTouchPoints > 0 ||
               window.matchMedia('(pointer: coarse)').matches;
    }

    function scaleGame() {
        const gameContainer = document.getElementById('game-container');

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const isPortrait = vw < vh;
        const isMobile = isMobileDevice();
        const dpr = window.devicePixelRatio || 1;

        // In portrait mode, swap dimensions for scale calculation (game rotates 90deg)
        const effectiveWidth = isPortrait ? vh : vw;
        const effectiveHeight = isPortrait ? vw : vh;

        // Calculate scale factor to fit viewport while maintaining aspect ratio
        const scaleX = effectiveWidth / (BASE_WIDTH_UNITS * BASE_SCALE);
        const scaleY = effectiveHeight / (BASE_HEIGHT_UNITS * BASE_SCALE);
        let scaleFactor = Math.min(scaleX, scaleY);

        // For mobile devices, enforce minimum scale to maintain usable touch targets
        if (isMobile) {
            const minScale = Math.max(0.32, 0.45 / Math.sqrt(dpr));
            scaleFactor = Math.max(scaleFactor, minScale);
        }

        // Store for use by drag clone
        currentGameScale = scaleFactor;

        // Calculate the dynamic --scale value (proportional scaling)
        const dynamicScale = BASE_SCALE * scaleFactor;

        // Update CSS --scale variable - this makes ALL elements scale proportionally
        document.documentElement.style.setProperty('--scale', `${dynamicScale}px`);

        // Calculate actual container dimensions (now based on dynamic --scale)
        const containerWidth = BASE_WIDTH_UNITS * dynamicScale;
        const containerHeight = BASE_HEIGHT_UNITS * dynamicScale;

        // Position the container (centered, with rotation for portrait)
        if (gameContainer) {
            // Set container dimensions explicitly
            gameContainer.style.width = `${containerWidth}px`;
            gameContainer.style.height = `${containerHeight}px`;

            if (isPortrait) {
                // In portrait: rotate 90deg clockwise and center
                // With rotate(90deg) and transform-origin: top left:
                // - Container rotates clockwise around top-left corner
                // - After rotation: visual width = containerHeight, visual height = containerWidth
                // - The container extends RIGHT (for containerHeight) and UP (for containerWidth)
                // To center: offsetX positions left edge, offsetY must account for upward extension
                const offsetX = Math.max(0, (vw - containerHeight) / 2);
                const offsetY = (vh + containerWidth) / 2;
                gameContainer.style.transform = `translate(${offsetX}px, ${offsetY}px) rotate(90deg)`;
                gameContainer.style.transformOrigin = 'top left';
            } else {
                // In landscape: just center (no scale transform needed)
                const offsetX = Math.max(0, (vw - containerWidth) / 2);
                const offsetY = Math.max(0, (vh - containerHeight) / 2);
                gameContainer.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
                gameContainer.style.transformOrigin = 'top left';
            }
        }

        console.log(`[Scale] Viewport: ${vw}x${vh}, Portrait: ${isPortrait}, --scale: ${dynamicScale.toFixed(2)}px, Factor: ${scaleFactor.toFixed(3)}`);
    }

    // Scale on load and resize
    window.addEventListener('resize', scaleGame);
    window.addEventListener('orientationchange', () => {
        // Delay to allow orientation change to complete
        setTimeout(scaleGame, 100);
    });

    // Initial scale on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scaleGame);
    } else {
        scaleGame();
    }

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
    // AI PLAYER CLASS - Enhanced Strategy
    // ============================================

    class AIPlayer extends Player {
        constructor(position, team) {
            super(position, team, false);
            this.playedCards = []; // Track cards played this round
            this.suitVoids = {}; // Track which players are void in which suits
        }

        // Reset memory at start of new round
        resetMemory() {
            this.playedCards = [];
            this.suitVoids = { 0: {}, 1: {}, 2: {}, 3: {} };
        }

        // Record a played card for memory
        recordPlay(position, card, ledSuit) {
            this.playedCards.push({ position, card, ledSuit });
            // If player didn't follow suit, they're void
            if (ledSuit && card.suit !== ledSuit) {
                this.suitVoids[position][ledSuit] = true;
            }
        }

        // Check if a player is known to be void in a suit
        isPlayerVoid(position, suit) {
            return this.suitVoids[position]?.[suit] === true;
        }

        // Count how many of a suit have been played
        countPlayedInSuit(suit) {
            return this.playedCards.filter(p => p.card.suit === suit).length;
        }

        // Check if a specific card has been played
        isCardPlayed(rank, suit) {
            return this.playedCards.some(p => p.card.rank === rank && p.card.suit === suit);
        }

        // Get remaining high cards in a suit (not played and not in hand)
        getRemainingHighCards(suit, minPower = 10) {
            const played = this.playedCards.filter(p => p.card.suit === suit);
            const inHand = this.hand.filter(c => c.suit === suit);
            const allRanks = ['ace', 'king', 'queen', 'jack', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

            return allRanks.filter(rank => {
                const card = new Card(suit, rank);
                if (card.getPower() < minPower) return false;
                const isPlayed = played.some(p => p.card.rank === rank);
                const isInHand = inHand.some(c => c.rank === rank);
                return !isPlayed && !isInHand;
            });
        }

        // Calculate trick value (points at stake)
        getTrickValue(trickCards) {
            return trickCards.reduce((sum, tc) => {
                if (tc.card?.isTen()) return sum + 10;
                return sum;
            }, 0);
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
            const partnerPosition = (this.position + 2) % 4;
            const leftOpp = (this.position + 1) % 4;
            const rightOpp = (this.position + 3) % 4;

            // Strategy 1: Lead winning superior suit card to draw out trumps
            if (superiorSuit && this.hasSuit(superiorSuit)) {
                const superiorCards = this.getCardsOfSuit(superiorSuit);
                const highSuperior = this.getHighestCard(superiorCards);
                const remainingHigh = this.getRemainingHighCards(superiorSuit, highSuperior.getPower());

                // If we have the highest remaining trump, lead it
                if (remainingHigh.length === 0 && highSuperior.getPower() >= 10) {
                    return highSuperior;
                }
            }

            // Strategy 2: Lead from a suit where opponents are void (partner can trump)
            for (const card of validCards) {
                if (card.suit === superiorSuit) continue; // Don't waste trumps
                const oppLeftVoid = this.isPlayerVoid(leftOpp, card.suit);
                const oppRightVoid = this.isPlayerVoid(rightOpp, card.suit);
                const partnerVoid = this.isPlayerVoid(partnerPosition, card.suit);

                // If both opponents are void but partner isn't, lead low
                if (oppLeftVoid && oppRightVoid && !partnerVoid) {
                    const suitCards = this.getCardsOfSuit(card.suit);
                    return this.getLowestCard(suitCards);
                }
            }

            // Strategy 3: Lead protected tens (have higher card in same suit)
            const tens = this.getTens();
            for (const ten of tens) {
                const suitCards = this.getCardsOfSuit(ten.suit);
                const hasAce = suitCards.some(c => c.rank === 'ace');
                const hasKing = suitCards.some(c => c.rank === 'king');

                // Lead ten if we have Ace or if it's superior suit with protection
                if (hasAce || (superiorSuit === ten.suit && (hasAce || hasKing))) {
                    return ten;
                }
            }

            // Strategy 4: Lead from long suit to establish it
            const suitCounts = {};
            for (const card of validCards) {
                if (card.suit === superiorSuit) continue;
                suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
            }
            const longSuit = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0];
            if (longSuit && longSuit[1] >= 3) {
                const longSuitCards = this.getCardsOfSuit(longSuit[0]);
                const highCard = this.getHighestCard(longSuitCards);
                // Lead high from long suit to establish
                if (highCard.getPower() >= 11) {
                    return highCard;
                }
            }

            // Strategy 5: Lead low card from short suit (not tens)
            const shortSuits = Object.entries(suitCounts).sort((a, b) => a[1] - b[1]);
            for (const [suit, count] of shortSuits) {
                if (count <= 2) {
                    const suitCards = this.getCardsOfSuit(suit);
                    const nonTens = suitCards.filter(c => !c.isTen());
                    if (nonTens.length > 0) {
                        return this.getLowestCard(nonTens);
                    }
                }
            }

            // Default: lead lowest non-ten card
            return this.getLowestCard(validCards);
        }

        chooseFollowCard(validCards, trickCards, superiorSuit, gameState) {
            const currentWinner = this.getCurrentTrickWinner(trickCards, superiorSuit);
            const partnerPosition = (this.position + 2) % 4;
            const isLastToPlay = trickCards.length === 3;
            const trickValue = this.getTrickValue(trickCards);
            const ledSuit = trickCards[0]?.card?.suit;

            // If partner is winning
            if (currentWinner && currentWinner.position === partnerPosition) {
                // If last to play or trick has value, just dump lowest
                if (isLastToPlay || trickValue > 0) {
                    return this.getLowestCard(validCards);
                }

                // Otherwise, might add a ten if safe
                const myTens = validCards.filter(c => c.isTen());
                if (myTens.length > 0 && isLastToPlay) {
                    // Safe to add ten if we're last
                    return myTens[0];
                }

                return this.getLowestCard(validCards);
            }

            // We need to try to win
            const highestNeeded = this.getHighestTrickCard(trickCards, ledSuit, superiorSuit);
            const winningCards = validCards.filter(c => {
                const myPower = (superiorSuit && c.suit === superiorSuit)
                    ? c.getPower() + 100
                    : c.getPower();
                return myPower > highestNeeded;
            });

            if (winningCards.length > 0) {
                // Trick has points - win with lowest winning card
                if (trickValue > 0) {
                    return this.getLowestWinningCard(winningCards);
                }

                // Last to play - always win if we can (trick might get points)
                if (isLastToPlay) {
                    return this.getLowestWinningCard(winningCards);
                }

                // Not last, no points yet - consider if worth winning
                // Win if we have a strong card anyway
                const lowestWinner = this.getLowestWinningCard(winningCards);
                if (lowestWinner.getPower() >= 10) {
                    return lowestWinner;
                }

                // Otherwise just play lowest
                return this.getLowestCard(validCards);
            }

            // Can't win - dump lowest, avoid tens if possible
            return this.getLowestCard(validCards);
        }

        chooseOffSuitCard(validCards, trickCards, superiorSuit, gameState) {
            const partnerPosition = (this.position + 2) % 4;
            const currentWinner = this.getCurrentTrickWinner(trickCards, superiorSuit);
            const trickValue = this.getTrickValue(trickCards);
            const isLastToPlay = trickCards.length === 3;
            const ledSuit = trickCards[0]?.card?.suit;

            // Partner is winning - discard carefully
            if (currentWinner && currentWinner.position === partnerPosition) {
                // If last to play, can safely add ten
                if (isLastToPlay) {
                    const myTens = validCards.filter(c => c.isTen() && c.suit !== superiorSuit);
                    if (myTens.length > 0) {
                        return myTens[0]; // Add ten to partner's trick
                    }
                }
                return this.getLowestCard(validCards);
            }

            // Should we trump?
            if (superiorSuit) {
                const trumps = validCards.filter(c => c.suit === superiorSuit);
                if (trumps.length > 0) {
                    // Check if opponent already trumped higher
                    const highestTrumpPlayed = trickCards
                        .filter(tc => tc.card?.suit === superiorSuit)
                        .reduce((max, tc) => Math.max(max, tc.card.getPower()), 0);

                    const winningTrumps = trumps.filter(t => t.getPower() > highestTrumpPlayed);

                    if (winningTrumps.length > 0) {
                        // Trump if trick has value
                        if (trickValue >= 10) {
                            return this.getLowestCard(winningTrumps);
                        }

                        // Trump if last to play and enemy is winning
                        if (isLastToPlay) {
                            return this.getLowestCard(winningTrumps);
                        }

                        // Trump with low trump if we have many
                        if (trumps.length >= 3) {
                            return this.getLowestCard(winningTrumps);
                        }
                    }
                }
            }

            // Can't or won't trump - discard
            // Avoid discarding tens
            const nonTens = validCards.filter(c => !c.isTen());
            if (nonTens.length > 0) {
                // Discard from short suits to create voids
                const suitCounts = {};
                for (const card of nonTens) {
                    if (card.suit === superiorSuit) continue;
                    suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
                }

                // Discard from shortest non-trump suit
                const shortestSuit = Object.entries(suitCounts).sort((a, b) => a[1] - b[1])[0];
                if (shortestSuit) {
                    const shortSuitCards = nonTens.filter(c => c.suit === shortestSuit[0]);
                    return this.getLowestCard(shortSuitCards);
                }

                return this.getLowestCard(nonTens);
            }

            // Only have tens - play the one from shortest suit
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

        getLowestWinningCard(cards) {
            // Among winning cards, prefer non-tens, then lowest
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
    // DIGU GAME - Rules Class
    // ============================================

    class DiGuRules {
        // Card values for scoring: A=15, J/Q/K=10, others=face value
        static getCardValue(card) {
            if (card.rank === 14) return 15; // Ace
            if (card.rank >= 11) return 10;  // J, Q, K
            return card.rank;                 // 2-10
        }

        // Calculate total hand value (for penalty scoring)
        static getHandValue(cards) {
            return cards.reduce((sum, card) => sum + DiGuRules.getCardValue(card), 0);
        }

        // Check if cards form a valid set (3-4 same rank, different suits)
        static isValidSet(cards) {
            if (cards.length < 3 || cards.length > 4) return false;

            const rank = cards[0].rank;
            const suits = new Set();

            for (const card of cards) {
                if (card.rank !== rank) return false;
                if (suits.has(card.suit)) return false; // Duplicate suit
                suits.add(card.suit);
            }

            return true;
        }

        // Check if cards form a valid run (3+ consecutive same suit, Ace HIGH only)
        static isValidRun(cards) {
            if (cards.length < 3) return false;

            const suit = cards[0].suit;
            const ranks = [];

            for (const card of cards) {
                if (card.suit !== suit) return false;
                ranks.push(card.rank);
            }

            // Sort ranks ascending
            ranks.sort((a, b) => a - b);

            // Check for consecutive ranks
            for (let i = 1; i < ranks.length; i++) {
                if (ranks[i] !== ranks[i - 1] + 1) return false;
            }

            // Ace (14) can only be high: Q-K-A is valid, A-2-3 is NOT valid
            // Check if we have an invalid A-2 wrap (Ace followed by 2)
            if (ranks.includes(14) && ranks.includes(2)) {
                return false; // No wrap-around allowed
            }

            return true;
        }

        // Check if cards form a valid meld (either set or run)
        static isValidMeld(cards) {
            if (!cards || cards.length < 3) return false;
            return DiGuRules.isValidSet(cards) || DiGuRules.isValidRun(cards);
        }

        // Check if melds form a winning hand (3+3+4 structure, all valid)
        static isWinningHand(melds) {
            if (!melds || melds.length !== 3) return false;

            // Check each meld is valid
            for (const meld of melds) {
                if (!DiGuRules.isValidMeld(meld)) return false;
            }

            // Check structure: exactly one 4-card meld, two 3-card melds
            const lengths = melds.map(m => m.length).sort((a, b) => a - b);
            return lengths[0] === 3 && lengths[1] === 3 && lengths[2] === 4;
        }

        // Find all possible melds in a hand (for AI assistance)
        static findPossibleMelds(cards) {
            const melds = [];

            // Find sets (same rank)
            const byRank = {};
            cards.forEach(card => {
                if (!byRank[card.rank]) byRank[card.rank] = [];
                byRank[card.rank].push(card);
            });

            for (const rank in byRank) {
                const rankCards = byRank[rank];
                if (rankCards.length >= 3) {
                    // 3-card sets
                    if (rankCards.length === 3) {
                        melds.push({ type: 'set', cards: [...rankCards] });
                    } else if (rankCards.length === 4) {
                        // 4-card set
                        melds.push({ type: 'set', cards: [...rankCards] });
                        // Also add all 3-card combinations
                        for (let i = 0; i < 4; i++) {
                            const combo = rankCards.filter((_, idx) => idx !== i);
                            melds.push({ type: 'set', cards: combo });
                        }
                    }
                }
            }

            // Find runs (consecutive same suit)
            const bySuit = {};
            cards.forEach(card => {
                if (!bySuit[card.suit]) bySuit[card.suit] = [];
                bySuit[card.suit].push(card);
            });

            for (const suit in bySuit) {
                const suitCards = bySuit[suit].sort((a, b) => a.rank - b.rank);

                // Find all consecutive sequences of 3+ cards
                for (let start = 0; start < suitCards.length - 2; start++) {
                    let run = [suitCards[start]];

                    for (let i = start + 1; i < suitCards.length; i++) {
                        if (suitCards[i].rank === run[run.length - 1].rank + 1) {
                            run.push(suitCards[i]);
                        } else {
                            break;
                        }
                    }

                    if (run.length >= 3) {
                        // Add all valid run lengths (3, 4, 5, etc.)
                        for (let len = 3; len <= run.length; len++) {
                            for (let offset = 0; offset <= run.length - len; offset++) {
                                melds.push({
                                    type: 'run',
                                    cards: run.slice(offset, offset + len)
                                });
                            }
                        }
                    }
                }
            }

            return melds;
        }
    }

    // ============================================
    // DIGU GAME - Player Class
    // ============================================

    class DiGuPlayer {
        constructor(position, isHuman = false) {
            this.position = position;
            this.isHuman = isHuman;
            this.hand = [];
            this.arrangedMelds = [[], [], []]; // 3 meld slots
            this.name = isHuman ? 'You' : MALDIVIAN_AI_NAMES[position] || `Player ${position + 1}`;
        }

        setHand(cards) {
            this.hand = [...cards];
            this.arrangedMelds = [[], [], []];
            this.sortHand();
        }

        sortHand() {
            const suitOrder = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
            this.hand.sort((a, b) => {
                if (suitOrder[a.suit] !== suitOrder[b.suit]) {
                    return suitOrder[a.suit] - suitOrder[b.suit];
                }
                return b.rank - a.rank;
            });
        }

        addCard(card) {
            // Add new card to end (rightmost position) - don't rearrange existing cards
            this.hand.push(card);
        }

        removeCard(card) {
            const index = this.hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
            if (index !== -1) {
                return this.hand.splice(index, 1)[0];
            }
            return null;
        }

        hasCard(card) {
            return this.hand.some(c => c.suit === card.suit && c.rank === card.rank);
        }

        // Arrange cards into a meld slot
        arrangeMeld(slotIndex, cards) {
            if (slotIndex < 0 || slotIndex > 2) return false;
            this.arrangedMelds[slotIndex] = [...cards];
            return true;
        }

        // Clear a meld slot
        clearMeld(slotIndex) {
            if (slotIndex < 0 || slotIndex > 2) return;
            this.arrangedMelds[slotIndex] = [];
        }

        // Get all cards currently in melds
        getCardsInMelds() {
            const cards = [];
            for (const meld of this.arrangedMelds) {
                cards.push(...meld);
            }
            return cards;
        }

        // Get cards not yet assigned to melds
        getUnassignedCards() {
            const meldCards = this.getCardsInMelds();
            return this.hand.filter(card =>
                !meldCards.some(mc => mc.suit === card.suit && mc.rank === card.rank)
            );
        }

        // Check if player can declare Digu
        canDeclareDigu() {
            // Must have 10 or 11 cards (11 if just drew, will discard the extra)
            if (this.hand.length < 10 || this.hand.length > 11) return false;

            // Get melds from hand arrangement (flexible: 4+3+3, 3+4+3, or 3+3+4)
            const result = this.getMeldsFromHand();
            // If valid is explicitly false, no valid structure was found
            if (result.valid === false) return false;
            return DiGuRules.isWinningHand(result.melds);
        }

        // Get melds based on hand arrangement - flexible structure (3+3+4, 3+4+3, or 4+3+3)
        getMeldsFromHand() {
            // Use first 10 cards for melds (11th card is discard)
            const cards = this.hand.slice(0, 10);
            if (cards.length < 10) return { melds: [[], [], []], structure: null, boundaries: [] };

            // Try different meld structures from left to right
            const structures = [
                [4, 3, 3],  // 4+3+3
                [3, 4, 3],  // 3+4+3
                [3, 3, 4]   // 3+3+4
            ];

            for (const structure of structures) {
                const meld1 = cards.slice(0, structure[0]);
                const meld2 = cards.slice(structure[0], structure[0] + structure[1]);
                const meld3 = cards.slice(structure[0] + structure[1], 10);

                // Check if all three form valid melds
                if (DiGuRules.isValidMeld(meld1) &&
                    DiGuRules.isValidMeld(meld2) &&
                    DiGuRules.isValidMeld(meld3)) {
                    return {
                        melds: [meld1, meld2, meld3],
                        structure: structure,
                        boundaries: [structure[0], structure[0] + structure[1]]
                    };
                }
            }

            // No valid structure found - return current arrangement for display
            // Default to 3+3+4 for visual grouping
            return {
                melds: [cards.slice(0, 3), cards.slice(3, 6), cards.slice(6, 10)],
                structure: [3, 3, 4],
                boundaries: [3, 6],
                valid: false
            };
        }

        // Get hand value for scoring
        getHandValue() {
            return DiGuRules.getHandValue(this.hand);
        }

        // Get value of unmelded cards (for scoring penalty)
        getUnmeldedValue() {
            const result = this.getMeldsFromHand();

            // If all cards are melded (valid structure found), return 0
            if (result.valid !== false && result.structure) {
                return 0;
            }

            // Calculate value of cards not in valid melds
            const cards = this.hand.slice(0, 10);
            let unmeldedValue = 0;

            // Try to find valid melds and exclude their values
            const structures = [
                [4, 3, 3],
                [3, 4, 3],
                [3, 3, 4]
            ];

            // Find which cards are in valid melds
            const meldedIndices = new Set();

            for (const structure of structures) {
                const meld1 = cards.slice(0, structure[0]);
                const meld2 = cards.slice(structure[0], structure[0] + structure[1]);
                const meld3 = cards.slice(structure[0] + structure[1], 10);

                // Mark valid melds
                if (DiGuRules.isValidMeld(meld1)) {
                    for (let i = 0; i < structure[0]; i++) meldedIndices.add(i);
                }
                if (DiGuRules.isValidMeld(meld2)) {
                    for (let i = structure[0]; i < structure[0] + structure[1]; i++) meldedIndices.add(i);
                }
                if (DiGuRules.isValidMeld(meld3)) {
                    for (let i = structure[0] + structure[1]; i < 10; i++) meldedIndices.add(i);
                }
            }

            // Sum value of unmelded cards
            for (let i = 0; i < cards.length; i++) {
                if (!meldedIndices.has(i)) {
                    unmeldedValue += DiGuRules.getCardValue(cards[i]);
                }
            }

            return unmeldedValue;
        }

        // Get detailed meld information for end-game display
        getMeldDetails() {
            const result = this.getMeldsFromHand();
            const cards = this.hand.slice(0, 10);
            const meldDetails = [];

            if (result.structure) {
                const [s1, s2, s3] = result.structure;
                meldDetails.push({
                    cards: cards.slice(0, s1),
                    valid: DiGuRules.isValidMeld(cards.slice(0, s1)),
                    type: this.getMeldType(cards.slice(0, s1))
                });
                meldDetails.push({
                    cards: cards.slice(s1, s1 + s2),
                    valid: DiGuRules.isValidMeld(cards.slice(s1, s1 + s2)),
                    type: this.getMeldType(cards.slice(s1, s1 + s2))
                });
                meldDetails.push({
                    cards: cards.slice(s1 + s2, 10),
                    valid: DiGuRules.isValidMeld(cards.slice(s1 + s2, 10)),
                    type: this.getMeldType(cards.slice(s1 + s2, 10))
                });
            } else {
                // Default 3+3+4 structure
                meldDetails.push({
                    cards: cards.slice(0, 3),
                    valid: DiGuRules.isValidMeld(cards.slice(0, 3)),
                    type: this.getMeldType(cards.slice(0, 3))
                });
                meldDetails.push({
                    cards: cards.slice(3, 6),
                    valid: DiGuRules.isValidMeld(cards.slice(3, 6)),
                    type: this.getMeldType(cards.slice(3, 6))
                });
                meldDetails.push({
                    cards: cards.slice(6, 10),
                    valid: DiGuRules.isValidMeld(cards.slice(6, 10)),
                    type: this.getMeldType(cards.slice(6, 10))
                });
            }

            return meldDetails;
        }

        getMeldType(cards) {
            if (DiGuRules.isValidSet(cards)) return 'set';
            if (DiGuRules.isValidRun(cards)) return 'run';
            return 'invalid';
        }

        get cardCount() {
            return this.hand.length;
        }
    }

    // ============================================
    // DIGU GAME - AI Player Class
    // ============================================

    class DiGuAI extends DiGuPlayer {
        constructor(position) {
            super(position, false);
        }

        // Choose whether to draw from stock or discard
        chooseDrawSource(discardTopCard, hand) {
            if (!discardTopCard) return 'stock';

            // Score the potential benefit of taking the discard card
            const benefitScore = this.evaluateCardBenefit(discardTopCard, hand);

            // Take from discard if benefit is significant (score >= 2)
            return benefitScore >= 2 ? 'discard' : 'stock';
        }

        // Evaluate how much a card would benefit our hand
        evaluateCardBenefit(card, hand) {
            let score = 0;

            // Check if it completes a set (3 or 4 of a kind)
            const sameRank = hand.filter(c => c.rank === card.rank);
            if (sameRank.length >= 2) {
                // Would complete a set of 3+
                const suits = new Set(sameRank.map(c => c.suit));
                if (!suits.has(card.suit)) {
                    score += 5; // Valid set (different suits)
                }
            } else if (sameRank.length === 1) {
                // Has one matching rank - building towards set
                const existingSuit = sameRank[0].suit;
                if (existingSuit !== card.suit) {
                    score += 2; // Different suit, potential set
                }
            }

            // Check if it helps a run (consecutive same suit)
            const sameSuit = hand.filter(c => c.suit === card.suit);
            const sameSuitRanks = sameSuit.map(c => c.rank).sort((a, b) => a - b);

            // Check for adjacent cards
            const hasLower = sameSuitRanks.includes(card.rank - 1);
            const hasHigher = sameSuitRanks.includes(card.rank + 1);
            const hasTwoLower = sameSuitRanks.includes(card.rank - 2);
            const hasTwoHigher = sameSuitRanks.includes(card.rank + 2);

            if (hasLower && hasHigher) {
                // Completes a run of at least 3
                score += 5;
            } else if ((hasLower && hasTwoLower) || (hasHigher && hasTwoHigher)) {
                // Extends an existing run
                score += 4;
            } else if (hasLower || hasHigher) {
                // Building towards a run
                score += 2;
            }

            // Ace is high only - penalize A-2 combinations
            if (card.rank === 14 && sameSuitRanks.includes(2)) {
                score -= 3;
            }
            if (card.rank === 2 && sameSuitRanks.includes(14)) {
                score -= 3;
            }

            return score;
        }

        // Choose which card to discard - improved logic
        chooseDiscard(hand) {
            if (hand.length === 0) return null;

            // Score each card - lower score = better to discard
            const cardScores = hand.map((card, index) => ({
                card,
                index,
                score: this.evaluateCardKeepValue(card, hand)
            }));

            // Sort by score ascending (lowest score = discard first)
            cardScores.sort((a, b) => a.score - b.score);

            // Return the card with lowest keep value
            return cardScores[0].card;
        }

        // Evaluate how valuable a card is to keep
        evaluateCardKeepValue(card, hand) {
            let score = 0;
            const otherCards = hand.filter(c => c !== card);

            // Check set potential
            const sameRank = otherCards.filter(c => c.rank === card.rank);
            if (sameRank.length >= 2) {
                // Part of a valid set (3+)
                const suits = new Set([card.suit, ...sameRank.map(c => c.suit)]);
                if (suits.size === sameRank.length + 1) {
                    score += 10; // Valid set with different suits
                }
            } else if (sameRank.length === 1) {
                // Potential pair towards set
                if (sameRank[0].suit !== card.suit) {
                    score += 3;
                }
            }

            // Check run potential
            const sameSuit = otherCards.filter(c => c.suit === card.suit);
            const sameSuitRanks = sameSuit.map(c => c.rank).sort((a, b) => a - b);

            // Check for run of 3+
            const hasLower = sameSuitRanks.includes(card.rank - 1);
            const hasHigher = sameSuitRanks.includes(card.rank + 1);
            const hasTwoLower = sameSuitRanks.includes(card.rank - 2);
            const hasTwoHigher = sameSuitRanks.includes(card.rank + 2);

            if (hasLower && hasHigher) {
                score += 10; // Part of a run
            } else if ((hasLower && hasTwoLower) || (hasHigher && hasTwoHigher)) {
                score += 8; // Extends existing run
            } else if (hasLower || hasHigher) {
                score += 4; // Building towards run
            }

            // Penalize Ace in invalid positions (A-2 wrap not allowed)
            if (card.rank === 14 && sameSuitRanks.includes(2) && !sameSuitRanks.includes(13)) {
                score -= 3;
            }
            if (card.rank === 2 && sameSuitRanks.includes(14) && !sameSuitRanks.includes(3)) {
                score -= 3;
            }

            // Higher value cards are slightly worse to keep if isolated
            // (more penalty if unmelded at game end)
            if (score < 3) {
                score -= DiGuRules.getCardValue(card) * 0.2;
            }

            return score;
        }

        // Try to find valid meld arrangement for DIGU declaration
        autoArrangeMelds() {
            // Use first 10 cards only (11th is discard)
            const cards = this.hand.slice(0, 10);
            if (cards.length < 10) return false;

            const melds = DiGuRules.findPossibleMelds(cards);

            // Try all structures: 3+3+4, 3+4+3, 4+3+3
            const structures = [[3, 3, 4], [3, 4, 3], [4, 3, 3]];

            for (const [size1, size2, size3] of structures) {
                const result = this.findMeldCombination(cards, melds, [size1, size2, size3]);
                if (result) {
                    // Rearrange hand to match the found melds
                    const newHand = [...result[0], ...result[1], ...result[2]];
                    if (this.hand.length > 10) {
                        newHand.push(this.hand[10]); // Keep 11th card for discard
                    }
                    this.hand = newHand;
                    this.arrangedMelds = result;
                    return true;
                }
            }

            return false;
        }

        // Find a valid combination of melds with specified sizes
        findMeldCombination(cards, melds, sizes) {
            const [size1, size2, size3] = sizes;

            // Get melds of each required size
            const melds1 = melds.filter(m => m.cards.length === size1);

            for (const m1 of melds1) {
                const used1 = new Set(m1.cards.map(c => `${c.suit}-${c.rank}`));
                const remaining1 = cards.filter(c => !used1.has(`${c.suit}-${c.rank}`));

                const remainingMelds = DiGuRules.findPossibleMelds(remaining1);
                const melds2 = remainingMelds.filter(m => m.cards.length === size2);

                for (const m2 of melds2) {
                    const used2 = new Set(m2.cards.map(c => `${c.suit}-${c.rank}`));
                    const remaining2 = remaining1.filter(c => !used2.has(`${c.suit}-${c.rank}`));

                    // Check if remaining cards form valid meld of size3
                    if (remaining2.length === size3 && DiGuRules.isValidMeld(remaining2)) {
                        return [m1.cards, m2.cards, remaining2];
                    }
                }
            }

            return null;
        }

        // Check if AI should declare Digu
        shouldDeclareDigu() {
            // First try auto-arrange which also rearranges hand
            if (this.autoArrangeMelds()) {
                return true;
            }

            // Fallback: check using getMeldsFromHand
            const result = this.getMeldsFromHand();
            if (result.valid !== false && result.structure) {
                return DiGuRules.isWinningHand(result.melds);
            }

            return false;
        }
    }

    // ============================================
    // DIGU GAME - Main Game Class
    // ============================================

    class DiGuGame {
        constructor() {
            this.players = [];
            this.stockPile = [];
            this.discardPile = [];
            this.currentPlayerIndex = 0;
            this.gamePhase = 'waiting'; // waiting, draw, meld, discard
            this.numPlayers = 4; // Always 4 players in teams
            this.gameOver = false;
            this.winner = null;
            this.winningTeam = null;
            this.scores = [];
            this.teamScores = [0, 0]; // Team A (0,2) and Team B (1,3)

            // Teams: Player 0 & 2 = Team A, Player 1 & 3 = Team B
            this.teams = {
                A: [0, 2], // You and Partner (opposite)
                B: [1, 3]  // Opponents
            };

            // Dealer/shuffler tracking
            this.dealerPosition = 0; // Who is currently dealing
            this.shuffleCounts = [0, 0, 0, 0]; // How many times each player has shuffled
            this.shouldRotateDealer = false; // Rotate dealer only if their team wins

            // Match statistics (persists across games in a session)
            this.matchStats = {
                matchesPlayed: 0,
                teamWins: [0, 0], // Team A wins, Team B wins
                totalPoints: [0, 0] // Cumulative points for each team
            };

            // Event callbacks
            this.onStateChange = null;
            this.onCardDrawn = null;
            this.onCardDiscarded = null;
            this.onGameOver = null;
            this.onPhaseChange = null;
            this.onTurnChange = null;
        }

        // Get team for a player index
        getPlayerTeam(playerIndex) {
            return this.teams.A.includes(playerIndex) ? 'A' : 'B';
        }

        // Get partner for a player
        getPartner(playerIndex) {
            const team = this.getPlayerTeam(playerIndex);
            const teammates = this.teams[team];
            return teammates.find(i => i !== playerIndex);
        }

        // Reset match statistics for a new match session
        resetMatchStats() {
            this.matchStats = {
                matchesPlayed: 0,
                teamWins: [0, 0],
                totalPoints: [0, 0]
            };
            this.shuffleCounts = [0, 0, 0, 0];
            this.dealerPosition = 0;
            this.shouldRotateDealer = false;
        }

        // Initialize a new game
        startGame(numPlayers = 4) {
            this.numPlayers = Math.max(2, Math.min(4, numPlayers));
            this.players = [];
            this.gameOver = false;
            this.winner = null;
            this.scores = Array(this.numPlayers).fill(0);

            // Create players (position 0 is always human)
            for (let i = 0; i < this.numPlayers; i++) {
                if (i === 0) {
                    this.players.push(new DiGuPlayer(i, true));
                } else {
                    this.players.push(new DiGuAI(i));
                }
            }

            // Current dealer shuffles - increment their count
            this.shuffleCounts[this.dealerPosition]++;
            this.dealCards();
            this.currentPlayerIndex = 0;
            this.gamePhase = 'draw';

            if (this.onStateChange) this.onStateChange(this.getGameState());
            if (this.onPhaseChange) this.onPhaseChange('draw');
        }

        // Start next game in match (only rotate dealer if their team won)
        startNextGame() {
            // Only rotate dealer if their team won the last game
            if (this.shouldRotateDealer) {
                this.rotateDealerPosition();
            }
            this.shouldRotateDealer = false;
            this.startGame(this.numPlayers);
        }

        // Deal 10 cards to each player (counter-clockwise like Dhiha Ei)
        dealCards() {
            // Create and shuffle deck
            const deck = new Deck();
            deck.shuffle();

            // Counter-clockwise dealing order: 0, 3, 2, 1
            const dealOrder = [0, 3, 2, 1];

            // Deal 10 cards to each player in counter-clockwise order
            for (let i = 0; i < 10; i++) {
                for (const playerIndex of dealOrder) {
                    this.players[playerIndex].addCard(deck.cards.shift());
                }
            }

            // Remaining cards go to stock pile
            this.stockPile = deck.cards;
            this.discardPile = [];

            // Turn over top card of stock to start discard pile
            if (this.stockPile.length > 0) {
                this.discardPile.push(this.stockPile.shift());
            }
        }

        // Get current game state
        getGameState() {
            return {
                players: this.players,
                stockCount: this.stockPile.length,
                discardTop: this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1] : null,
                discardCount: this.discardPile.length,
                currentPlayerIndex: this.currentPlayerIndex,
                gamePhase: this.gamePhase,
                gameOver: this.gameOver,
                winner: this.winner,
                scores: this.scores,
                numPlayers: this.numPlayers,
                dealerPosition: this.dealerPosition,
                shuffleCounts: [...this.shuffleCounts]
            };
        }

        // Get current player
        getCurrentPlayer() {
            return this.players[this.currentPlayerIndex];
        }

        // Check if it's human's turn
        isHumanTurn() {
            return this.currentPlayerIndex === 0;
        }

        // Draw from stock pile
        drawFromStock() {
            if (this.gamePhase !== 'draw') return null;
            if (this.stockPile.length === 0) {
                this.reshuffleDiscardToStock();
            }

            if (this.stockPile.length === 0) return null;

            const card = this.stockPile.shift();
            this.getCurrentPlayer().addCard(card);

            this.gamePhase = 'meld';
            if (this.onCardDrawn) this.onCardDrawn(card, 'stock');
            if (this.onPhaseChange) this.onPhaseChange('meld');
            if (this.onStateChange) this.onStateChange(this.getGameState());

            return card;
        }

        // Draw from discard pile
        drawFromDiscard() {
            if (this.gamePhase !== 'draw') return null;
            if (this.discardPile.length === 0) return null;

            const card = this.discardPile.pop();
            this.getCurrentPlayer().addCard(card);

            this.gamePhase = 'meld';
            if (this.onCardDrawn) this.onCardDrawn(card, 'discard');
            if (this.onPhaseChange) this.onPhaseChange('meld');
            if (this.onStateChange) this.onStateChange(this.getGameState());

            return card;
        }

        // Discard a card
        discardCard(card) {
            if (this.gamePhase !== 'meld' && this.gamePhase !== 'discard') return false;

            const player = this.getCurrentPlayer();
            const removed = player.removeCard(card);

            if (!removed) return false;

            this.discardPile.push(removed);

            if (this.onCardDiscarded) this.onCardDiscarded(removed, player);

            // Move to next player
            this.nextTurn();

            return true;
        }

        // Declare Digu (win)
        declareDigu() {
            const player = this.getCurrentPlayer();

            if (!player.canDeclareDigu()) {
                return { success: false, message: 'Invalid Digu declaration!' };
            }

            // If player has 11 cards, auto-discard the unmelded card
            if (player.hand.length === 11) {
                const unassigned = player.getUnassignedCards();
                if (unassigned.length === 1) {
                    const discardCard = player.removeCard(unassigned[0]);
                    if (discardCard) {
                        this.discardPile.push(discardCard);
                    }
                }
            }

            // Valid Digu!
            this.gameOver = true;
            this.winner = player;
            this.winningTeam = this.getPlayerTeam(player.position);
            this.gamePhase = 'gameover';

            // Calculate scores
            this.calculateScores();

            if (this.onGameOver) {
                this.onGameOver({
                    winner: player,
                    winningTeam: this.winningTeam,
                    scores: this.scores,
                    teamScores: this.teamScores,
                    playerPenalties: this.playerPenalties,
                    playerCardTotals: this.playerCardTotals,
                    playerMeldedValues: this.playerMeldedValues,
                    players: this.players,
                    matchStats: { ...this.matchStats }
                });
            }

            return { success: true, winner: player, winningTeam: this.winningTeam };
        }

        // Calculate final scores (team-based)
        // Winning team: 100 bonus + card total - unmelded cards (= 100 + melded card values)
        // Losing team: negative penalty for unmelded cards
        calculateScores() {
            this.teamScores = [0, 0]; // Reset team scores
            this.playerPenalties = []; // Track individual penalties for display
            this.playerCardTotals = []; // Track total card values
            this.playerMeldedValues = []; // Track melded card values

            const winningTeamIndex = this.winningTeam === 'A' ? 0 : 1;
            const losingTeamIndex = winningTeamIndex === 0 ? 1 : 0;

            // Calculate values for each player
            for (let i = 0; i < this.players.length; i++) {
                const player = this.players[i];
                const totalCardValue = player.getHandValue();
                const unmeldedValue = player.getUnmeldedValue();
                const meldedValue = totalCardValue - unmeldedValue;

                this.playerCardTotals[i] = totalCardValue;
                this.playerPenalties[i] = unmeldedValue;
                this.playerMeldedValues[i] = meldedValue;

                if (player === this.winner) {
                    this.scores[i] = meldedValue; // Winner contributes melded value
                } else {
                    this.scores[i] = unmeldedValue; // Others have penalty
                }
            }

            // Calculate winning team score: 100 bonus + total card values - unmelded penalties
            let winningTeamCardTotal = 0;
            let winningTeamUnmelded = 0;
            for (let i = 0; i < this.players.length; i++) {
                const team = this.getPlayerTeam(i);
                const teamIndex = team === 'A' ? 0 : 1;
                if (teamIndex === winningTeamIndex) {
                    winningTeamCardTotal += this.playerCardTotals[i];
                    winningTeamUnmelded += this.playerPenalties[i];
                }
            }
            // Winning team: 100 + card total - unmelded = 100 + melded value
            this.teamScores[winningTeamIndex] = 100 + winningTeamCardTotal - winningTeamUnmelded;

            // Losing team gets penalties deducted (negative points)
            let losingTeamPenalty = 0;
            for (let i = 0; i < this.players.length; i++) {
                const team = this.getPlayerTeam(i);
                const teamIndex = team === 'A' ? 0 : 1;
                if (teamIndex === losingTeamIndex) {
                    losingTeamPenalty += this.playerPenalties[i];
                }
            }
            this.teamScores[losingTeamIndex] = -losingTeamPenalty;

            // Update match statistics
            this.matchStats.matchesPlayed++;
            this.matchStats.teamWins[winningTeamIndex]++;
            this.matchStats.totalPoints[0] += this.teamScores[0];
            this.matchStats.totalPoints[1] += this.teamScores[1];

            // Check if dealer's team won - if so, dealer rotates for next game
            const dealerTeam = this.getPlayerTeam(this.dealerPosition);
            const dealerTeamIndex = dealerTeam === 'A' ? 0 : 1;
            this.shouldRotateDealer = (dealerTeamIndex === winningTeamIndex);
        }

        // Move to next turn (counter-clockwise: 0 -> 3 -> 2 -> 1 -> 0)
        nextTurn() {
            // Counter-clockwise: subtract 1, wrap around
            this.currentPlayerIndex = (this.currentPlayerIndex - 1 + this.numPlayers) % this.numPlayers;
            this.gamePhase = 'draw';

            if (this.onTurnChange) this.onTurnChange(this.currentPlayerIndex);
            if (this.onPhaseChange) this.onPhaseChange('draw');
            if (this.onStateChange) this.onStateChange(this.getGameState());
        }

        // Reshuffle discard pile into stock when stock is empty
        reshuffleDiscardToStock() {
            if (this.discardPile.length <= 1) return;

            // Keep top card of discard
            const topCard = this.discardPile.pop();

            // Shuffle rest into stock - current dealer does the reshuffle
            this.shuffleCounts[this.dealerPosition]++;
            this.stockPile = shuffle([...this.discardPile]);
            this.discardPile = [topCard];
        }

        // Rotate dealer position counter-clockwise for next game
        rotateDealerPosition() {
            this.dealerPosition = (this.dealerPosition - 1 + this.numPlayers) % this.numPlayers;
        }

        // AI takes its turn
        async playAITurn() {
            const player = this.getCurrentPlayer();
            if (player.isHuman || this.gameOver) return;

            // Draw phase
            const discardTop = this.discardPile.length > 0 ?
                this.discardPile[this.discardPile.length - 1] : null;

            const drawSource = player.chooseDrawSource(discardTop, player.hand);

            await delay(500);

            if (drawSource === 'discard' && discardTop) {
                this.drawFromDiscard();
            } else {
                this.drawFromStock();
            }

            // Check if AI can declare Digu
            if (player.shouldDeclareDigu()) {
                await delay(500);
                this.declareDigu();
                return;
            }

            // Discard phase
            await delay(500);
            const toDiscard = player.chooseDiscard(player.hand);
            this.discardCard(toDiscard);
        }

        // Main game loop for AI turns
        async continueGame() {
            while (!this.gameOver && !this.isHumanTurn()) {
                await this.playAITurn();
            }
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

            // Dealer/shuffler tracking
            this.dealerPosition = 0; // Who is currently dealing
            this.shuffleCounts = [0, 0, 0, 0]; // How many times each player has shuffled

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
            this.dealerPosition = 0; // Human starts as dealer
            this.shuffleCounts = [0, 0, 0, 0];
            this.winTypeCount = [
                { normal: 0, 'all-tens': 0, shutout: 0 },
                { normal: 0, 'all-tens': 0, shutout: 0 }
            ];
            this.startRound();
        }

        startRound() {
            this.resetRound();
            // Current dealer shuffles - increment their count
            this.shuffleCounts[this.dealerPosition]++;
            this.dealCards();
            this.currentTrick = new Trick();
            // Reset AI memory for new round
            this.resetAIMemory();
            this.notifyStateChange();
        }

        // Reset all AI players' memory at round start
        resetAIMemory() {
            for (const player of this.players) {
                if (player instanceof AIPlayer && player.resetMemory) {
                    player.resetMemory();
                }
            }
        }

        // Record a play to all AI players' memory
        recordPlayToAI(position, card, ledSuit) {
            for (const player of this.players) {
                if (player instanceof AIPlayer && player.recordPlay) {
                    player.recordPlay(position, card, ledSuit);
                }
            }
        }

        // Called after round ends - only rotate if dealer's team won
        rotateDealer(roundWinner) {
            // Dealer's team: positions 0,2 = team 0, positions 1,3 = team 1
            const dealerTeam = this.dealerPosition % 2;

            // Only rotate if dealer's team won (or tie counts as no rotation)
            if (roundWinner === dealerTeam) {
                this.dealerPosition = (this.dealerPosition + 3) % 4; // counter-clockwise
            }
            // If dealer's team lost, same person shuffles again
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

            // Record play to AI memory for card tracking
            this.recordPlayToAI(player.position, playedCard, ledSuit);

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
                dealerPosition: this.dealerPosition,
                shuffleCounts: [...this.shuffleCounts],
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
                shuffleCounts: {
                    0: document.getElementById('shuffle-count-0'),
                    1: document.getElementById('shuffle-count-1'),
                    2: document.getElementById('shuffle-count-2'),
                    3: document.getElementById('shuffle-count-3')
                },
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

        updateShuffleCount(shuffleCounts, dealerPosition) {
            // Update all players' shuffle counts
            for (let i = 0; i < 4; i++) {
                const element = this.elements.shuffleCounts[i];
                if (element) {
                    element.textContent = `Shuffle: ${shuffleCounts[i]}`;
                    // Highlight the current dealer
                    element.classList.toggle('current-dealer', i === dealerPosition);
                }
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
            this.lastRoundWinner = -1; // Track last round winner for dealer rotation

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

            // Digu game components
            this.currentGameType = null; // 'dhiha-ei' or 'digu'
            this.diguGame = null;
            this.diguSelectedCards = [];
            this.diguActiveMeldSlot = null;
            this.diguNumPlayers = 4;

            // Touch drag state for mobile
            this.touchDragState = {
                isDragging: false,
                dragElement: null,
                dragClone: null,
                startIndex: -1,
                startCard: null,
                startX: 0,
                startY: 0,
                offsetX: 0,
                offsetY: 0,
                touchId: null,
                hasMoved: false
            };

            this.setupEventListeners();
            this.setupLobbyEventListeners();
            this.setupDiguEventListeners();
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

        // ============================================
        // DIGU GAME EVENT LISTENERS
        // ============================================

        setupDiguEventListeners() {
            // Digu game card in lobby
            const diguCard = document.querySelector('.game-card[data-game="digu"]');
            if (diguCard) {
                diguCard.querySelector('.game-select-btn').addEventListener('click', () => {
                    this.selectGame('digu');
                });
            }

            // Player count selection buttons
            document.querySelectorAll('.player-count-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    document.querySelectorAll('.player-count-btn').forEach(b => b.classList.remove('selected'));
                    e.target.classList.add('selected');
                    this.diguNumPlayers = parseInt(e.target.dataset.players);
                });
            });

            // Digu cancel button
            const diguCancelBtn = document.getElementById('digu-cancel-btn');
            if (diguCancelBtn) {
                diguCancelBtn.addEventListener('click', () => {
                    document.getElementById('digu-player-count-modal').classList.add('hidden');
                    this.showGameSelection();
                });
            }

            // Digu start button
            const diguStartBtn = document.getElementById('digu-start-btn');
            if (diguStartBtn) {
                diguStartBtn.addEventListener('click', () => {
                    document.getElementById('digu-player-count-modal').classList.add('hidden');
                    this.startDiguGame(this.diguNumPlayers);
                });
            }

            // Stock pile click/tap
            const stockPile = document.getElementById('digu-stock');
            if (stockPile) {
                stockPile.addEventListener('click', () => this.handleDiguDraw('stock'));
                // Touch support for mobile
                stockPile.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    this.handleDiguDraw('stock');
                }, { passive: false });
            }

            // Discard pile click/tap (for drawing) and drag-drop (for discarding)
            const discardPile = document.getElementById('digu-discard');
            if (discardPile) {
                discardPile.addEventListener('click', () => this.handleDiguDraw('discard'));
                // Touch support for mobile
                discardPile.addEventListener('touchend', (e) => {
                    // Only handle tap if we're not in the middle of a drag operation
                    if (!this.touchDragState.isDragging) {
                        e.preventDefault();
                        this.handleDiguDraw('discard');
                    }
                }, { passive: false });

                // Drag-and-drop to discard a card
                discardPile.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (this.canDiscardCard()) {
                        discardPile.classList.add('drag-over');
                    }
                });

                discardPile.addEventListener('dragleave', () => {
                    discardPile.classList.remove('drag-over');
                });

                discardPile.addEventListener('drop', (e) => {
                    e.preventDefault();
                    discardPile.classList.remove('drag-over');

                    if (!this.canDiscardCard()) return;

                    try {
                        const dragData = JSON.parse(e.dataTransfer.getData('application/json'));
                        const card = { suit: dragData.suit, rank: dragData.rank };
                        this.handleDiguDiscard(card);
                    } catch (err) {
                        console.log('Invalid drag data for discard');
                    }
                });
            }

            // Digu button click
            const diguBtn = document.getElementById('digu-btn');
            if (diguBtn) {
                diguBtn.addEventListener('click', () => this.handleDiguDeclare());
            }

            // Sort by suit button
            const sortBySuitBtn = document.getElementById('sort-by-suit-btn');
            if (sortBySuitBtn) {
                sortBySuitBtn.addEventListener('click', () => this.sortHandBySuit());
            }

            // Sort by rank button
            const sortByRankBtn = document.getElementById('sort-by-rank-btn');
            if (sortByRankBtn) {
                sortByRankBtn.addEventListener('click', () => this.sortHandByRank());
            }
        }

        // ============================================
        // DIGU GAME UI METHODS
        // ============================================

        startDiguGame(numPlayers) {
            this.currentGameType = 'digu';
            this.diguNumPlayers = numPlayers;

            // Hide lobby
            this.hideLobby();

            // Hide Thaasbai board, show Digu board
            document.getElementById('game-board').classList.add('hidden');
            document.getElementById('digu-game-board').classList.remove('hidden');

            // Hide Dhiha Ei specific elements
            const superiorSuit = document.getElementById('superior-suit-display');
            if (superiorSuit) superiorSuit.classList.add('hidden');

            // Initialize Digu game
            this.diguGame = new DiGuGame();

            // Bind game events
            this.diguGame.onStateChange = (state) => this.updateDiguDisplay();
            this.diguGame.onCardDrawn = (card, source) => this.onDiguCardDrawn(card, source);
            this.diguGame.onCardDiscarded = (card, player) => this.onDiguCardDiscarded(card, player);
            this.diguGame.onGameOver = (result) => this.onDiguGameOver(result);
            this.diguGame.onPhaseChange = (phase) => this.updateDiguPhase(phase);
            this.diguGame.onTurnChange = (playerIndex) => this.updateDiguTurn(playerIndex);

            // Start the game
            this.diguGame.startGame(numPlayers);

            // Reset UI state
            this.diguSelectedCards = [];
            this.diguActiveMeldSlot = null;

            // Initial display
            this.updateDiguDisplay();
        }

        updateDiguDisplay() {
            if (!this.diguGame) return;

            const state = this.diguGame.getGameState();

            // Update stock count
            const stockCount = document.getElementById('digu-stock-count');
            if (stockCount) {
                stockCount.textContent = state.stockCount;
            }

            // Update discard pile top card
            this.renderDiguDiscardTop(state.discardTop);

            // Update player hands
            this.renderDiguPlayers(state);

            // Update scores
            this.renderDiguScores(state);

            // Update DIGU button state
            this.updateDiguButton();

            // Update turn indicator
            this.updateDiguTurn(state.currentPlayerIndex);
        }

        renderDiguDiscardTop(card) {
            const discardTop = document.getElementById('digu-discard-top');
            if (!discardTop) return;

            discardTop.innerHTML = '';

            if (card) {
                const cardEl = CardSprite.createCardElement(card, true);
                cardEl.style.width = 'calc(9 * var(--scale))';
                cardEl.style.height = 'calc(12.9 * var(--scale))';
                discardTop.appendChild(cardEl);
            }
        }

        renderDiguPlayers(state) {
            for (let i = 0; i < state.numPlayers; i++) {
                const player = state.players[i];
                const playerEl = document.getElementById(`digu-player-${i}`);

                if (!playerEl) continue;

                // Show/hide based on player count
                if (i >= state.numPlayers) {
                    playerEl.classList.add('hidden');
                    continue;
                }
                playerEl.classList.remove('hidden');

                // Update label
                const labelEl = playerEl.querySelector('.digu-player-label');
                if (labelEl) {
                    labelEl.textContent = player.name;
                }

                // Update avatar icon (for AI players)
                const avatarIcon = playerEl.querySelector('.digu-avatar-icon');
                if (avatarIcon) {
                    avatarIcon.textContent = player.name.charAt(0).toUpperCase();
                }

                // Update card count
                const countEl = playerEl.querySelector('.digu-card-count');
                if (countEl) {
                    countEl.textContent = `${player.hand.length} cards`;
                }

                // Update shuffle count
                const shuffleEl = document.getElementById(`digu-shuffle-count-${i}`);
                if (shuffleEl) {
                    shuffleEl.textContent = `Shuffle: ${state.shuffleCounts[i]}`;
                    // Highlight current dealer
                    shuffleEl.classList.toggle('current-dealer', i === state.dealerPosition);
                }

                // Render hand area
                const handEl = playerEl.querySelector('.digu-player-hand');
                if (handEl) {
                    handEl.innerHTML = '';

                    if (i === 0) {
                        // Human player - show face up cards with drag-and-drop
                        // Find all valid consecutive melds (3 or 4 cards) anywhere in hand
                        const validMelds = this.findAllValidMelds(player.hand);
                        const meldResult = player.getMeldsFromHand();
                        const canDeclare = meldResult.valid !== false;

                        player.hand.forEach((card, cardIndex) => {
                            // Add discard separator before position 10
                            if (cardIndex === 10) {
                                const separator = document.createElement('div');
                                separator.className = 'discard-separator';
                                handEl.appendChild(separator);
                            }

                            const cardEl = CardSprite.createCardElement(card, true);
                            const isSelected = this.diguSelectedCards.some(c =>
                                c.suit === card.suit && c.rank === card.rank
                            );
                            if (isSelected) {
                                cardEl.classList.add('selected');
                            }

                            // Check if this card is part of a valid consecutive meld
                            const meldInfo = validMelds.find(m =>
                                cardIndex >= m.start && cardIndex < m.start + m.length
                            );

                            if (meldInfo) {
                                cardEl.classList.add('valid-meld-card');
                                if (meldInfo.type === 'set') {
                                    cardEl.classList.add('meld-set');
                                } else {
                                    cardEl.classList.add('meld-run');
                                }
                                // Add separator after meld ends (before next card)
                                if (cardIndex === meldInfo.start + meldInfo.length - 1 && cardIndex < 9) {
                                    cardEl.classList.add('meld-end');
                                }
                            }

                            // Mark as discard card if position 10
                            if (cardIndex === 10) {
                                cardEl.classList.add('discard-card-highlight');
                            }

                            cardEl.addEventListener('click', () => this.handleDiguCardClick(card));

                            // Drag-and-drop for rearranging and discarding
                            cardEl.draggable = true;
                            cardEl.dataset.cardIndex = cardIndex;
                            cardEl.dataset.cardSuit = card.suit;
                            cardEl.dataset.cardRank = card.rank;

                            cardEl.addEventListener('dragstart', (e) => {
                                // Store both index and card info for different drop targets
                                const dragData = JSON.stringify({
                                    index: cardIndex,
                                    suit: card.suit,
                                    rank: card.rank
                                });
                                e.dataTransfer.setData('application/json', dragData);
                                e.dataTransfer.setData('text/plain', cardIndex.toString());
                                cardEl.classList.add('dragging');
                            });

                            cardEl.addEventListener('dragend', () => {
                                cardEl.classList.remove('dragging');
                                // Remove drag-over from discard pile
                                const discardPile = document.getElementById('digu-discard');
                                if (discardPile) discardPile.classList.remove('drag-over');
                            });

                            cardEl.addEventListener('dragover', (e) => {
                                e.preventDefault();
                                cardEl.classList.add('drag-over');
                            });

                            cardEl.addEventListener('dragleave', () => {
                                cardEl.classList.remove('drag-over');
                            });

                            cardEl.addEventListener('drop', (e) => {
                                e.preventDefault();
                                cardEl.classList.remove('drag-over');
                                const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                                const toIndex = cardIndex;
                                if (fromIndex !== toIndex) {
                                    this.moveCardInHand(fromIndex, toIndex);
                                }
                            });

                            // Touch events for mobile drag and drop
                            cardEl.addEventListener('touchstart', (e) => {
                                this.handleTouchDragStart(e, cardEl, cardIndex, card);
                            }, { passive: false });

                            cardEl.addEventListener('touchmove', (e) => {
                                this.handleTouchDragMove(e);
                            }, { passive: false });

                            cardEl.addEventListener('touchend', (e) => {
                                this.handleTouchDragEnd(e);
                            }, { passive: false });

                            handEl.appendChild(cardEl);
                        });
                    }
                    // AI players - no cards shown, just avatar (handled in HTML/CSS)
                }

                // Update turn indicator
                playerEl.classList.toggle('current-turn', i === state.currentPlayerIndex);
            }

            // Hide unused player slots
            for (let i = state.numPlayers; i < 4; i++) {
                const playerEl = document.getElementById(`digu-player-${i}`);
                if (playerEl) {
                    playerEl.classList.add('hidden');
                }
            }
        }

        renderDiguScores(state) {
            if (!this.diguGame) return;

            const stats = this.diguGame.matchStats;

            // Update games count
            const gamesCount = document.getElementById('digu-games-count');
            if (gamesCount) {
                gamesCount.textContent = stats.matchesPlayed;
            }

            // Update team wins
            const teamAWins = document.getElementById('team-a-wins');
            const teamBWins = document.getElementById('team-b-wins');
            if (teamAWins) {
                teamAWins.textContent = `${stats.teamWins[0]} wins`;
            }
            if (teamBWins) {
                teamBWins.textContent = `${stats.teamWins[1]} wins`;
            }

            // Update total scores
            const teamAScore = document.getElementById('team-a-score');
            const teamBScore = document.getElementById('team-b-score');
            if (teamAScore) {
                teamAScore.textContent = stats.totalPoints[0];
            }
            if (teamBScore) {
                teamBScore.textContent = stats.totalPoints[1];
            }
        }

        updateDiguPhase(phase) {
            const phaseEl = document.getElementById('digu-phase');
            if (!phaseEl) return;

            phaseEl.classList.remove('draw-phase', 'meld-phase', 'discard-phase');

            let text = '';
            switch (phase) {
                case 'draw':
                    text = 'Draw a card';
                    phaseEl.classList.add('draw-phase');
                    break;
                case 'meld':
                    text = 'Arrange melds & discard';
                    phaseEl.classList.add('meld-phase');
                    break;
                case 'discard':
                    text = 'Discard a card';
                    phaseEl.classList.add('discard-phase');
                    break;
                case 'gameover':
                    text = 'Game Over';
                    break;
                default:
                    text = 'Waiting...';
            }

            phaseEl.textContent = text;
        }

        updateDiguTurn(playerIndex) {
            // Update player area highlights
            for (let i = 0; i < 4; i++) {
                const playerEl = document.getElementById(`digu-player-${i}`);
                if (playerEl) {
                    playerEl.classList.toggle('current-turn', i === playerIndex);
                }
            }

            // Update phase text if it's not human's turn
            if (playerIndex !== 0 && this.diguGame) {
                const phaseEl = document.getElementById('digu-phase');
                if (phaseEl) {
                    const playerName = this.diguGame.players[playerIndex].name;
                    phaseEl.textContent = `${playerName}'s turn`;
                }
            }
        }

        updateDiguButton() {
            const btn = document.getElementById('digu-btn');
            if (!btn || !this.diguGame) return;

            const player = this.diguGame.players[0];
            const hasValidMelds = player.canDeclareDigu();
            const isMyTurn = this.diguGame.isHumanTurn();

            // Show button only on your turn when all cards form valid melds
            // You can arrange cards at any time, but button only appears on your turn
            if (hasValidMelds && isMyTurn) {
                btn.classList.remove('hidden');
                btn.disabled = false;
            } else {
                btn.classList.add('hidden');
            }
        }

        handleDiguDraw(source) {
            if (!this.diguGame || !this.diguGame.isHumanTurn()) return;
            if (this.diguGame.gamePhase !== 'draw') return;

            if (source === 'stock') {
                this.diguGame.drawFromStock();
            } else {
                this.diguGame.drawFromDiscard();
            }

            this.updateDiguDisplay();
        }

        handleDiguCardClick(card) {
            if (!this.diguGame) return;

            // Check if card is already in a meld
            const player = this.diguGame.players[0];
            const inMeld = player.getCardsInMelds().some(c =>
                c.suit === card.suit && c.rank === card.rank
            );
            if (inMeld) return;

            // Toggle selection
            const isSelected = this.diguSelectedCards.some(c =>
                c.suit === card.suit && c.rank === card.rank
            );

            if (isSelected) {
                // Deselect
                this.diguSelectedCards = this.diguSelectedCards.filter(c =>
                    !(c.suit === card.suit && c.rank === card.rank)
                );
            } else {
                // Select for meld
                this.diguSelectedCards.push(card);
            }

            this.updateDiguDisplay();
        }

        // Find all valid consecutive melds (3 or 4 cards) in hand
        findAllValidMelds(hand) {
            const validMelds = [];
            const maxIndex = Math.min(hand.length, 10); // Only check first 10 cards

            // Scan for valid melds of size 3 and 4
            for (let size = 4; size >= 3; size--) {
                for (let start = 0; start <= maxIndex - size; start++) {
                    // Check if this position overlaps with existing meld
                    const overlaps = validMelds.some(m =>
                        (start >= m.start && start < m.start + m.length) ||
                        (start + size > m.start && start + size <= m.start + m.length) ||
                        (start <= m.start && start + size >= m.start + m.length)
                    );
                    if (overlaps) continue;

                    const group = hand.slice(start, start + size);

                    // Check if valid set
                    if (DiGuRules.isValidSet(group)) {
                        validMelds.push({ start, length: size, type: 'set' });
                        continue;
                    }

                    // Check if valid run
                    if (DiGuRules.isValidRun(group)) {
                        validMelds.push({ start, length: size, type: 'run' });
                    }
                }
            }

            // Sort by start position
            validMelds.sort((a, b) => a.start - b.start);
            return validMelds;
        }

        // Check if player can discard a card (for drag-drop validation)
        canDiscardCard() {
            if (!this.diguGame || !this.diguGame.isHumanTurn()) return false;
            if (this.diguGame.gamePhase !== 'meld') return false;
            const player = this.diguGame.players[0];
            return player.hand.length === 11;
        }

        // Handle discard - drag card to discard pile
        handleDiguDiscard(card) {
            if (!this.diguGame || !this.diguGame.isHumanTurn()) return;
            if (this.diguGame.gamePhase !== 'meld') return;

            const player = this.diguGame.players[0];
            if (player.hand.length !== 11) return;

            // Discard this card
            this.diguGame.discardCard(card);
            this.diguSelectedCards = [];
            this.updateDiguDisplay();

            // Continue with AI turns
            this.diguGame.continueGame();
        }

        sortHandBySuit() {
            if (!this.diguGame) return;

            const player = this.diguGame.players[0];
            const suitOrder = { 'spades': 0, 'hearts': 1, 'diamonds': 2, 'clubs': 3 };
            const rankOrder = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };

            player.hand.sort((a, b) => {
                const suitDiff = suitOrder[a.suit] - suitOrder[b.suit];
                if (suitDiff !== 0) return suitDiff;
                return rankOrder[b.rank] - rankOrder[a.rank]; // High to low within suit
            });

            this.updateDiguDisplay();
        }

        sortHandByRank() {
            if (!this.diguGame) return;

            const player = this.diguGame.players[0];
            const suitOrder = { 'spades': 0, 'hearts': 1, 'diamonds': 2, 'clubs': 3 };
            const rankOrder = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };

            player.hand.sort((a, b) => {
                const rankDiff = rankOrder[b.rank] - rankOrder[a.rank]; // High to low
                if (rankDiff !== 0) return rankDiff;
                return suitOrder[a.suit] - suitOrder[b.suit];
            });

            this.updateDiguDisplay();
        }

        moveCardInHand(fromIndex, toIndex) {
            if (!this.diguGame) return;

            const player = this.diguGame.players[0];
            if (fromIndex < 0 || fromIndex >= player.hand.length) return;
            if (toIndex < 0 || toIndex >= player.hand.length) return;

            const card = player.hand.splice(fromIndex, 1)[0];
            player.hand.splice(toIndex, 0, card);

            this.updateDiguDisplay();
        }

        handleDiguDeclare() {
            if (!this.diguGame || !this.diguGame.isHumanTurn()) return;

            const result = this.diguGame.declareDigu();

            if (!result.success) {
                this.renderer.flashMessage(result.message, 2000);
            }
        }

        onDiguCardDrawn(card, source) {
            // Card drawn animation could go here
            this.updateDiguDisplay();
        }

        onDiguCardDiscarded(card, player) {
            // Card discarded animation could go here
            this.updateDiguDisplay();
        }

        // Touch drag handlers for mobile - improved for rotated game container
        handleTouchDragStart(e, cardEl, cardIndex, card) {
            // Prevent default to stop scrolling
            e.preventDefault();
            e.stopPropagation();

            const touch = e.touches[0];
            const rect = cardEl.getBoundingClientRect();

            // Check if game container is rotated (mobile portrait mode)
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const isRotated = vw < vh;

            this.touchDragState = {
                isDragging: true,
                dragElement: cardEl,
                startIndex: cardIndex,
                startCard: card,
                startX: touch.clientX,
                startY: touch.clientY,
                offsetX: touch.clientX - rect.left,
                offsetY: touch.clientY - rect.top,
                dragClone: null,
                hasMoved: false,
                touchId: touch.identifier,
                isRotated: isRotated
            };

            // Create clone immediately for visual feedback
            const clone = cardEl.cloneNode(true);
            clone.classList.add('touch-drag-clone');

            // For rotated container, counter-rotate the clone
            // since it's appended to body (not rotated) but viewed in rotated context
            const rotation = isRotated ? 'rotate(-90deg)' : '';

            // Position clone at the card's visual position
            // No scale needed - elements scale proportionally via --scale CSS variable
            clone.style.cssText = `
                position: fixed !important;
                left: ${rect.left}px;
                top: ${rect.top}px;
                z-index: 10000 !important;
                pointer-events: none !important;
                opacity: 0.9 !important;
                transform: ${rotation} !important;
                transform-origin: top left !important;
                box-shadow: 0 4px 15px rgba(0,0,0,0.4) !important;
                transition: none !important;
                animation: none !important;
            `;

            document.body.appendChild(clone);
            this.touchDragState.dragClone = clone;

            cardEl.classList.add('dragging');
        }

        handleTouchDragMove(e) {
            if (!this.touchDragState.isDragging) return;
            e.preventDefault();
            e.stopPropagation();

            // Find the correct touch
            let touch = null;
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].identifier === this.touchDragState.touchId) {
                    touch = e.touches[i];
                    break;
                }
            }
            if (!touch) touch = e.touches[0];

            const dx = Math.abs(touch.clientX - this.touchDragState.startX);
            const dy = Math.abs(touch.clientY - this.touchDragState.startY);

            // Mark as moved if moved more than small threshold
            if (dx > 5 || dy > 5) {
                this.touchDragState.hasMoved = true;
            }

            // Move the clone to follow finger (using fixed positioning)
            if (this.touchDragState.dragClone) {
                this.touchDragState.dragClone.style.left = `${touch.clientX - this.touchDragState.offsetX}px`;
                this.touchDragState.dragClone.style.top = `${touch.clientY - this.touchDragState.offsetY}px`;

                // Highlight potential drop targets
                this.highlightTouchDropTarget(touch.clientX, touch.clientY);
            }
        }

        handleTouchDragEnd(e) {
            if (!this.touchDragState.isDragging) return;
            e.preventDefault();
            e.stopPropagation();

            // Find the correct touch
            let touch = null;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === this.touchDragState.touchId) {
                    touch = e.changedTouches[i];
                    break;
                }
            }
            if (!touch) touch = e.changedTouches[0];

            // Remove clone
            if (this.touchDragState.dragClone) {
                this.touchDragState.dragClone.remove();
            }

            // Remove dragging class
            if (this.touchDragState.dragElement) {
                this.touchDragState.dragElement.classList.remove('dragging');
            }

            // Clear highlights
            this.clearTouchDropHighlights();

            // Process drop if we moved enough
            if (this.touchDragState.hasMoved) {
                // Find drop target at touch end position
                const dropTarget = this.findTouchDropTarget(touch.clientX, touch.clientY);

                if (dropTarget) {
                    if (dropTarget.type === 'card') {
                        // Move card to new position in hand
                        this.moveCardInHand(this.touchDragState.startIndex, dropTarget.index);
                    } else if (dropTarget.type === 'discard') {
                        // Discard the card
                        if (this.canDiscardCard()) {
                            this.handleDiguDiscard(this.touchDragState.startCard);
                        }
                    }
                }
            }

            // Reset state
            this.touchDragState = {
                isDragging: false,
                dragElement: null,
                dragClone: null,
                startIndex: -1,
                startCard: null,
                startX: 0,
                startY: 0,
                offsetX: 0,
                offsetY: 0,
                touchId: null,
                hasMoved: false
            };
        }

        highlightTouchDropTarget(x, y) {
            // Clear previous highlights
            this.clearTouchDropHighlights();

            // Check discard pile
            const discardPile = document.getElementById('digu-discard');
            if (discardPile) {
                const rect = discardPile.getBoundingClientRect();
                if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                    if (this.canDiscardCard()) {
                        discardPile.classList.add('drag-over');
                    }
                    return;
                }
            }

            // Highlight closest card in hand
            const handEl = document.querySelector('.digu-player.bottom .digu-player-hand');
            if (handEl) {
                const cards = Array.from(handEl.querySelectorAll('.card'));
                const handRect = handEl.getBoundingClientRect();

                // Only highlight if within hand area
                if (y >= handRect.top - 50 && y <= handRect.bottom + 50) {
                    let closestCard = null;
                    let closestDistance = Infinity;

                    for (const card of cards) {
                        if (card === this.touchDragState.dragElement) continue;
                        const rect = card.getBoundingClientRect();
                        const cardCenterX = rect.left + rect.width / 2;
                        const distance = Math.abs(x - cardCenterX);

                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestCard = card;
                        }
                    }

                    if (closestCard && closestDistance < 100) {
                        closestCard.classList.add('drag-over');
                    }
                }
            }
        }

        clearTouchDropHighlights() {
            // Clear discard pile highlight
            const discardPile = document.getElementById('digu-discard');
            if (discardPile) {
                discardPile.classList.remove('drag-over');
            }

            // Clear card highlights
            const handEl = document.querySelector('.digu-player.bottom .digu-player-hand');
            if (handEl) {
                handEl.querySelectorAll('.card.drag-over').forEach(card => {
                    card.classList.remove('drag-over');
                });
            }
        }

        findTouchDropTarget(x, y) {
            // Check discard pile first
            const discardPile = document.getElementById('digu-discard');
            if (discardPile) {
                const rect = discardPile.getBoundingClientRect();
                if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                    return { type: 'discard' };
                }
            }

            // Check cards - find closest card by horizontal position
            const handEl = document.querySelector('.digu-player.bottom .digu-player-hand');
            if (handEl) {
                const cards = Array.from(handEl.querySelectorAll('.card'));
                const handRect = handEl.getBoundingClientRect();

                // Only process if within hand area (with some vertical tolerance)
                if (y >= handRect.top - 50 && y <= handRect.bottom + 50) {
                    let closestCard = null;
                    let closestDistance = Infinity;

                    for (const card of cards) {
                        if (card === this.touchDragState.dragElement) continue;
                        const rect = card.getBoundingClientRect();
                        const cardCenterX = rect.left + rect.width / 2;
                        const distance = Math.abs(x - cardCenterX);

                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestCard = card;
                        }
                    }

                    if (closestCard && closestDistance < 100) {
                        const index = parseInt(closestCard.dataset.cardIndex);
                        if (!isNaN(index)) {
                            // Determine if dropping before or after based on position
                            const rect = closestCard.getBoundingClientRect();
                            const cardCenterX = rect.left + rect.width / 2;
                            const dropBefore = x < cardCenterX;

                            // Adjust index based on original position
                            const fromIndex = this.touchDragState.startIndex;
                            let targetIndex = index;

                            if (dropBefore && index > fromIndex) {
                                targetIndex = index - 1;
                            } else if (!dropBefore && index < fromIndex) {
                                targetIndex = index + 1;
                            } else if (!dropBefore) {
                                targetIndex = index;
                            }

                            return { type: 'card', index: targetIndex };
                        }
                    }
                }
            }

            return null;
        }

        async onDiguGameOver(result) {
            this.updateDiguDisplay();
            this.showDiguResultModal(result);
        }

        showDiguResultModal(result) {
            const modal = document.getElementById('digu-result-modal');
            const titleEl = document.getElementById('digu-result-title');
            const playersContainer = document.getElementById('digu-result-players');
            const gameScoreEl = document.querySelector('.digu-game-score');

            const winningTeam = result.winningTeam;
            const isYourTeamWinner = winningTeam === 'A';

            // Set title with appropriate styling
            titleEl.textContent = isYourTeamWinner ? 'Your Team Wins!' : 'Opponents Win!';
            titleEl.className = isYourTeamWinner ? 'win' : 'lose';

            // Update match stats display
            const stats = result.matchStats;
            document.getElementById('digu-matches-played').textContent = stats.matchesPlayed;
            document.getElementById('digu-team-a-wins').textContent = stats.teamWins[0];
            document.getElementById('digu-team-b-wins').textContent = stats.teamWins[1];
            document.getElementById('digu-total-points-a').textContent = stats.totalPoints[0];
            document.getElementById('digu-total-points-b').textContent = stats.totalPoints[1];

            // Calculate winning team breakdown
            const winningTeamIndex = isYourTeamWinner ? 0 : 1;
            const losingTeamIndex = isYourTeamWinner ? 1 : 0;
            const winningTeamPlayers = isYourTeamWinner ? [0, 2] : [1, 3];

            let winningMeldedTotal = 0;
            for (const pi of winningTeamPlayers) {
                winningMeldedTotal += result.playerMeldedValues[pi] || 0;
            }

            // Update this game score section
            gameScoreEl.innerHTML = `
                <h3>This Game - ${result.winner.name} declared DIGU!</h3>
                <div class="game-score-row">
                    <span>${isYourTeamWinner ? 'Your Team' : 'Opponents'} Bonus:</span>
                    <span>+100</span>
                </div>
                <div class="game-score-row">
                    <span>Total Melded Card Value:</span>
                    <span>+${winningMeldedTotal}</span>
                </div>
                <div class="game-score-row winner">
                    <span>${isYourTeamWinner ? 'Your Team' : 'Opponents'} Total:</span>
                    <span>+${result.teamScores[winningTeamIndex]}</span>
                </div>
                <div class="game-score-row penalty">
                    <span>${isYourTeamWinner ? 'Opponents' : 'Your Team'} (Penalty):</span>
                    <span>${result.teamScores[losingTeamIndex]}</span>
                </div>
            `;

            // Render all players' cards
            playersContainer.innerHTML = '';
            for (let i = 0; i < result.players.length; i++) {
                const player = result.players[i];
                const isWinner = player === result.winner;
                const team = this.diguGame.getPlayerTeam(i);
                const teamName = team === 'A' ? 'Your Team' : 'Opponents';
                const penalty = result.playerPenalties[i];
                const cardTotal = result.playerCardTotals[i] || 0;
                const meldedValue = result.playerMeldedValues[i] || 0;
                const isWinningTeam = (team === 'A' && isYourTeamWinner) || (team === 'B' && !isYourTeamWinner);

                const playerRow = document.createElement('div');
                playerRow.className = `result-player-row ${isWinner ? 'winner' : (isWinningTeam ? 'winner' : 'loser')}`;

                // Player header
                const headerEl = document.createElement('div');
                headerEl.className = 'result-player-header';

                const nameEl = document.createElement('span');
                nameEl.className = `result-player-name ${i === 0 ? 'you' : ''}`;
                nameEl.innerHTML = `${player.name} <span class="result-player-team">(${teamName})</span>`;
                if (isWinner) nameEl.innerHTML += ' - DIGU!';

                const scoreEl = document.createElement('span');
                if (isWinningTeam) {
                    // Winning team: show melded value
                    scoreEl.className = 'result-player-score positive';
                    scoreEl.textContent = `Melded: +${meldedValue}`;
                } else {
                    // Losing team: show penalty
                    scoreEl.className = `result-player-score ${penalty > 0 ? 'negative' : 'positive'}`;
                    scoreEl.textContent = penalty > 0 ? `Unmelded: -${penalty}` : 'All melded!';
                }

                headerEl.appendChild(nameEl);
                headerEl.appendChild(scoreEl);
                playerRow.appendChild(headerEl);

                // Player cards with meld grouping
                const cardsEl = document.createElement('div');
                cardsEl.className = 'result-player-cards';

                const meldDetails = player.getMeldDetails();
                for (const meld of meldDetails) {
                    const meldGroup = document.createElement('div');
                    meldGroup.className = `meld-group ${meld.valid ? `valid-${meld.type}` : 'invalid'}`;

                    for (const card of meld.cards) {
                        const cardEl = CardSprite.createCardElement(card, true);
                        meldGroup.appendChild(cardEl);
                    }

                    cardsEl.appendChild(meldGroup);
                }

                playerRow.appendChild(cardsEl);
                playersContainer.appendChild(playerRow);
            }

            // Show modal
            modal.classList.remove('hidden');

            // Set up button handlers
            this.setupDiguResultButtons();
        }

        setupDiguResultButtons() {
            const nextGameBtn = document.getElementById('digu-next-game-btn');
            const newMatchBtn = document.getElementById('digu-new-match-btn');
            const exitBtn = document.getElementById('digu-exit-btn');

            // Remove old handlers
            nextGameBtn.replaceWith(nextGameBtn.cloneNode(true));
            newMatchBtn.replaceWith(newMatchBtn.cloneNode(true));
            exitBtn.replaceWith(exitBtn.cloneNode(true));

            // Re-get elements after cloning
            const newNextBtn = document.getElementById('digu-next-game-btn');
            const newNewMatchBtn = document.getElementById('digu-new-match-btn');
            const newExitBtn = document.getElementById('digu-exit-btn');

            newNextBtn.addEventListener('click', () => {
                document.getElementById('digu-result-modal').classList.add('hidden');
                this.diguGame.startNextGame();
                this.diguSelectedCards = [];
                this.updateDiguDisplay();
            });

            newNewMatchBtn.addEventListener('click', () => {
                document.getElementById('digu-result-modal').classList.add('hidden');
                this.diguGame.resetMatchStats();
                this.diguGame.startGame(4);
                this.diguSelectedCards = [];
                this.updateDiguDisplay();
            });

            newExitBtn.addEventListener('click', () => {
                document.getElementById('digu-result-modal').classList.add('hidden');
                this.returnToDiguLobby();
            });
        }

        returnToDiguLobby() {
            // Hide Digu board
            document.getElementById('digu-game-board').classList.add('hidden');

            // Show lobby
            this.showLobby();
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
            const diguModal = document.getElementById('digu-player-count-modal');

            if (gameSelection) gameSelection.classList.remove('hidden');
            if (gameLobby) gameLobby.classList.add('hidden');
            if (diguModal) diguModal.classList.add('hidden');

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
            this.currentGameType = gameName;

            // Update titles based on selected game
            if (gameName === 'dhiha-ei') {
                if (selectedGameTitle) selectedGameTitle.textContent = 'Dhiha Ei';
                if (currentGameName) currentGameName.textContent = 'Dhiha Ei';

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
            } else if (gameName === 'digu') {
                if (selectedGameTitle) selectedGameTitle.textContent = 'Digu';
                if (currentGameName) currentGameName.textContent = 'Digu';

                // Digu is always 4 players in teams - start directly
                this.startDiguGame(4);
            }
        }

        // Show lobby overlay
        showLobby() {
            // Hide game container
            document.getElementById('game-container').classList.add('hidden');
            document.getElementById('game-container').classList.remove('multiplayer-mode');

            // Hide Digu game board
            const diguBoard = document.getElementById('digu-game-board');
            if (diguBoard) diguBoard.classList.add('hidden');

            // Show Thaasbai board (for when switching games)
            const gameBoard = document.getElementById('game-board');
            if (gameBoard) gameBoard.classList.remove('hidden');

            // Show superior suit display (for Dhiha Ei)
            const superiorSuit = document.getElementById('superior-suit-display');
            if (superiorSuit) superiorSuit.classList.remove('hidden');

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
            this.lastRoundWinner = -1;
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

        async startNextRound(roundWinner = -1) {
            this.isProcessing = false;
            this.selectedCard = null;
            this.game.rotateDealer(roundWinner); // Only rotate if dealer's team won
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
            this.renderer.updateShuffleCount(state.shuffleCounts, state.dealerPosition);
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
                // Store the round winner for when all players are ready
                this.lastRoundWinner = result.winner;
                await this.renderer.showMessage(title, text, 'Ready for Next Round');
                this.showReadyForNextRound();
            } else {
                // AI game - show options for next round or end game
                const choice = await this.renderer.showMessageWithOptions(title, text, 'Next Round', 'End Game');
                if (choice === 'primary') {
                    this.startNextRound(result.winner);
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
                // Only rotate dealer if their team won the round
                this.game.rotateDealer(this.lastRoundWinner);
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
            },
            // Digu game utilities
            digu: {
                DiGuRules,
                DiGuPlayer,
                DiGuGame,
                DiGuAI,
                getGame: () => ui.diguGame,
                getState: () => ui.diguGame ? ui.diguGame.getGameState() : null
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
