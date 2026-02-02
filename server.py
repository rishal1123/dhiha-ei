"""
Thaasbai - Multiplayer Game Server
Python WebSocket server using Flask-SocketIO
Supports: Dhiha Ei, Digu

Optimized for ~1000 concurrent players with:
- Eventlet async mode for better concurrency
- Connection limits per IP
- Rate limiting for socket events
"""

import os
import random
import string
import time
import json
import threading
from collections import defaultdict
from functools import wraps

# Try to use eventlet for better concurrency (handles 3x more connections)
try:
    import eventlet
    eventlet.monkey_patch()
    ASYNC_MODE = 'eventlet'
    print("Using eventlet async mode (optimized for high concurrency)")
except ImportError:
    ASYNC_MODE = 'threading'
    print("Eventlet not available, falling back to threading mode")

from flask import Flask, send_from_directory, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS

app = Flask(__name__, static_folder='.', static_url_path='')

# ===========================================
# RATE LIMITING & CONNECTION MANAGEMENT
# ===========================================

# Connection limits
MAX_CONNECTIONS_PER_IP = 10  # Max concurrent connections from single IP
CONNECTION_RATE_LIMIT = 5    # Max new connections per second per IP

# Rate limiting for socket events (events per minute)
RATE_LIMITS = {
    'create_room': 5,
    'join_room': 10,
    'join_queue': 10,
    'card_played': 120,      # ~2 per second during game
    'digu_draw_card': 60,
    'digu_discard_card': 60,
    'digu_declare': 10,
    'default': 60
}

# Track connections and rates per IP
ip_connections = defaultdict(int)  # IP -> connection count
ip_connection_times = defaultdict(list)  # IP -> list of connection timestamps
event_rate_tracking = defaultdict(lambda: defaultdict(list))  # sid -> event -> timestamps

# Server-side logging for admin review
MAX_SERVER_LOGS = 1000  # Keep last 1000 logs
LOG_RETENTION_DAYS = 7  # Delete logs older than 7 days
server_logs = []  # List of log entries

def add_server_log(level, category, message, details=None, ip=None):
    """Add a log entry to server logs"""
    global server_logs

    entry = {
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'level': level,
        'category': category,
        'message': message,
        'details': details,
        'ip': ip or 'server',
        'url': 'server'
    }

    server_logs.append(entry)

    # Cleanup old logs (older than 7 days)
    cutoff_time = time.time() - (LOG_RETENTION_DAYS * 24 * 60 * 60)

    def parse_log_timestamp(ts):
        """Parse timestamp, handling optional milliseconds"""
        try:
            # Remove milliseconds and Z suffix if present
            if '.' in ts:
                ts = ts.split('.')[0]
            return time.mktime(time.strptime(ts, '%Y-%m-%dT%H:%M:%S'))
        except:
            return time.time()  # Default to now if parsing fails

    server_logs = [
        log for log in server_logs
        if parse_log_timestamp(log['timestamp']) > cutoff_time
    ]

    # Also trim to max size
    if len(server_logs) > MAX_SERVER_LOGS:
        server_logs = server_logs[-MAX_SERVER_LOGS:]

    # Print to console as well
    print(f"[{level.upper()}] [{category}] {message}")

def get_client_ip():
    """Get client IP, handling proxies"""
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    return request.remote_addr or '127.0.0.1'

def check_connection_limit(ip):
    """Check if IP has exceeded connection limit"""
    if ip_connections[ip] >= MAX_CONNECTIONS_PER_IP:
        return False

    # Check connection rate
    now = time.time()
    ip_connection_times[ip] = [t for t in ip_connection_times[ip] if now - t < 1]
    if len(ip_connection_times[ip]) >= CONNECTION_RATE_LIMIT:
        return False

    return True

def rate_limit(event_name):
    """Decorator to rate limit socket events"""
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            sid = request.sid
            now = time.time()

            # Get rate limit for this event
            limit = RATE_LIMITS.get(event_name, RATE_LIMITS['default'])
            window = 60  # 1 minute window

            # Clean old timestamps and check rate
            event_rate_tracking[sid][event_name] = [
                t for t in event_rate_tracking[sid][event_name] if now - t < window
            ]

            if len(event_rate_tracking[sid][event_name]) >= limit:
                print(f"Rate limit exceeded for {event_name} by {sid}")
                emit('error', {'message': 'Rate limit exceeded. Please slow down.'})
                return

            # Record this event
            event_rate_tracking[sid][event_name].append(now)

            return f(*args, **kwargs)
        return wrapped
    return decorator

# Admin config
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'thaasbai2026')
SPONSORS_FILE = 'sponsors.json'
CAMPAIGNS_FILE = 'campaigns.json'

import uuid
import hashlib
from datetime import datetime

def hash_password(password):
    """Simple password hashing"""
    return hashlib.sha256(password.encode()).hexdigest()

def load_campaigns():
    """Load campaigns data from JSON file"""
    if os.path.exists(CAMPAIGNS_FILE):
        try:
            with open(CAMPAIGNS_FILE, 'r') as f:
                return json.load(f)
        except:
            pass
    return {
        'customers': {},
        'campaigns': {},
        'active_sponsors': {
            'table': None,
            'drink': None,
            'food': None,
            'matchmaking': None,
            'waiting_room': None
        }
    }

def save_campaigns(data):
    """Save campaigns data to JSON file"""
    with open(CAMPAIGNS_FILE, 'w') as f:
        json.dump(data, f, indent=2)

# Load campaigns data
campaigns_data = load_campaigns()

def load_sponsors():
    """Load sponsors from JSON file"""
    if os.path.exists(SPONSORS_FILE):
        try:
            with open(SPONSORS_FILE, 'r') as f:
                return json.load(f)
        except:
            pass
    # Default sponsors config
    return {
        'table': {
            'name': 'Ooredoo Maldives',
            'logo': '/icons/sponsors/ooredoo.svg',
            'url': 'https://www.ooredoo.mv',
            'enabled': True,
            'callout': 'Stay connected! 📶'
        },
        'drink': {
            'name': 'Drink Sponsor',
            'logo': '',
            'url': '',
            'enabled': False,
            'callout': ''
        },
        'food': {
            'name': 'Food Sponsor',
            'logo': '',
            'url': '',
            'enabled': False,
            'callout': ''
        },
        'matchmaking': {
            'name': 'Ooredoo Maldives',
            'logo': '/icons/sponsors/ooredoo.svg',
            'url': 'https://www.ooredoo.mv',
            'enabled': True,
            'callout': ''
        },
        'waiting_room': {
            'name': 'Ooredoo Maldives',
            'logo': '/icons/sponsors/ooredoo.svg',
            'url': 'https://www.ooredoo.mv',
            'enabled': True,
            'callout': ''
        }
    }

def save_sponsors(sponsors):
    """Save sponsors to JSON file"""
    with open(SPONSORS_FILE, 'w') as f:
        json.dump(sponsors, f, indent=2)

# In-memory sponsor cache
sponsors_cache = load_sponsors()
CORS(app)

# SocketIO with optimized settings
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode=ASYNC_MODE,
    ping_timeout=20,         # Faster timeout detection
    ping_interval=10,        # More frequent pings
    max_http_buffer_size=1e6 # 1MB max message size
)

# In-memory storage for rooms and players
rooms = {}  # Dhiha Ei rooms
digu_rooms = {}  # Digu rooms
player_sessions = {}  # Maps session ID to room and position
matchmaking_queue = []  # List of {sid, name, joinedAt} for Dhiha Ei
digu_matchmaking_queue = []  # List of {sid, name, joinedAt} for Digu
digu_match_timeouts = {}  # Timeout timers for Digu confirmation

def generate_room_code():
    """Generate a 6-character room code"""
    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    while True:
        code = ''.join(random.choice(chars) for _ in range(6))
        if code not in rooms:
            return code

def get_room_state(room_id):
    """Get serializable room state"""
    if room_id not in rooms:
        return None
    room = rooms[room_id]
    return {
        'roomId': room_id,
        'metadata': room['metadata'],
        'players': room['players'],
        'gameState': room.get('gameState'),
        'hands': room.get('hands')
    }

# Serve static files
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

# Sponsor API endpoints

@app.route('/api/sponsors', methods=['GET'])
def get_sponsors():
    """Get all sponsor configurations from active campaigns"""
    # Reload campaigns data from file to get latest changes
    fresh_data = load_campaigns()
    campaigns = fresh_data.get('campaigns', {})

    # Default sponsor structure for all slots
    slots = ['table', 'drink', 'food', 'matchmaking', 'waiting_room']
    result = {}

    for slot in slots:
        # Find active campaign for this slot
        active_campaign = None
        for campaign_id, campaign in campaigns.items():
            if campaign.get('sponsor_slot') == slot and campaign.get('active'):
                active_campaign = campaign
                break

        if active_campaign:
            result[slot] = {
                'enabled': True,
                'name': active_campaign.get('name', ''),
                'logo': active_campaign.get('logo', ''),
                'url': active_campaign.get('url', ''),
                'callout': active_campaign.get('callout', '')
            }
        else:
            result[slot] = {
                'enabled': False,
                'name': '',
                'logo': '',
                'url': '',
                'callout': ''
            }

    return jsonify(result)

