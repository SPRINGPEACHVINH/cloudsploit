import express from "express";
import cors from "cors";

const PORT = 3000;
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use("/dspm/v1", (req, res) => {
  res.json({ message: "Welcome to the Cloudsploit DSPM API v1" });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(
    `Cloudsploit Server is running on http://localhost:${PORT}/dspm/v1`
  );
});

export default app;
