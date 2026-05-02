const express = require('express');
const axios = require('axios');
const { Log, initLogger } = require('../logging_middleware');

const app = express();
app.use(express.json());

const CREDENTIALS = {
  email: 'rs1985@srmist.edu.in',
  name: 'RAUNAKJIT SINGHA',
  rollNo: 'RA2311003010412',
  accessCode: 'QkbpxH',
  clientID: 'f2bbcc83-37a2-42af-af02-55fc2d863672',
  clientSecret: 'CwkEcCwVYuDVAWPU'
};

const BASE_URL = 'http://20.207.122.201/evaluation-service';
let TOKEN = null;

initLogger(CREDENTIALS);

async function getToken() {
  if (TOKEN) return TOKEN;
  const res = await axios.post(`${BASE_URL}/auth`, CREDENTIALS);
  TOKEN = res.data.access_token;
  await Log('backend', 'info', 'auth', 'Token obtained for notification app');
  return TOKEN;
}

// Priority scoring
const TYPE_WEIGHT = { Placement: 30, Result: 20, Event: 10 };

function getPriorityScore(notification) {
  const typeScore = TYPE_WEIGHT[notification.Type] || 0;
  const ageMs = Date.now() - new Date(notification.Timestamp).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const recency = Math.max(0, 10 - ageHours);
  return parseFloat((typeScore + recency).toFixed(2));
}

// GET /notifications - all notifications sorted by priority
app.get('/notifications', async (req, res) => {
  await Log('backend', 'info', 'route', 'GET /notifications called');
  try {
    const token = await getToken();
    const response = await axios.get(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const notifications = response.data.notifications.map(n => ({
      ...n,
      priorityScore: getPriorityScore(n)
    }));

    notifications.sort((a, b) => b.priorityScore - a.priorityScore);

    await Log('backend', 'info', 'service',
      `Returning ${notifications.length} notifications sorted by priority`);

    return res.status(200).json({
      total: notifications.length,
      notifications
    });

  } catch (err) {
    await Log('backend', 'error', 'handler', `GET /notifications error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// GET /notifications/priority?top=10
app.get('/notifications/priority', async (req, res) => {
  const top = parseInt(req.query.top) || 10;
  await Log('backend', 'info', 'route', `GET /notifications/priority?top=${top} called`);

  try {
    const token = await getToken();
    const response = await axios.get(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const scored = response.data.notifications
      .map(n => ({
        ...n,
        priorityScore: getPriorityScore(n)
      }))
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, top);

    await Log('backend', 'info', 'service',
      `Priority inbox: returning top ${top} notifications`);

    return res.status(200).json({
      top,
      total: response.data.notifications.length,
      notifications: scored
    });

  } catch (err) {
    await Log('backend', 'error', 'handler', `Priority inbox error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// GET /notifications/type/:type - filter by type
app.get('/notifications/type/:type', async (req, res) => {
  const { type } = req.params;
  await Log('backend', 'info', 'route', `GET /notifications/type/${type} called`);

  try {
    const token = await getToken();
    const response = await axios.get(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const filtered = response.data.notifications
      .filter(n => n.Type.toLowerCase() === type.toLowerCase())
      .map(n => ({ ...n, priorityScore: getPriorityScore(n) }))
      .sort((a, b) => b.priorityScore - a.priorityScore);

    await Log('backend', 'info', 'service',
      `Filter by type ${type}: found ${filtered.length} notifications`);

    return res.status(200).json({
      type,
      total: filtered.length,
      notifications: filtered
    });

  } catch (err) {
    await Log('backend', 'error', 'handler', `Filter by type error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// GET /notifications/:id - single notification
app.get('/notifications/:id', async (req, res) => {
  const { id } = req.params;
  await Log('backend', 'info', 'route', `GET /notifications/${id} called`);

  try {
    const token = await getToken();
    const response = await axios.get(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const notification = response.data.notifications.find(n => n.ID === id);

    if (!notification) {
      await Log('backend', 'warn', 'handler', `Notification ${id} not found`);
      return res.status(404).json({ error: 'Notification not found' });
    }

    await Log('backend', 'info', 'service', `Returning notification ${id}`);
    return res.status(200).json({
      notification: { ...notification, priorityScore: getPriorityScore(notification) }
    });

  } catch (err) {
    await Log('backend', 'error', 'handler', `GET /notifications/${id} error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = 3002;
app.listen(PORT, async () => {
  console.log(`Notification App running at http://localhost:${PORT}`);
  await Log('backend', 'info', 'service', `Notification app started on port ${PORT}`);
});