@app.route('/api/sponsors', methods=['POST'])
def update_sponsors():
    """Update sponsor configurations (requires admin password)"""
    global sponsors_cache
    data = request.get_json()

    # Verify admin password
    password = data.get('password')
    if password != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 401

    # Update sponsors
    sponsors = data.get('sponsors')
    if sponsors:
        sponsors_cache = sponsors
        save_sponsors(sponsors)
        return jsonify({'success': True, 'message': 'Sponsors updated'})

    return jsonify({'error': 'No sponsor data provided'}), 400

@app.route('/api/sponsors/<sponsor_id>', methods=['POST'])
def update_sponsor(sponsor_id):
    """Update a single sponsor (requires admin password)"""
    global sponsors_cache
    data = request.get_json()

    # Verify admin password
    password = data.get('password')
    if password != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 401

    if sponsor_id not in sponsors_cache:
        return jsonify({'error': 'Invalid sponsor ID'}), 404

    # Update sponsor fields
    sponsor_data = data.get('sponsor')
    if sponsor_data:
        sponsors_cache[sponsor_id].update(sponsor_data)
        save_sponsors(sponsors_cache)
        return jsonify({'success': True, 'message': f'Sponsor {sponsor_id} updated'})

    return jsonify({'error': 'No sponsor data provided'}), 400

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    """Validate admin password"""
    data = request.get_json()
    password = data.get('password')

    if password == ADMIN_PASSWORD:
        return jsonify({'success': True})
    return jsonify({'error': 'Invalid password'}), 401

@app.route('/api/log', methods=['POST'])
def receive_log():
    """Receive log entries from clients"""
    global server_logs
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    # Create log entry
    log_entry = {
        'timestamp': data.get('timestamp', time.strftime('%Y-%m-%dT%H:%M:%S')),
        'level': data.get('level', 'info'),
        'category': data.get('category', 'client'),
        'message': data.get('message', ''),
        'details': data.get('details'),
        'url': data.get('url', ''),
        'ip': get_client_ip(),
        'userAgent': data.get('userAgent', '')[:100] if data.get('userAgent') else ''
    }

    # Add to server logs
    server_logs.append(log_entry)

    # Cleanup old logs (older than 7 days)
    try:
        cutoff_time = time.time() - (LOG_RETENTION_DAYS * 24 * 60 * 60)
        server_logs = [
            log for log in server_logs
            if time.mktime(time.strptime(log['timestamp'][:19], '%Y-%m-%dT%H:%M:%S')) > cutoff_time
        ]
    except:
        pass  # Ignore timestamp parsing errors

    # Trim to max size (keep newest)
    if len(server_logs) > MAX_SERVER_LOGS:
        server_logs = server_logs[-MAX_SERVER_LOGS:]

    return jsonify({'success': True})

@app.route('/api/admin/logs', methods=['GET'])
def get_admin_logs():
    """Get server logs (admin only)"""
    password = request.args.get('password')
    if password != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 401

    # Optional filters
    level = request.args.get('level')
    category = request.args.get('category')

    logs = server_logs.copy()

    if level and level != 'all':
        logs = [l for l in logs if l.get('level') == level]
    if category and category != 'all':
        logs = [l for l in logs if l.get('category') == category]

    # Return newest first
    logs.reverse()

    return jsonify({
        'logs': logs,
        'total': len(server_logs)
    })

@app.route('/api/admin/logs', methods=['DELETE'])
def clear_admin_logs():
    """Clear server logs (admin only)"""
    global server_logs
    password = request.args.get('password')
    if password != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 401

    server_logs = []
    return jsonify({'success': True, 'message': 'Logs cleared'})

@app.route('/api/admin/upload', methods=['POST'])
def upload_sponsor_image():
    """Upload sponsor image"""
    password = request.form.get('password')
    if password != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 401

    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    # Save to icons/sponsors folder
    sponsors_dir = os.path.join('.', 'icons', 'sponsors')
    os.makedirs(sponsors_dir, exist_ok=True)

    filename = file.filename.replace(' ', '_')
    filepath = os.path.join(sponsors_dir, filename)
    file.save(filepath)

    return jsonify({
        'success': True,
        'url': f'/icons/sponsors/{filename}'
    })

# ===========================================
# CUSTOMER MANAGEMENT API
# ===========================================

@app.route('/api/admin/customers', methods=['GET'])
def get_customers():
    """Get all customers (admin only)"""
    password = request.args.get('password')
    if password != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 401

    # Return customers without passwords
    customers = {}
    for cid, customer in campaigns_data['customers'].items():
        customers[cid] = {k: v for k, v in customer.items() if k != 'password'}
    return jsonify(customers)

@app.route('/api/admin/customers', methods=['POST'])
def create_customer():
    """Create a new customer (admin only)"""
    global campaigns_data
    data = request.get_json()

    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid admin password'}), 401

    customer_name = data.get('name')
    customer_email = data.get('email')
    customer_password = data.get('customerPassword')

    if not all([customer_name, customer_email, customer_password]):
        return jsonify({'error': 'Name, email and password are required'}), 400

    # Check if email already exists
    for cid, c in campaigns_data['customers'].items():
        if c['email'] == customer_email:
            return jsonify({'error': 'Email already exists'}), 400

    customer_id = str(uuid.uuid4())[:8]
    campaigns_data['customers'][customer_id] = {
        'name': customer_name,
        'email': customer_email,
        'password': hash_password(customer_password),
        'created_at': datetime.now().isoformat()
    }
    save_campaigns(campaigns_data)

    return jsonify({
        'success': True,
        'customerId': customer_id,
        'message': f'Customer {customer_name} created'
    })

@app.route('/api/admin/customers/<customer_id>', methods=['PUT'])
def update_customer(customer_id):
    """Update a customer (admin only)"""
    global campaigns_data
    data = request.get_json()

    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid admin password'}), 401

    if customer_id not in campaigns_data['customers']:
        return jsonify({'error': 'Customer not found'}), 404

    customer = campaigns_data['customers'][customer_id]

    if data.get('name'):
        customer['name'] = data['name']
    if data.get('email'):
        customer['email'] = data['email']
    if data.get('customerPassword'):
        customer['password'] = hash_password(data['customerPassword'])

    save_campaigns(campaigns_data)
    return jsonify({'success': True, 'message': 'Customer updated'})

@app.route('/api/admin/customers/<customer_id>', methods=['DELETE'])
def delete_customer(customer_id):
    """Delete a customer (admin only)"""
    global campaigns_data
    data = request.get_json()

    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid admin password'}), 401

    if customer_id not in campaigns_data['customers']:
        return jsonify({'error': 'Customer not found'}), 404

    # Delete all campaigns for this customer
    campaigns_data['campaigns'] = {
        cid: c for cid, c in campaigns_data['campaigns'].items()
        if c['customer_id'] != customer_id
    }

    # Clear active sponsors if they belonged to this customer's campaigns
    for slot in campaigns_data['active_sponsors']:
        campaign_id = campaigns_data['active_sponsors'][slot]
        if campaign_id and campaign_id in campaigns_data['campaigns']:
            if campaigns_data['campaigns'][campaign_id]['customer_id'] == customer_id:
                campaigns_data['active_sponsors'][slot] = None

    del campaigns_data['customers'][customer_id]
    save_campaigns(campaigns_data)

    return jsonify({'success': True, 'message': 'Customer deleted'})

# ===========================================
# CAMPAIGN MANAGEMENT API
# ===========================================

@app.route('/api/admin/campaigns', methods=['GET'])
def get_all_campaigns():
    """Get all campaigns (admin only)"""
    password = request.args.get('password')
    if password != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 401

    return jsonify(campaigns_data['campaigns'])

@app.route('/api/admin/campaigns', methods=['POST'])
def create_campaign():
    """Create a new campaign (admin only)"""
    global campaigns_data
    data = request.get_json()

    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid admin password'}), 401

    customer_id = data.get('customerId')
    if customer_id not in campaigns_data['customers']:
        return jsonify({'error': 'Customer not found'}), 404

    campaign_id = str(uuid.uuid4())[:8]
    campaigns_data['campaigns'][campaign_id] = {
        'customer_id': customer_id,
        'name': data.get('name', 'New Campaign'),
        'sponsor_slot': data.get('sponsorSlot', 'table'),
        'logo': data.get('logo', ''),
        'url': data.get('url', ''),
        'callout': data.get('callout', ''),
        'start_date': data.get('startDate', datetime.now().isoformat()[:10]),
        'end_date': data.get('endDate', ''),
        'active': data.get('active', False),
        'stats': {
            'impressions': 0,
            'clicks': 0
        },
        'created_at': datetime.now().isoformat()
    }
    save_campaigns(campaigns_data)

    return jsonify({
        'success': True,
        'campaignId': campaign_id,
        'message': 'Campaign created'
    })

@app.route('/api/admin/campaigns/<campaign_id>', methods=['PUT'])
def update_campaign(campaign_id):
    """Update a campaign (admin only)"""
    global campaigns_data
    data = request.get_json()

    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid admin password'}), 401

    if campaign_id not in campaigns_data['campaigns']:
        return jsonify({'error': 'Campaign not found'}), 404

    campaign = campaigns_data['campaigns'][campaign_id]

    # Map camelCase to snake_case
    field_mapping = {
        'sponsorSlot': 'sponsor_slot',
        'startDate': 'start_date',
        'endDate': 'end_date',
        'customerId': 'customer_id'
    }

    # Update allowed fields (accept both camelCase and snake_case)
    allowed_fields = ['name', 'sponsor_slot', 'logo', 'url', 'callout', 'start_date', 'end_date', 'active', 'customer_id']

    for camel, snake in field_mapping.items():
        if camel in data:
            data[snake] = data[camel]

    for field in allowed_fields:
        if field in data:
            campaign[field] = data[field]

    save_campaigns(campaigns_data)
    return jsonify({'success': True, 'message': 'Campaign updated'})

