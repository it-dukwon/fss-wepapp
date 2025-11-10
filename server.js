const express = require("express");
const path = require("path");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, "public")));

// 루트 경로
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// access token 발급 API
app.get("/api/token", async (req, res) => {
  try {
    const response = await axios.post(
      "https://accounts.azuredatabricks.net/oauth2/token",
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.DATABRICKS_CLIENT_ID,
        client_secret: process.env.DATABRICKS_CLIENT_SECRET,
        scope: "all",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    res.json({ access_token: response.data.access_token });
  } catch (error) {
    console.error("Token error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to get access token" });
  }
});

// iframe 페이지
app.get("/dashboard", (req, res) => {
  res.send(`
    <html>
      <head><title>Databricks Dashboard</title></head>
      <body>
        <h1>Databricks Dashboard</h1>
        <iframe
          src="${process.env.DATABRICKS_DASHBOARD_URL}"
          width="100%"
          height="600"
          frameborder="0">
        </iframe>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});