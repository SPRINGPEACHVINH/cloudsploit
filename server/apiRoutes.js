const express = require("express");
const apiController = require("./api_controller")
const router = express.Router();

router.get("/", (req, res) => {
  res.json({ message: "Welcome to the Cloudsploit DSPM API v1" });
});

// Define other API routes here
router.post("/scan", apiController.handleScan);

module.exports = router;