@app.route('/api/admin/campaigns/<campaign_id>', methods=['DELETE'])
def delete_campaign(campaign_id):
    """Delete a campaign (admin only)"""
    global campaigns_data
    data = request.get_json()

    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid admin password'}), 401

    if campaign_id not in campaigns_data['campaigns']:
        return jsonify({'error': 'Campaign not found'}), 404

    # Clear from active sponsors if needed
    for slot in campaigns_data['active_sponsors']:
        if campaigns_data['active_sponsors'][slot] == campaign_id:
            campaigns_data['active_sponsors'][slot] = None

    del campaigns_data['campaigns'][campaign_id]
    save_campaigns(campaigns_data)

    return jsonify({'success': True, 'message': 'Campaign deleted'})

@app.route('/api/admin/campaigns/<campaign_id>/activate', methods=['POST'])
def activate_campaign(campaign_id):
    """Set a campaign as the active sponsor for its slot (admin only)"""
    global campaigns_data
    data = request.get_json()

    if data.get('password') != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid admin password'}), 401

    if campaign_id not in campaigns_data['campaigns']:
        return jsonify({'error': 'Campaign not found'}), 404

    campaign = campaigns_data['campaigns'][campaign_id]
    slot = campaign['sponsor_slot']

    # Deactivate current active campaign for this slot
    current_active = campaigns_data['active_sponsors'].get(slot)
    if current_active and current_active in campaigns_data['campaigns']:
        campaigns_data['campaigns'][current_active]['active'] = False

    # Activate new campaign
    campaigns_data['active_sponsors'][slot] = campaign_id
    campaign['active'] = True

    save_campaigns(campaigns_data)

    return jsonify({
        'success': True,
        'message': f'Campaign activated for {slot} slot'
    })

# ===========================================
# SERVER STATISTICS (for monitoring)
# ===========================================

@app.route('/api/admin/server-stats', methods=['GET'])
def get_server_stats():
    """Get server statistics for monitoring (admin only)"""
    password = request.args.get('password')
    if password != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 401

    # Calculate active games
    dhiha_ei_playing = sum(1 for r in rooms.values() if r['metadata']['status'] == 'playing')
    digu_playing = sum(1 for r in digu_rooms.values() if r['metadata']['status'] == 'playing')

    return jsonify({
        'connections': {
            'total': len(player_sessions),
            'uniqueIPs': len(ip_connections),
            'perIP': dict(ip_connections)
        },
        'rooms': {
            'dhihaEi': {
                'total': len(rooms),
                'playing': dhiha_ei_playing,
                'waiting': len(rooms) - dhiha_ei_playing
            },
            'digu': {
                'total': len(digu_rooms),
                'playing': digu_playing,
                'waiting': len(digu_rooms) - digu_playing
            }
        },
        'matchmaking': {
            'dhihaEiQueue': len(matchmaking_queue),
            'diguQueue': len(digu_matchmaking_queue)
        },
        'config': {
            'asyncMode': ASYNC_MODE,
            'maxConnectionsPerIP': MAX_CONNECTIONS_PER_IP,
            'connectionRateLimit': CONNECTION_RATE_LIMIT
        },
        'timestamp': time.time()
    })

# ===========================================
# STATISTICS API
# ===========================================

@app.route('/api/stats/impression', methods=['POST'])
def record_impression():
    """Record an ad impression"""
    global campaigns_data
    data = request.get_json()
    slot = data.get('slot')

    if slot and slot in campaigns_data['active_sponsors']:
        campaign_id = campaigns_data['active_sponsors'][slot]
        if campaign_id and campaign_id in campaigns_data['campaigns']:
            campaigns_data['campaigns'][campaign_id]['stats']['impressions'] += 1
            save_campaigns(campaigns_data)
            return jsonify({'success': True})

    return jsonify({'success': False})

@app.route('/api/stats/click', methods=['POST'])
def record_click():
    """Record an ad click"""
    global campaigns_data
    data = request.get_json()
    slot = data.get('slot')

    if slot and slot in campaigns_data['active_sponsors']:
        campaign_id = campaigns_data['active_sponsors'][slot]
        if campaign_id and campaign_id in campaigns_data['campaigns']:
            campaigns_data['campaigns'][campaign_id]['stats']['clicks'] += 1
            save_campaigns(campaigns_data)
            return jsonify({'success': True})

    return jsonify({'success': False})

@app.route('/api/admin/stats/<campaign_id>', methods=['GET'])
def get_campaign_stats(campaign_id):
    """Get campaign statistics (admin only)"""
    password = request.args.get('password')
    if password != ADMIN_PASSWORD:
        return jsonify({'error': 'Invalid password'}), 401

    if campaign_id not in campaigns_data['campaigns']:
        return jsonify({'error': 'Campaign not found'}), 404

    campaign = campaigns_data['campaigns'][campaign_id]
    stats = campaign['stats']

    # Calculate CTR
    ctr = 0
    if stats['impressions'] > 0:
        ctr = round((stats['clicks'] / stats['impressions']) * 100, 2)

    return jsonify({
        'impressions': stats['impressions'],
        'clicks': stats['clicks'],
        'ctr': ctr,
        'campaign_name': campaign['name'],
        'slot': campaign['sponsor_slot']
    })

# ===========================================
# CUSTOMER PORTAL API
# ===========================================

@app.route('/api/customer/login', methods=['POST'])
def customer_login():
    """Customer login"""
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400

    hashed = hash_password(password)

    for customer_id, customer in campaigns_data['customers'].items():
        if customer['email'] == email and customer['password'] == hashed:
            return jsonify({
                'success': True,
                'customerId': customer_id,
                'name': customer['name']
            })

    return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/api/customer/<customer_id>/campaigns', methods=['GET'])
def get_customer_campaigns(customer_id):
    """Get campaigns for a customer"""
    password = request.args.get('password')

    # Verify customer credentials
    if customer_id not in campaigns_data['customers']:
        return jsonify({'error': 'Customer not found'}), 404

    customer = campaigns_data['customers'][customer_id]
    if hash_password(password) != customer['password']:
        return jsonify({'error': 'Invalid password'}), 401

    # Get customer's campaigns with stats
    customer_campaigns = {}
    for cid, campaign in campaigns_data['campaigns'].items():
        if campaign['customer_id'] == customer_id:
            stats = campaign['stats']
            ctr = 0
            if stats['impressions'] > 0:
                ctr = round((stats['clicks'] / stats['impressions']) * 100, 2)

            customer_campaigns[cid] = {
                **campaign,
                'ctr': ctr
            }

    return jsonify(customer_campaigns)

@app.route('/api/customer/<customer_id>/stats', methods=['GET'])
def get_customer_total_stats(customer_id):
    """Get total stats across all campaigns for a customer"""
    password = request.args.get('password')

    if customer_id not in campaigns_data['customers']:
        return jsonify({'error': 'Customer not found'}), 404

    customer = campaigns_data['customers'][customer_id]
    if hash_password(password) != customer['password']:
        return jsonify({'error': 'Invalid password'}), 401

    total_impressions = 0
    total_clicks = 0
    active_campaigns = 0

    for campaign in campaigns_data['campaigns'].values():
        if campaign['customer_id'] == customer_id:
            total_impressions += campaign['stats']['impressions']
            total_clicks += campaign['stats']['clicks']
            if campaign['active']:
                active_campaigns += 1

    total_ctr = 0
    if total_impressions > 0:
        total_ctr = round((total_clicks / total_impressions) * 100, 2)

    return jsonify({
        'totalImpressions': total_impressions,
        'totalClicks': total_clicks,
        'totalCTR': total_ctr,
        'activeCampaigns': active_campaigns,
        'totalCampaigns': sum(1 for c in campaigns_data['campaigns'].values() if c['customer_id'] == customer_id)
    })

# WebSocket Events

@socketio.on('connect')
def handle_connect():
    ip = get_client_ip()
    sid = request.sid

    # Check connection limits
    if not check_connection_limit(ip):
        add_server_log('warn', 'connection', f'Connection rejected (limit exceeded)', {'sid': sid}, ip)
        return False  # Reject connection

    # Track connection
    ip_connections[ip] += 1
    ip_connection_times[ip].append(time.time())

    # Store IP in session for cleanup on disconnect
    if sid not in player_sessions:
        player_sessions[sid] = {}
    player_sessions[sid]['_ip'] = ip

    add_server_log('info', 'connection', f'Client connected', {'sid': sid, 'connectionsFromIP': ip_connections[ip]}, ip)
    emit('connected', {'sid': sid})

