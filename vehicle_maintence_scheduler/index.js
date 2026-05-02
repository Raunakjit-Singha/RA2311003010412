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
  await Log('backend', 'info', 'auth', 'Token obtained for vehicle scheduler');
  return TOKEN;
}

function knapsack(items, capacity) {
  const n = items.length;

  if (n * capacity > 10000000) {
    return greedyFallback(items, capacity);
  }

  const dp = [];
  for (let i = 0; i <= n; i++) {
    dp[i] = new Array(capacity + 1).fill(0);
  }

  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = items[i - 1];
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (Duration <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - Duration] + Impact);
      }
    }
  }

  const selected = [];
  let w = capacity;
  for (let i = n; i >= 1; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(items[i - 1]);
      w -= items[i - 1].Duration;
    }
  }

  return {
    selectedTasks: selected,
    totalImpact: dp[n][capacity],
    totalDuration: selected.reduce((s, t) => s + t.Duration, 0)
  };
}

function greedyFallback(items, capacity) {
  const sorted = [...items].sort(
    (a, b) => (b.Impact / b.Duration) - (a.Impact / a.Duration)
  );
  let remaining = capacity;
  const selected = [];
  for (const item of sorted) {
    if (item.Duration <= remaining) {
      selected.push(item);
      remaining -= item.Duration;
    }
  }
  return {
    selectedTasks: selected,
    totalImpact: selected.reduce((s, t) => s + t.Impact, 0),
    totalDuration: selected.reduce((s, t) => s + t.Duration, 0)
  };
}

// DEBUG - see raw API data
app.get('/debug', async (req, res) => {
  try {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}` };
    const [depotsRes, vehiclesRes] = await Promise.all([
      axios.get(`${BASE_URL}/depots`, { headers }),
      axios.get(`${BASE_URL}/vehicles`, { headers })
    ]);
    return res.json({
      depots: depotsRes.data,
      vehicleSample: vehiclesRes.data.vehicles.slice(0, 3)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /schedule - all depots
app.get('/schedule', async (req, res) => {
  await Log('backend', 'info', 'route', 'GET /schedule called');
  try {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}` };

    const [depotsRes, vehiclesRes] = await Promise.all([
      axios.get(`${BASE_URL}/depots`, { headers }),
      axios.get(`${BASE_URL}/vehicles`, { headers })
    ]);

    const vehicles = vehiclesRes.data.vehicles;
    const depots = depotsRes.data.depots;

    await Log('backend', 'info', 'service',
      `Processing ${depots.length} depots, ${vehicles.length} vehicles`);

    const schedules = depots.map(depot => {
      const result = knapsack(vehicles, depot.MechanicHours);
      return {
        depotId: depot.ID,
        mechanicHoursAvailable: depot.MechanicHours,
        totalDurationUsed: result.totalDuration,
        totalImpactScore: result.totalImpact,
        tasksSelected: result.selectedTasks.length,
        selectedTasks: result.selectedTasks
      };
    });

    await Log('backend', 'info', 'service', 'Scheduling complete for all depots');
    return res.status(200).json({ schedules });

  } catch (err) {
    await Log('backend', 'error', 'handler', `GET /schedule error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// GET /schedule/:depotId - single depot
app.get('/schedule/:depotId', async (req, res) => {
  const { depotId } = req.params;
  await Log('backend', 'info', 'route', `GET /schedule/${depotId} called`);

  try {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}` };

    const [depotsRes, vehiclesRes] = await Promise.all([
      axios.get(`${BASE_URL}/depots`, { headers }),
      axios.get(`${BASE_URL}/vehicles`, { headers })
    ]);

    // Handle both number and string ID matching
    const depot = depotsRes.data.depots.find(
      d => String(d.ID) === String(depotId) || 
           Number(d.ID) === Number(depotId)
    );

    if (!depot) {
      await Log('backend', 'warn', 'handler', `Depot ${depotId} not found`);
      return res.status(404).json({ 
        error: `Depot ${depotId} not found`,
        availableDepots: depotsRes.data.depots.map(d => d.ID)
      });
    }

    const result = knapsack(vehiclesRes.data.vehicles, depot.MechanicHours);

    await Log('backend', 'info', 'service',
      `Depot ${depotId}: selected ${result.selectedTasks.length} tasks, impact=${result.totalImpact}`);

    return res.status(200).json({
      depotId: depot.ID,
      mechanicHoursAvailable: depot.MechanicHours,
      totalDurationUsed: result.totalDuration,
      totalImpactScore: result.totalImpact,
      tasksSelected: result.selectedTasks.length,
      selectedTasks: result.selectedTasks
    });

  } catch (err) {
    await Log('backend', 'error', 'handler', `GET /schedule/${depotId} error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = 3001;
app.listen(PORT, async () => {
  console.log(`Vehicle Scheduler running at http://localhost:${PORT}`);
  await Log('backend', 'info', 'service', `Vehicle scheduler started on port ${PORT}`);
});