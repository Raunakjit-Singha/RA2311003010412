const axios = require('axios');

const BASE_URL = 'http://20.207.122.201/evaluation-service';

let _token = null;
let _credentials = null;

function initLogger(credentials) {
  _credentials = credentials;
}

async function getToken() {
  if (_token) return _token;
  try {
    const res = await axios.post(`${BASE_URL}/auth`, _credentials);
    _token = res.data.access_token;
    return _token;
  } catch (err) {
    // silent
  }
}

async function Log(stack, level, pkg, message) {
  try {
    const token = await getToken();
    const res = await axios.post(
      `${BASE_URL}/logs`,
      { stack, level, package: pkg, message },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return res.data;
  } catch (err) {
    // never crash app due to logging
  }
}

module.exports = { Log, initLogger };