@socketio.on('ping_keepalive')
def handle_keepalive():
    """Handle keepalive ping from inactive tabs - keeps connection alive for 30 seconds"""
    pass  # Just receiving the event is enough to keep the connection alive

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    client_ip = None

    # Clean up IP tracking
    if sid in player_sessions and '_ip' in player_sessions[sid]:
        client_ip = player_sessions[sid]['_ip']
        ip_connections[client_ip] = max(0, ip_connections[client_ip] - 1)
        # Clean up if no more connections
        if ip_connections[client_ip] == 0:
            del ip_connections[client_ip]
            if client_ip in ip_connection_times:
                del ip_connection_times[client_ip]

    # Clean up rate limiting data
    if sid in event_rate_tracking:
        del event_rate_tracking[sid]

    add_server_log('info', 'connection', f'Client disconnected', {'sid': sid}, client_ip)

    # Remove from Dhiha Ei matchmaking queue if present
    global matchmaking_queue
    was_in_queue = any(p['sid'] == sid for p in matchmaking_queue)
    matchmaking_queue = [p for p in matchmaking_queue if p['sid'] != sid]
    if was_in_queue:
        print(f'Removed disconnected player from queue. Queue size: {len(matchmaking_queue)}')
        # Update remaining players in queue
        for player in matchmaking_queue:
            socketio.emit('queue_update', {
                'playersInQueue': len(matchmaking_queue),
                'playersNeeded': 4 - len(matchmaking_queue)
            }, to=player['sid'])

    # Remove from Digu matchmaking queue if present
    global digu_matchmaking_queue
    was_in_digu_queue = any(p['sid'] == sid for p in digu_matchmaking_queue)
    digu_matchmaking_queue = [p for p in digu_matchmaking_queue if p['sid'] != sid]
    if was_in_digu_queue:
        print(f'Removed disconnected player from Digu queue. Queue size: {len(digu_matchmaking_queue)}')
        for player in digu_matchmaking_queue:
            socketio.emit('digu_queue_update', {
                'playersInQueue': len(digu_matchmaking_queue),
                'playersNeeded': 4 - len(digu_matchmaking_queue)
            }, to=player['sid'])

    # Clean up player from room
    if sid in player_sessions:
        session = player_sessions[sid]
        room_id = session.get('roomId')
        position = session.get('position')
        game_type = session.get('gameType', 'dhihaei')

        # Skip room cleanup if player never joined a room
        if room_id is None or position is None:
            del player_sessions[sid]
            return

        # Handle Digu rooms
        if game_type == 'digu' and room_id in digu_rooms:
            room = digu_rooms[room_id]

            if position in room['players']:
                player_name = room['players'][position].get('name', f'Player {position + 1}')

                if room['metadata']['status'] == 'playing':
                    room['players'][position]['connected'] = False
                    print(f'Player {player_name} disconnected from Digu game in room {room_id}')
                    emit('digu_player_left', {
                        'position': position,
                        'playerName': player_name,
                        'reason': 'disconnected',
                        'players': room['players']
                    }, room=room_id)
                else:
                    del room['players'][position]
                    room['metadata']['playerCount'] = len(room['players'])

                    if len(room['players']) == 0:
                        del digu_rooms[room_id]
                        print(f'Digu room {room_id} deleted (empty)')
                    else:
                        emit('digu_players_changed', {'players': room['players']}, room=room_id)

        # Handle Dhiha Ei rooms
        elif room_id in rooms:
            room = rooms[room_id]

            if position in room['players']:
                player_name = room['players'][position].get('name', f'Player {position + 1}')

                # Mark player as disconnected or remove
                if room['metadata']['status'] == 'playing':
                    # During game, notify all players that someone left
                    room['players'][position]['connected'] = False
                    print(f'Player {player_name} disconnected from game in room {room_id}')
                    emit('player_left_game', {
                        'position': position,
                        'playerName': player_name,
                        'reason': 'disconnected',
                        'players': room['players']
                    }, room=room_id)
                else:
                    # In lobby, remove player
                    del room['players'][position]
                    room['metadata']['playerCount'] = len(room['players'])

                    # Delete room if empty
                    if len(room['players']) == 0:
                        del rooms[room_id]
                        print(f'Room {room_id} deleted (empty)')
                    else:
                        emit('players_changed', {'players': room['players']}, room=room_id)

        del player_sessions[sid]

@socketio.on('create_room')
@rate_limit('create_room')
def handle_create_room(data):
    sid = request.sid
    player_name = data.get('playerName', 'Player')

    room_id = generate_room_code()

    rooms[room_id] = {
        'metadata': {
            'host': sid,
            'created': time.time(),
            'status': 'waiting',
            'playerCount': 1
        },
        'players': {
            0: {
                'oderId': sid,
                'name': player_name,
                'ready': False,
                'connected': True
            }
        },
        'gameState': None,
        'hands': None
    }

    player_sessions[sid] = {
        'roomId': room_id,
        'position': 0
    }

    join_room(room_id)

    ip = player_sessions[sid].get('_ip') if sid in player_sessions else None
    add_server_log('info', 'room', f'Room created: {room_id}', {'roomId': room_id, 'playerName': player_name, 'game': 'dhihaei'}, ip)

    emit('room_created', {
        'roomId': room_id,
        'position': 0,
        'players': rooms[room_id]['players']
    })

@socketio.on('join_room')
@rate_limit('join_room')
def handle_join_room(data):
    sid = request.sid
    room_id = data.get('roomId', '').upper().strip()
    player_name = data.get('playerName', 'Player')

    if room_id not in rooms:
        emit('error', {'message': 'Room not found'})
        return

    room = rooms[room_id]

    if room['metadata']['status'] != 'waiting':
        emit('error', {'message': 'Game already in progress'})
        return

    # Find empty slot
    position = None
    for i in range(4):
        if i not in room['players']:
            position = i
            break

    if position is None:
        emit('error', {'message': 'Room is full'})
        return

    # Add player
    room['players'][position] = {
        'oderId': sid,
        'name': player_name,
        'ready': False,
        'connected': True
    }
    room['metadata']['playerCount'] = len(room['players'])

    player_sessions[sid] = {
        'roomId': room_id,
        'position': position
    }

    join_room(room_id)

    ip = player_sessions[sid].get('_ip') if sid in player_sessions else None
    add_server_log('info', 'room', f'Player joined room: {room_id}', {'roomId': room_id, 'playerName': player_name, 'position': position, 'game': 'dhihaei'}, ip)

    # Notify the joining player
    emit('room_joined', {
        'roomId': room_id,
        'position': position,
        'players': room['players']
    })

    # Notify others in room
    emit('players_changed', {'players': room['players']}, room=room_id, include_self=False)

@socketio.on('leave_room')
def handle_leave_room():
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']
    position = session['position']

    if room_id in rooms:
        room = rooms[room_id]

        if position in room['players']:
            player_name = room['players'][position].get('name', f'Player {position + 1}')
            is_playing = room['metadata']['status'] == 'playing'

            del room['players'][position]
            room['metadata']['playerCount'] = len(room['players'])

            leave_room(room_id)

            # Delete room if empty
            if len(room['players']) == 0:
                del rooms[room_id]
                print(f'Room {room_id} deleted (empty)')
            else:
                if is_playing:
                    # Notify others that player left during game
                    print(f'Player {player_name} left game in room {room_id}')
                    emit('player_left_game', {
                        'position': position,
                        'playerName': player_name,
                        'reason': 'left',
                        'players': room['players']
                    }, room=room_id)
                else:
                    emit('players_changed', {'players': room['players']}, room=room_id)
        else:
            leave_room(room_id)

    del player_sessions[sid]
    emit('left_room', {})

@socketio.on('set_ready')
def handle_set_ready(data):
    sid = request.sid
    ready = data.get('ready', False)

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']
    position = session['position']

    if room_id in rooms and position in rooms[room_id]['players']:
        rooms[room_id]['players'][position]['ready'] = ready
        emit('players_changed', {'players': rooms[room_id]['players']}, room=room_id)

@socketio.on('swap_player')
def handle_swap_player(data):
    sid = request.sid
    from_position = data.get('fromPosition')

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']

    # Only host (position 0) can swap
    if session['position'] != 0:
        emit('error', {'message': 'Only host can assign teams'})
        return

    if room_id not in rooms:
        return

    room = rooms[room_id]
    players = room['players']

    if from_position not in players:
        emit('error', {'message': 'No player in that position'})
        return

    # Determine teams
    # Team A: positions 0, 2 | Team B: positions 1, 3
    current_team = 0 if from_position in [0, 2] else 1
    target_team = 1 if current_team == 0 else 0
    target_positions = [1, 3] if target_team == 1 else [0, 2]

    # Find empty slot on target team
    target_position = None
    for pos in target_positions:
        if pos not in players:
            target_position = pos
            break

    player_to_move = players[from_position]

    if target_position is not None:
        # Move to empty slot
        players[target_position] = player_to_move
        del players[from_position]

        # Update session for moved player
        for sess_id, sess in player_sessions.items():
            if sess['roomId'] == room_id and sess['position'] == from_position:
                sess['position'] = target_position
                break
    else:
        # Swap with first player on target team
        target_position = target_positions[0]
        player_to_swap = players[target_position]

        players[target_position] = player_to_move
        players[from_position] = player_to_swap

        # Update sessions for both players
        for sess_id, sess in player_sessions.items():
            if sess['roomId'] == room_id:
                if sess['position'] == from_position:
                    sess['position'] = target_position
                elif sess['position'] == target_position:
                    sess['position'] = from_position

    emit('players_changed', {'players': players}, room=room_id)

    # Notify affected players of their new positions
    emit('position_changed', {
        'fromPosition': from_position,
        'toPosition': target_position,
        'players': players
    }, room=room_id)

