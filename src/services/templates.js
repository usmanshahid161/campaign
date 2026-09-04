// services/templates.js
const axios = require('axios');
const configs = require('../config');

// Forwards the admin's own JWT rather than using an internal key — same
// tenant-scoping and permission checks admin_backend already enforces
// for a normal authenticated request, no separate internal-key path
// needed here.
async function getTemplate(authHeader, templateId) {
  try {
    const { data } = await axios.get(`${configs.ADMIN_SERVICE_URL}/templates/${templateId}`, {
      headers: { Authorization: authHeader },
    });
    return data?.data;
  } catch (err) {
    if (err.response?.status === 404) {
      const notFound = new Error('Template not found');
      notFound.statusCode = 404;
      throw notFound;
    }
    throw err;
  }
}

module.exports = { getTemplate };
