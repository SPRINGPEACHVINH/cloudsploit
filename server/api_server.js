const express = require("express");
const cors = require("cors");
const apiRoutes = require("./apiRoutes");
require("dotenv").config();

const PORT = process.env.PORT;
const host = process.env.host;
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use("/dspm/v1", apiRoutes);
app.use("/dspm", (req, res) => {
  res.json({ message: "Welcome to the Cloudsploit DSPM API" });
});

app.listen(PORT, host, () => {
  console.log(
    `Cloudsploit Server is running on http://${host}:${PORT}/dspm/v1`
  );
});

module.exports = app;