@socketio.on('start_game')
def handle_start_game(data):
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']

    # Only host can start
    if session['position'] != 0:
        emit('error', {'message': 'Only host can start the game'})
        return

    if room_id not in rooms:
        return

    room = rooms[room_id]

    # Verify 4 players and all ready
    if len(room['players']) != 4:
        emit('error', {'message': 'Need 4 players to start'})
        return

    all_ready = all(p.get('ready', False) for p in room['players'].values())
    if not all_ready:
        emit('error', {'message': 'All players must be ready'})
        return

    # Set game state
    room['metadata']['status'] = 'playing'
    room['gameState'] = data.get('gameState', {})
    room['hands'] = data.get('hands', {})

    # Initialize turn tracking
    room['currentPlayerIndex'] = data.get('gameState', {}).get('currentPlayerIndex', 0)
    room['cardsPlayedInTrick'] = 0  # Track cards played in current trick (0-4)

    ip = player_sessions[sid].get('_ip') if sid in player_sessions else None
    add_server_log('info', 'game', f'Game started: {room_id}', {'roomId': room_id, 'playerCount': len(room['players']), 'game': 'dhihaei', 'startingPlayer': room['currentPlayerIndex']}, ip)

    emit('game_started', {
        'gameState': room['gameState'],
        'hands': room['hands'],
        'players': room['players'],
        'currentPlayerIndex': room['currentPlayerIndex']
    }, room=room_id)

@socketio.on('card_played')
@rate_limit('card_played')
def handle_card_played(data):
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session.get('roomId')
    position = session.get('position')

    if room_id is None:
        return

    if room_id not in rooms:
        return

    room = rooms[room_id]
    card = data.get('card')

    # Log if turn seems out of sync (but allow the move - client manages turns)
    if room.get('currentPlayerIndex') != position:
        print(f'[WARN] Card play by {position} but server expected {room.get("currentPlayerIndex")} - syncing to client')

    # Sync turn to who actually played, then advance
    room['currentPlayerIndex'] = (position + 1) % 4
    room['cardsPlayedInTrick'] = room.get('cardsPlayedInTrick', 0) + 1

    print(f'Card played in room {room_id}: {card} by position {position}, next turn: {room["currentPlayerIndex"]}, cards in trick: {room["cardsPlayedInTrick"]}')

    # Broadcast to all other players in room
    emit('remote_card_played', {
        'card': card,
        'position': position,
        'currentPlayerIndex': room['currentPlayerIndex']
    }, room=room_id, include_self=False)

    # Also notify the player who played about the turn change
    emit('turn_changed', {
        'currentPlayerIndex': room['currentPlayerIndex']
    })

@socketio.on('trick_completed')
def handle_trick_completed(data):
    """Handle trick completion - winner leads next trick"""
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session.get('roomId')

    if room_id is None or room_id not in rooms:
        return

    room = rooms[room_id]
    winner = data.get('winner')  # Position of trick winner

    if winner is not None:
        # Winner of trick leads next trick
        room['currentPlayerIndex'] = winner
        room['cardsPlayedInTrick'] = 0

        print(f'Trick completed in room {room_id}, winner: {winner}, they lead next trick')

        # Broadcast to all players
        emit('trick_winner_set', {
            'winner': winner,
            'currentPlayerIndex': room['currentPlayerIndex']
        }, room=room_id)

@socketio.on('update_game_state')
def handle_update_game_state(data):
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']

    if room_id in rooms:
        rooms[room_id]['gameState'] = data.get('gameState', {})

        emit('game_state_updated', {
            'gameState': rooms[room_id]['gameState']
        }, room=room_id, include_self=False)

@socketio.on('new_round')
def handle_new_round(data):
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']

    # Only host broadcasts new rounds
    if session['position'] != 0:
        return

    if room_id in rooms:
        room = rooms[room_id]
        room['gameState'] = data.get('gameState', {})
        room['hands'] = data.get('hands', {})

        # Reset turn tracking for new round
        room['currentPlayerIndex'] = data.get('gameState', {}).get('currentPlayerIndex', 0)
        room['cardsPlayedInTrick'] = 0

        print(f'New round started in room {room_id}, starting player: {room["currentPlayerIndex"]}')

        emit('round_started', {
            'gameState': room['gameState'],
            'hands': room['hands'],
            'currentPlayerIndex': room['currentPlayerIndex']
        }, room=room_id)

@socketio.on('ready_for_round')
def handle_ready_for_round():
    """Handle player ready for next round"""
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']
    position = session['position']

    if room_id not in rooms:
        return

    room = rooms[room_id]

    # Initialize ready_for_round tracking if not exists
    if 'readyForRound' not in room:
        room['readyForRound'] = {}

    # Mark this player as ready
    room['readyForRound'][position] = True

    print(f'Player {position} ready for next round in room {room_id}')

    # Check if all 4 players are ready
    ready_count = sum(1 for p in room['readyForRound'].values() if p)
    if ready_count >= 4:
        print(f'All players ready for next round in room {room_id}')
        # Reset ready states for next time
        room['readyForRound'] = {}
        # Notify all players
        emit('all_ready_for_round', {}, room=room_id)

# ===========================================
# MATCHMAKING / QUICK MATCH
# ===========================================

def remove_from_queue(sid):
    """Remove a player from the matchmaking queue"""
    global matchmaking_queue
    matchmaking_queue = [p for p in matchmaking_queue if p['sid'] != sid]

# Track active match timeouts
match_timeouts = {}

def check_and_start_match():
    """Check if we have 4 players and start a match"""
    global matchmaking_queue

    if len(matchmaking_queue) >= 4:
        # Take first 4 players
        match_players = matchmaking_queue[:4]
        matchmaking_queue = matchmaking_queue[4:]

        # Create a new room for this match
        room_id = generate_room_code()

        rooms[room_id] = {
            'metadata': {
                'host': match_players[0]['sid'],
                'created': time.time(),
                'status': 'confirming',  # New status for confirmation phase
                'playerCount': 4,
                'isQuickMatch': True,
                'confirmDeadline': time.time() + 30  # 30 second deadline
            },
            'players': {},
            'gameState': None,
            'hands': None
        }

        # Assign players to positions (0, 2 = Team A, 1, 3 = Team B)
        positions = [0, 1, 2, 3]
        random.shuffle(positions)  # Randomize team assignment

        for i, player in enumerate(match_players):
            position = positions[i]
            rooms[room_id]['players'][position] = {
                'oderId': player['sid'],
                'name': player['name'],
                'ready': False,  # Require confirmation
                'connected': True,
                'confirmed': False
            }

            player_sessions[player['sid']] = {
                'roomId': room_id,
                'position': position
            }

            # Add player to socket room
            join_room(room_id, sid=player['sid'])

        add_server_log('info', 'matchmaking', f'Match found: {room_id}', {'roomId': room_id, 'players': [p['name'] for p in match_players], 'game': 'dhihaei'})

        # Notify all matched players - they have 30 seconds to confirm
        for i, player in enumerate(match_players):
            position = player_sessions[player['sid']]['position']
            socketio.emit('match_found', {
                'roomId': room_id,
                'position': position,
                'players': rooms[room_id]['players'],
                'confirmTimeout': 30,
                'requiresConfirmation': True
            }, to=player['sid'])

        # Set up 30-second timeout
        def handle_confirmation_timeout():
            if room_id in rooms:
                room = rooms[room_id]
                if room['metadata']['status'] == 'confirming':
                    # Check who didn't confirm
                    unconfirmed = []
                    confirmed = []
                    for pos, player in room['players'].items():
                        if not player.get('confirmed', False):
                            unconfirmed.append((pos, player))
                        else:
                            confirmed.append((pos, player))

                    print(f'Match {room_id} timeout: {len(unconfirmed)} players did not confirm')

                    # Notify unconfirmed players they were removed
                    for pos, player in unconfirmed:
                        socketio.emit('match_timeout', {
                            'message': 'You did not confirm in time'
                        }, to=player['oderId'])
                        # Clean up session
                        if player['oderId'] in player_sessions:
                            del player_sessions[player['oderId']]
                        leave_room(room_id, sid=player['oderId'])

                    # Put confirmed players back in queue
                    for pos, player in confirmed:
                        socketio.emit('match_cancelled', {
                            'message': 'Match cancelled - some players did not confirm',
                            'requeued': True
                        }, to=player['oderId'])
                        # Clean up session and requeue
                        if player['oderId'] in player_sessions:
                            del player_sessions[player['oderId']]
                        leave_room(room_id, sid=player['oderId'])
                        matchmaking_queue.append({
                            'sid': player['oderId'],
                            'name': player['name'],
                            'joinedAt': time.time()
                        })

                    # Delete the room
                    del rooms[room_id]
                    print(f'Match {room_id} cancelled due to timeout')

                    # Check if we can start a new match with requeued players
                    broadcast_queue_status()
                    check_and_start_match()

            # Clean up timeout reference
            if room_id in match_timeouts:
                del match_timeouts[room_id]

        # Start timeout timer
        timer = threading.Timer(30, handle_confirmation_timeout)
        timer.start()
        match_timeouts[room_id] = timer

        return True
    return False

