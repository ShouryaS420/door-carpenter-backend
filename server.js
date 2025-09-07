// server.js (snippet)
import { config } from "dotenv";
import express from "express";
import mongoose from "mongoose";
import doorLeads from "./routes/doorLeads.js";
import { connectDatabase } from "./config/database.js";
import { app } from "./app.js";

config({
  path: "./config/config.env",
});

console.log(process.env.MONGO_URI);


// connectDatabase();

// app.listen(process.env.PORT, () => {
//   console.log("Server is running on port " + process.env.PORT);
// });
const PORT = process.env.PORT || 4000;

mongoose.set("strictQuery", false); // optional but good
mongoose.set("bufferCommands", false); // prevent buffering

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 10000
  })
  .then(() => {
    console.log("✅ MongoDB connected");

    // ✅ SAFE: only now run cron jobs or background tasks
    import("./cron/autoAssign.js").then(() => {
      console.log("🧠 autoAssign cron loaded");
    });

    // only start server after connection is ready
    app.listen(PORT, () =>
      console.log(`🚀 Server running on port ${PORT}`)
    );
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });