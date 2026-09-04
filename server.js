// Some Node.js versions don't expose `crypto` as a global — both the
// mongodb driver and (later, if AWS SDK is used here for media) expect
// it to already be there. See local_service/center-service's server.js
// for the same fix; this bit everyone on the EC2 deployment before, so
// it's included from day one here instead of waiting to hit it again.
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = require("node:crypto").webcrypto;
}

const express = require("express");
const cors = require("cors");

const config = require("./src/config");
const { connectMongoDB } = require("./src/config/mongodb");
const { authMiddleware } = require("./src/middleware/middleware");

const contactListsRoutes = require("./src/routes/contactLists");
const campaignsRoutes = require("./src/routes/campaigns");
const optOutsRoutes = require("./src/routes/optOuts");
const campaignWorker = require("./src/workers/campaignWorker");

const app = express();

app.use(express.json());
app.use(cors());

const startServer = async () => {
  try {
    await connectMongoDB();

    app.listen(config.PORT, () => {
      console.log(`Campaign service running on port ${config.PORT}`);
    });

    app.get("/", (req, res) => {
      res.send("Campaign service is running");
    });

    app.use(authMiddleware);

    app.use("/contact-lists", contactListsRoutes);
    app.use("/campaigns", campaignsRoutes);
    app.use("/opt-outs", optOutsRoutes);

    // Translates thrown errors (with an optional statusCode/message) into
    // a proper JSON response instead of Express's default HTML page.
    app.use((err, req, res, next) => {
      console.error(err);
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Something went wrong",
        ...(err.details ? { details: err.details } : {}),
      });
    });

    // Runs in the same process as the API — simplest option at this
    // scale (see workers/campaignWorker.js for why this isn't RabbitMQ
    // based: MongoDB itself is already the durable source of truth for
    // "what's left to send", so a worker restart just picks up any
    // still-PENDING recipients rather than losing anything).
    campaignWorker.start();
  } catch (error) {
    console.error("Failed to start Campaign Service:", error);
    process.exit(1);
  }
};

startServer();