@socketio.on('confirm_match')
def handle_confirm_match():
    """Handle player confirming their quickplay match"""
    sid = request.sid

    if sid not in player_sessions:
        emit('error', {'message': 'Not in a match'})
        return

    session = player_sessions[sid]
    room_id = session['roomId']
    position = session['position']

    if room_id not in rooms:
        emit('error', {'message': 'Match not found'})
        return

    room = rooms[room_id]

    # Only for quickmatch in confirming status
    if not room['metadata'].get('isQuickMatch') or room['metadata']['status'] != 'confirming':
        emit('error', {'message': 'Not in confirmation phase'})
        return

    # Mark player as confirmed
    if position in room['players']:
        room['players'][position]['confirmed'] = True
        room['players'][position]['ready'] = True

        print(f'Player {room["players"][position]["name"]} confirmed match {room_id}')

        # Notify all players of the confirmation
        socketio.emit('player_confirmed', {
            'position': position,
            'players': room['players']
        }, room=room_id)

        # Check if all players confirmed
        all_confirmed = all(p.get('confirmed', False) for p in room['players'].values())

        if all_confirmed:
            # Cancel the timeout timer
            if room_id in match_timeouts:
                match_timeouts[room_id].cancel()
                del match_timeouts[room_id]

            # Transition to waiting/ready to start
            room['metadata']['status'] = 'waiting'

            print(f'All players confirmed in match {room_id} - ready to start')

            # Notify all players that match is confirmed
            socketio.emit('all_confirmed', {
                'roomId': room_id,
                'players': room['players']
            }, room=room_id)

def broadcast_queue_status():
    """Broadcast current queue count to all waiting players"""
    count = len(matchmaking_queue)
    print(f'Broadcasting queue_update to {count} players in queue')
    for player in matchmaking_queue:
        print(f'  Emitting queue_update to {player["name"]} (sid: {player["sid"]}): count={count}')
        socketio.emit('queue_update', {
            'playersInQueue': count,
            'playersNeeded': 4 - count
        }, to=player['sid'])

@socketio.on('join_queue')
@rate_limit('join_queue')
def handle_join_queue(data):
    sid = request.sid
    player_name = data.get('playerName', 'Player')

    # Remove if already in queue (rejoin)
    remove_from_queue(sid)

    # Check if already in a room (not just connected)
    if sid in player_sessions and player_sessions[sid].get('roomId'):
        emit('error', {'message': 'Already in a room. Leave first.'})
        return

    # Add to queue
    matchmaking_queue.append({
        'sid': sid,
        'name': player_name,
        'joinedAt': time.time()
    })

    ip = player_sessions.get(sid, {}).get('_ip')
    add_server_log('info', 'matchmaking', f'Player joined queue', {'playerName': player_name, 'queueSize': len(matchmaking_queue), 'game': 'dhihaei'}, ip)

    emit('queue_joined', {
        'playersInQueue': len(matchmaking_queue),
        'playersNeeded': max(0, 4 - len(matchmaking_queue))
    })

    # Broadcast updated queue status to all waiting
    broadcast_queue_status()

    # Check if we can start a match
    check_and_start_match()

@socketio.on('leave_queue')
def handle_leave_queue():
    sid = request.sid

    was_in_queue = any(p['sid'] == sid for p in matchmaking_queue)
    remove_from_queue(sid)

    if was_in_queue:
        print(f'Player left matchmaking queue. Queue size: {len(matchmaking_queue)}')
        emit('queue_left', {})
        broadcast_queue_status()

# Need to import request for sid access
from flask import request

# ===========================================
# DIGU MULTIPLAYER
# ===========================================

def get_digu_room_state(room_id):
    """Get serializable Digu room state"""
    if room_id not in digu_rooms:
        return None
    room = digu_rooms[room_id]
    return {
        'roomId': room_id,
        'metadata': room['metadata'],
        'players': room['players'],
        'gameState': room.get('gameState'),
        'hands': room.get('hands')
    }

@socketio.on('create_digu_room')
@rate_limit('create_room')
def handle_create_digu_room(data):
    """Create a new Digu room (2-4 players)"""
    sid = request.sid
    player_name = data.get('playerName', 'Player')
    max_players = data.get('maxPlayers', 4)

    # Validate max_players
    if max_players < 2 or max_players > 4:
        max_players = 4

    room_id = generate_room_code()

    digu_rooms[room_id] = {
        'metadata': {
            'host': sid,
            'created': time.time(),
            'status': 'waiting',
            'playerCount': 1,
            'maxPlayers': max_players,
            'gameType': 'digu'
        },
        'players': {
            0: {
                'oderId': sid,
                'name': player_name,
                'ready': False,
                'connected': True
            }
        },
        'gameState': None,
        'hands': {}
    }

    player_sessions[sid] = {
        'roomId': room_id,
        'position': 0,
        'gameType': 'digu'
    }

    join_room(room_id)

    ip = player_sessions[sid].get('_ip') if sid in player_sessions else None
    add_server_log('info', 'room', f'Room created: {room_id}', {'roomId': room_id, 'playerName': player_name, 'maxPlayers': max_players, 'game': 'digu'}, ip)

    emit('digu_room_created', {
        'roomId': room_id,
        'position': 0,
        'players': digu_rooms[room_id]['players'],
        'maxPlayers': max_players
    })

@socketio.on('join_digu_room')
@rate_limit('join_room')
def handle_join_digu_room(data):
    """Join an existing Digu room"""
    sid = request.sid
    room_id = data.get('roomId', '').upper().strip()
    player_name = data.get('playerName', 'Player')

    if room_id not in digu_rooms:
        emit('error', {'message': 'Room not found'})
        return

    room = digu_rooms[room_id]

    if room['metadata']['status'] != 'waiting':
        emit('error', {'message': 'Game already in progress'})
        return

    max_players = room['metadata']['maxPlayers']

    # Find empty slot
    position = None
    for i in range(max_players):
        if i not in room['players']:
            position = i
            break

    if position is None:
        emit('error', {'message': 'Room is full'})
        return

    # Add player
    room['players'][position] = {
        'oderId': sid,
        'name': player_name,
        'ready': False,
        'connected': True
    }
    room['metadata']['playerCount'] = len(room['players'])

    player_sessions[sid] = {
        'roomId': room_id,
        'position': position,
        'gameType': 'digu'
    }

    join_room(room_id)

    print(f'{player_name} joined Digu room {room_id} at position {position}')

    # Notify the joining player
    emit('digu_room_joined', {
        'roomId': room_id,
        'position': position,
        'players': room['players'],
        'maxPlayers': max_players
    })

    # Notify others in room
    print(f'Emitting digu_players_changed to room {room_id}: {room["players"]}')
    emit('digu_players_changed', {'players': room['players']}, room=room_id, include_self=False)

@socketio.on('leave_digu_room')
def handle_leave_digu_room():
    """Leave a Digu room"""
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    if session.get('gameType') != 'digu':
        return

    room_id = session['roomId']
    position = session['position']

    if room_id in digu_rooms:
        room = digu_rooms[room_id]

        if position in room['players']:
            player_name = room['players'][position].get('name', f'Player {position + 1}')
            is_playing = room['metadata']['status'] == 'playing'

            del room['players'][position]
            room['metadata']['playerCount'] = len(room['players'])

            leave_room(room_id)

            # Delete room if empty
            if len(room['players']) == 0:
                del digu_rooms[room_id]
                print(f'Digu room {room_id} deleted (empty)')
            else:
                if is_playing:
                    # Notify others that player left during game
                    print(f'Player {player_name} left Digu game in room {room_id}')
                    emit('digu_player_left', {
                        'position': position,
                        'playerName': player_name,
                        'reason': 'left',
                        'players': room['players']
                    }, room=room_id)
                else:
                    emit('digu_players_changed', {'players': room['players']}, room=room_id)
        else:
            leave_room(room_id)

    del player_sessions[sid]
    emit('digu_left_room', {})

@socketio.on('digu_set_ready')
def handle_digu_set_ready(data):
    """Set player ready status in Digu room"""
    sid = request.sid
    ready = data.get('ready', False)

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    if session.get('gameType') != 'digu':
        return

    room_id = session['roomId']
    position = session['position']

    if room_id in digu_rooms and position in digu_rooms[room_id]['players']:
        digu_rooms[room_id]['players'][position]['ready'] = ready
        emit('digu_players_changed', {'players': digu_rooms[room_id]['players']}, room=room_id)

@socketio.on('swap_digu_player')
def handle_swap_digu_player(data):
    """Swap a Digu player to the other team (host only)"""
    sid = request.sid
    from_position = data.get('fromPosition')

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    if session.get('gameType') != 'digu':
        return

    room_id = session['roomId']

    # Only host (position 0) can swap
    if session['position'] != 0:
        emit('error', {'message': 'Only host can assign teams'})
        return

    if room_id not in digu_rooms:
        return

    room = digu_rooms[room_id]
    players = room['players']

    if from_position not in players:
        emit('error', {'message': 'No player in that position'})
        return

    # Determine teams
    # Team A: positions 0, 2 | Team B: positions 1, 3
    current_team = 0 if from_position in [0, 2] else 1
    target_team = 1 if current_team == 0 else 0
    target_positions = [1, 3] if target_team == 1 else [0, 2]

    # Find empty slot on target team
    target_position = None
    for pos in target_positions:
        if pos not in players:
            target_position = pos
            break

    player_to_move = players[from_position]

    if target_position is not None:
        # Move to empty slot
        players[target_position] = player_to_move
        del players[from_position]

        # Update session for moved player
        for sess_id, sess in player_sessions.items():
            if sess.get('roomId') == room_id and sess.get('position') == from_position:
                sess['position'] = target_position
                break
    else:
        # Swap with first player on target team
        target_position = target_positions[0]
        player_to_swap = players[target_position]

        players[target_position] = player_to_move
        players[from_position] = player_to_swap

        # Update sessions for both players
        for sess_id, sess in player_sessions.items():
            if sess.get('roomId') == room_id:
                if sess.get('position') == from_position:
                    sess['position'] = target_position
                elif sess.get('position') == target_position:
                    sess['position'] = from_position

    emit('digu_players_changed', {'players': players}, room=room_id)

    # Notify affected players of their new positions
    emit('digu_position_changed', {
        'fromPosition': from_position,
        'toPosition': target_position,
        'players': players
    }, room=room_id)

