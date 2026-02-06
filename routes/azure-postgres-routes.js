const express = require("express");
const axios = require("axios");

// Expects to be called like: require('./azure-postgres-routes')({ ensureAdmin })
module.exports = function ({ ensureAdmin }) {
  const router = express.Router();

  async function getMgmtToken() {
    const tenant = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!tenant || !clientId || !clientSecret) {
      throw new Error("Missing Azure AD credentials (AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET)");
    }

    const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://management.azure.com/.default",
    });

    const resp = await axios.post(tokenUrl, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (!resp.data || !resp.data.access_token) {
      throw new Error("Failed to acquire management token");
    }
    return resp.data.access_token;
  }

  async function callMgmtApi(method, subscriptionId, resourceGroup, serverName, action) {
    const token = await getMgmtToken();

    const apiVersion = process.env.AZURE_MGMT_API_VERSION || "2021-06-01";
    const sub = subscriptionId || process.env.AZURE_SUBSCRIPTION_ID;
    if (!sub) throw new Error("Missing subscription id (pass in body or set AZURE_SUBSCRIPTION_ID)");

    const url = `https://management.azure.com/subscriptions/${encodeURIComponent(
      sub
    )}/resourceGroups/${encodeURIComponent(resourceGroup)}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${encodeURIComponent(
      serverName
    )}/${action}?api-version=${apiVersion}`;

    // Send an explicit empty JSON body and proper Content-Type header.
    // Azure Management API rejects 'application/x-www-form-urlencoded'.
    return axios.post(
      url,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        maxRedirects: 0,
      }
    );
  }

  // Helper to resolve target values from body or env
  function resolveTarget({ resourceGroup, serverName, subscriptionId }) {
    const rg = resourceGroup || process.env.AZURE_RESOURCE_GROUP || null;
    const sv = serverName || process.env.AZURE_PG_SERVER_NAME || null;
    const sub = subscriptionId || process.env.AZURE_SUBSCRIPTION_ID || null;
    return { resourceGroup: rg, serverName: sv, subscriptionId: sub };
  }

  // Start server
  router.post("/start", ensureAdmin, async (req, res) => {
    const resolved = resolveTarget(req.body || {});

    console.log("[DB-API] Start target", resolved);

    if (!resolved.resourceGroup || !resolved.serverName) {
      return res.status(400).json({ error: "Missing target: set AZURE_RESOURCE_GROUP and AZURE_PG_SERVER_NAME in .env or include resourceGroup/serverName in request body" });
    }

    try {
      const resp = await callMgmtApi("post", resolved.subscriptionId, resolved.resourceGroup, resolved.serverName, "start");
      res.json({ status: "started", details: resp.data || null });
    } catch (err) {
      console.error("Start error:", err.response?.data || err.message || err);
      res.status(err.response?.status || 500).json({ error: err.response?.data || String(err.message) });
    }
  });

  // Stop server
  router.post("/stop", ensureAdmin, async (req, res) => {
    const resolved = resolveTarget(req.body || {});

    console.log("[DB-API] Stop target", resolved);

    if (!resolved.resourceGroup || !resolved.serverName) {
      return res.status(400).json({ error: "Missing target: set AZURE_RESOURCE_GROUP and AZURE_PG_SERVER_NAME in .env or include resourceGroup/serverName in request body" });
    }

    try {
      const resp = await callMgmtApi("post", resolved.subscriptionId, resolved.resourceGroup, resolved.serverName, "stop");
      res.json({ status: "stopped", details: resp.data || null });
    } catch (err) {
      console.error("Stop error:", err.response?.data || err.message || err);
      res.status(err.response?.status || 500).json({ error: err.response?.data || String(err.message) });
    }
  });

  // Admin-only: return resolved defaults so UI can read .env-backed values
  router.get('/defaults', ensureAdmin, (req, res) => {
    const defaults = {
      resourceGroup: process.env.AZURE_RESOURCE_GROUP || null,
      serverName: process.env.AZURE_PG_SERVER_NAME || null,
      subscriptionId: process.env.AZURE_SUBSCRIPTION_ID || null,
    };
    res.json(defaults);
  });

  return router;
};