@socketio.on('start_digu_game')
def handle_start_digu_game(data):
    """Host starts the Digu game"""
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    if session.get('gameType') != 'digu':
        return

    room_id = session['roomId']

    # Only host can start
    if session['position'] != 0:
        emit('error', {'message': 'Only host can start the game'})
        return

    if room_id not in digu_rooms:
        return

    room = digu_rooms[room_id]
    min_players = 4

    # Verify minimum players and all ready
    if len(room['players']) < min_players:
        emit('error', {'message': f'Need {min_players} players to start'})
        return

    all_ready = all(p.get('ready', False) for p in room['players'].values())
    if not all_ready:
        emit('error', {'message': 'All players must be ready'})
        return

    # Set game state
    room['metadata']['status'] = 'playing'
    room['gameState'] = data.get('gameState', {})
    room['hands'] = data.get('hands', {})

    # Store stock and discard piles server-side for synchronization
    room['stockPile'] = data.get('stockPile', [])
    room['discardPile'] = data.get('discardPile', [])

    # Initialize turn tracking
    room['currentPlayerIndex'] = data.get('gameState', {}).get('currentPlayerIndex', 0)
    room['gamePhase'] = 'draw'  # Phases: 'draw', 'discard'
    room['numPlayers'] = len(room['players'])

    print(f'Digu game started in room {room_id} with {len(room["players"])} players, stock: {len(room["stockPile"])} cards, starting player: {room["currentPlayerIndex"]}')

    emit('digu_game_started', {
        'gameState': room['gameState'],
        'hands': room['hands'],
        'players': room['players']
    }, room=room_id)

@socketio.on('digu_draw_card')
@rate_limit('digu_draw_card')
def handle_digu_draw_card(data):
    """Player draws a card from stock or discard"""
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    if session.get('gameType') != 'digu':
        return

    room_id = session['roomId']
    position = session['position']

    if room_id not in digu_rooms:
        return

    room = digu_rooms[room_id]
    source = data.get('source')  # 'stock' or 'discard'
    card = None

    # Log if turn/phase seems out of sync (but allow - client manages state)
    if room.get('currentPlayerIndex') != position:
        print(f'[WARN] Digu draw by {position} but server expected {room.get("currentPlayerIndex")} - syncing to client')
        room['currentPlayerIndex'] = position

    if room.get('gamePhase') != 'draw':
        print(f'[WARN] Digu draw but server in {room.get("gamePhase")} phase - syncing to client')

    if source == 'stock':
        # Check if stock pile is empty - reshuffle discard pile
        if not room.get('stockPile') or len(room['stockPile']) == 0:
            discard = room.get('discardPile', [])
            if len(discard) > 0:
                # Take ALL cards from discard and shuffle into stock
                random.shuffle(discard)
                room['stockPile'] = discard
                room['discardPile'] = []
                print(f'Digu stock reshuffled in room {room_id}: {len(room["stockPile"])} cards from discard')

                # Notify all players that stock was reshuffled
                emit('digu_stock_reshuffled', {
                    'stockCount': len(room['stockPile'])
                }, room=room_id)
            else:
                print(f'Digu cannot reshuffle - discard pile empty in room {room_id}')
                emit('error', {'message': 'No cards left to draw'})
                return

        # Pop card from server-side stock pile
        if room.get('stockPile') and len(room['stockPile']) > 0:
            card = room['stockPile'].pop(0)  # Take from front (like shift)
            print(f'Digu card drawn from stock in room {room_id}: {card} by position {position}, remaining: {len(room["stockPile"])}')
        else:
            print(f'Digu stock pile empty in room {room_id}')
            emit('error', {'message': 'No cards left to draw'})
            return
    elif source == 'discard':
        # Pop card from server-side discard pile
        if room.get('discardPile') and len(room['discardPile']) > 0:
            card = room['discardPile'].pop()  # Take from top (last item)
            print(f'Digu card drawn from discard in room {room_id}: {card} by position {position}')
        else:
            print(f'Digu discard pile empty in room {room_id}')
            return

    # Update phase to discard
    room['gamePhase'] = 'discard'

    # Broadcast the SPECIFIC card to ALL players (including the one who drew)
    # Include pile counts so clients can show empty state visually
    emit('digu_card_drawn', {
        'source': source,
        'card': card,
        'position': position,
        'currentPlayerIndex': room['currentPlayerIndex'],
        'gamePhase': room['gamePhase'],
        'stockCount': len(room.get('stockPile', [])),
        'discardCount': len(room.get('discardPile', []))
    }, room=room_id)

@socketio.on('digu_discard_card')
@rate_limit('digu_discard_card')
def handle_digu_discard_card(data):
    """Player discards a card"""
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    if session.get('gameType') != 'digu':
        return

    room_id = session['roomId']
    position = session['position']

    if room_id not in digu_rooms:
        return

    room = digu_rooms[room_id]
    card = data.get('card')

    # Log if turn/phase seems out of sync (but allow - client manages state)
    if room.get('currentPlayerIndex') != position:
        print(f'[WARN] Digu discard by {position} but server expected {room.get("currentPlayerIndex")} - syncing to client')

    if room.get('gamePhase') != 'discard':
        print(f'[WARN] Digu discard but server in {room.get("gamePhase")} phase - syncing to client')

    # Add to server-side discard pile
    if 'discardPile' not in room:
        room['discardPile'] = []
    room['discardPile'].append(card)

    # Advance to next player (from actual position, not expected)
    numPlayers = room.get('numPlayers', 4)
    room['currentPlayerIndex'] = (position + 1) % numPlayers
    room['gamePhase'] = 'draw'

    print(f'Digu card discarded in room {room_id}: {card} by position {position}, next turn: {room["currentPlayerIndex"]}, discard size: {len(room["discardPile"])}')

    # Check if stock is empty - if so, reshuffle discard into stock for next player's turn
    reshuffled = False
    if (not room.get('stockPile') or len(room['stockPile']) == 0) and len(room['discardPile']) > 0:
        discard = room['discardPile']
        random.shuffle(discard)
        room['stockPile'] = discard
        room['discardPile'] = []
        reshuffled = True
        print(f'Digu stock auto-reshuffled in room {room_id}: {len(room["stockPile"])} cards from discard')

    # Broadcast to all other players in room
    emit('digu_remote_card_discarded', {
        'card': card,
        'position': position,
        'currentPlayerIndex': room['currentPlayerIndex'],
        'gamePhase': room['gamePhase']
    }, room=room_id, include_self=False)

    # Also notify the player who discarded about the turn change
    emit('digu_turn_changed', {
        'currentPlayerIndex': room['currentPlayerIndex'],
        'gamePhase': room['gamePhase']
    })

    # If reshuffled, notify all players
    if reshuffled:
        emit('digu_stock_reshuffled', {
            'stockCount': len(room['stockPile'])
        }, room=room_id)

@socketio.on('digu_declare')
@rate_limit('digu_declare')
def handle_digu_declare(data):
    """Player declares Digu"""
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    if session.get('gameType') != 'digu':
        return

    room_id = session['roomId']
    position = session['position']

    melds = data.get('melds')  # The player's melds
    isValid = data.get('isValid', False)  # Whether the declaration is valid

    print(f'Digu declared in room {room_id} by position {position}, valid: {isValid}')

    # Broadcast to all other players in room
    emit('digu_remote_declare', {
        'position': position,
        'melds': melds,
        'isValid': isValid
    }, room=room_id, include_self=False)

@socketio.on('digu_update_state')
def handle_digu_update_state(data):
    """Update Digu game state"""
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    if session.get('gameType') != 'digu':
        return

    room_id = session['roomId']

    if room_id in digu_rooms:
        digu_rooms[room_id]['gameState'] = data.get('gameState', {})

        emit('digu_state_updated', {
            'gameState': digu_rooms[room_id]['gameState']
        }, room=room_id, include_self=False)

@socketio.on('digu_game_over')
def handle_digu_game_over(data):
    """Digu game ended"""
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    if session.get('gameType') != 'digu':
        return

    room_id = session['roomId']
    position = session['position']

    results = data.get('results')

    print(f'Digu game over in room {room_id}')

    # Broadcast to all players in room
    emit('digu_remote_game_over', {
        'results': results,
        'declaredBy': position
    }, room=room_id, include_self=False)

@socketio.on('digu_new_match')
def handle_digu_new_match(data):
    """Start a new Digu match (host only)"""
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    if session.get('gameType') != 'digu':
        return

    room_id = session['roomId']

    # Only host broadcasts new matches
    if session['position'] != 0:
        return

    if room_id in digu_rooms:
        room = digu_rooms[room_id]
        room['gameState'] = data.get('gameState', {})
        room['hands'] = data.get('hands', {})

        # Reset turn tracking for new match
        room['currentPlayerIndex'] = data.get('gameState', {}).get('currentPlayerIndex', 0)
        room['gamePhase'] = 'draw'
        room['stockPile'] = data.get('stockPile', [])
        room['discardPile'] = data.get('discardPile', [])

        print(f'New Digu match started in room {room_id}, starting player: {room["currentPlayerIndex"]}')

        emit('digu_match_started', {
            'gameState': room['gameState'],
            'hands': room['hands'],
            'currentPlayerIndex': room['currentPlayerIndex'],
            'gamePhase': room['gamePhase']
        }, room=room_id)

# ===========================================
# DIGU QUICK MATCH
# ===========================================

def remove_from_digu_queue(sid):
    """Remove a player from the Digu matchmaking queue"""
    global digu_matchmaking_queue
    digu_matchmaking_queue = [p for p in digu_matchmaking_queue if p['sid'] != sid]

def broadcast_digu_queue_status():
    """Broadcast current Digu queue count to all waiting players"""
    count = len(digu_matchmaking_queue)
    print(f'[DIGU] Broadcasting digu_queue_update to {count} players in queue')
    for player in digu_matchmaking_queue:
        print(f'[DIGU]   Emitting digu_queue_update to {player["name"]} (sid: {player["sid"]}): count={count}')
        socketio.emit('digu_queue_update', {
            'playersInQueue': count,
            'playersNeeded': 4 - count
        }, to=player['sid'])

@socketio.on('join_digu_queue')
@rate_limit('join_queue')
def handle_join_digu_queue(data):
    """Join the Digu matchmaking queue"""
    sid = request.sid
    player_name = data.get('playerName', 'Player')

    print(f'[DIGU QUEUE] join_digu_queue received from {player_name} (sid: {sid})')

    # Remove if already in queue (rejoin)
    remove_from_digu_queue(sid)

    # Check if already in a room (not just connected)
    if sid in player_sessions and player_sessions[sid].get('roomId'):
        print(f'[DIGU QUEUE] Rejected - already in room: {player_sessions[sid].get("roomId")}')
        emit('error', {'message': 'Already in a room. Leave first.'})
        return

    # Add to queue
    digu_matchmaking_queue.append({
        'sid': sid,
        'name': player_name,
        'joinedAt': time.time()
    })

    print(f'[DIGU QUEUE] Added to queue. Queue size: {len(digu_matchmaking_queue)}')

    ip = player_sessions.get(sid, {}).get('_ip')
    add_server_log('info', 'matchmaking', f'Player joined queue', {'playerName': player_name, 'queueSize': len(digu_matchmaking_queue), 'game': 'digu'}, ip)

    print(f'[DIGU QUEUE] Emitting digu_queue_joined to {sid}')
    emit('digu_queue_joined', {
        'playersInQueue': len(digu_matchmaking_queue),
        'playersNeeded': max(0, 4 - len(digu_matchmaking_queue))
    })

    # Broadcast updated queue status to all waiting
    broadcast_digu_queue_status()

    # Check if we can start a match (4 players)
    check_and_start_digu_match()

def check_and_start_digu_match():
    """Check if we have 4 players and start a Digu match"""
    global digu_matchmaking_queue

    if len(digu_matchmaking_queue) >= 4:
        # Take first 4 players
        match_players = digu_matchmaking_queue[:4]
        digu_matchmaking_queue = digu_matchmaking_queue[4:]

        # Create a new room for this match
        room_id = generate_room_code()

        digu_rooms[room_id] = {
            'metadata': {
                'host': match_players[0]['sid'],
                'created': time.time(),
                'status': 'confirming',  # Waiting for confirmation
                'playerCount': 4,
                'maxPlayers': 4,
                'gameType': 'digu',
                'isQuickMatch': True
            },
            'players': {},
            'gameState': None,
            'hands': {}
        }

        # Assign players to positions
        for i, player in enumerate(match_players):
            digu_rooms[room_id]['players'][i] = {
                'oderId': player['sid'],
                'name': player['name'],
                'ready': False,  # Not ready until confirmed
                'connected': True,
                'confirmed': False
            }

            player_sessions[player['sid']] = {
                'roomId': room_id,
                'position': i,
                'gameType': 'digu'
            }

            # Add player to socket room
            join_room(room_id, sid=player['sid'])

        add_server_log('info', 'matchmaking', f'Match found: {room_id}', {'roomId': room_id, 'players': [p['name'] for p in match_players], 'game': 'digu'})

        # Notify all matched players - they have 30 seconds to confirm
        for i, player in enumerate(match_players):
            socketio.emit('digu_match_found', {
                'roomId': room_id,
                'position': i,
                'players': digu_rooms[room_id]['players'],
                'confirmTimeout': 30,
                'requiresConfirmation': True
            }, to=player['sid'])

        # Set up 30-second timeout for confirmation
        def handle_digu_confirmation_timeout():
            if room_id in digu_rooms:
                room = digu_rooms[room_id]
                if room['metadata']['status'] == 'confirming':
                    # Check who didn't confirm
                    unconfirmed = []
                    confirmed = []
                    for pos, player in room['players'].items():
                        if not player.get('confirmed', False):
                            unconfirmed.append((pos, player))
                        else:
                            confirmed.append((pos, player))

                    print(f'[DIGU] Match {room_id} timeout: {len(unconfirmed)} players did not confirm')

                    # Notify unconfirmed players they were removed
                    for pos, player in unconfirmed:
                        socketio.emit('digu_match_timeout', {
                            'message': 'You did not confirm in time'
                        }, to=player['oderId'])
                        # Clean up session
                        if player['oderId'] in player_sessions:
                            del player_sessions[player['oderId']]
                        leave_room(room_id, sid=player['oderId'])

                    # Put confirmed players back in queue
                    for pos, player in confirmed:
                        socketio.emit('digu_match_cancelled', {
                            'message': 'Match cancelled - some players did not confirm',
                            'requeued': True
                        }, to=player['oderId'])
                        # Clean up session and requeue
                        if player['oderId'] in player_sessions:
                            del player_sessions[player['oderId']]
                        leave_room(room_id, sid=player['oderId'])
                        digu_matchmaking_queue.append({
                            'sid': player['oderId'],
                            'name': player['name'],
                            'joinedAt': time.time()
                        })

                    # Delete the room
                    del digu_rooms[room_id]
                    print(f'[DIGU] Match {room_id} cancelled due to timeout')

                    # Check if we can start a new match with requeued players
                    broadcast_digu_queue_status()
                    check_and_start_digu_match()

            # Clean up timeout reference
            if room_id in digu_match_timeouts:
                del digu_match_timeouts[room_id]

        # Start timeout timer
        timer = threading.Timer(30, handle_digu_confirmation_timeout)
        timer.start()
        digu_match_timeouts[room_id] = timer

        return True
    return False

@socketio.on('leave_digu_queue')
def handle_leave_digu_queue():
    """Leave the Digu matchmaking queue"""
    sid = request.sid

    was_in_queue = any(p['sid'] == sid for p in digu_matchmaking_queue)
    remove_from_digu_queue(sid)

    if was_in_queue:
        print(f'Player left Digu matchmaking queue. Queue size: {len(digu_matchmaking_queue)}')
        emit('digu_queue_left', {})
        broadcast_digu_queue_status()

@socketio.on('digu_confirm_match')
def handle_digu_confirm_match():
    """Handle player confirming their Digu quickplay match"""
    sid = request.sid

    if sid not in player_sessions:
        emit('error', {'message': 'Not in a match'})
        return

    session = player_sessions[sid]
    if session.get('gameType') != 'digu':
        emit('error', {'message': 'Not in a Digu match'})
        return

    room_id = session['roomId']
    position = session['position']

    if room_id not in digu_rooms:
        emit('error', {'message': 'Match not found'})
        return

    room = digu_rooms[room_id]

    # Only for quickmatch in confirming status
    if not room['metadata'].get('isQuickMatch') or room['metadata']['status'] != 'confirming':
        emit('error', {'message': 'Not in confirmation phase'})
        return

    # Mark player as confirmed
    if position in room['players']:
        room['players'][position]['confirmed'] = True
        room['players'][position]['ready'] = True

        print(f'[DIGU] Player {room["players"][position]["name"]} confirmed match {room_id}')

        # Notify all players of the confirmation
        socketio.emit('digu_player_confirmed', {
            'position': position,
            'players': room['players']
        }, room=room_id)

        # Check if all players confirmed
        all_confirmed = all(p.get('confirmed', False) for p in room['players'].values())

        if all_confirmed:
            # Cancel the timeout timer
            if room_id in digu_match_timeouts:
                digu_match_timeouts[room_id].cancel()
                del digu_match_timeouts[room_id]

            # Update status
            room['metadata']['status'] = 'waiting'
            print(f'[DIGU] All players confirmed for match {room_id}')

            # Notify all players that everyone confirmed
            socketio.emit('digu_all_confirmed', {
                'roomId': room_id,
                'players': room['players']
            }, room=room_id)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    print(f'Starting Thaasbai server on port {port}...')
    add_server_log('info', 'server', f'Server starting on port {port}', {
        'asyncMode': ASYNC_MODE,
        'maxConnectionsPerIP': MAX_CONNECTIONS_PER_IP,
        'connectionRateLimit': CONNECTION_RATE_LIMIT
    })
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
