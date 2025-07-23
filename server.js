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

connectDatabase();

app.listen(process.env.PORT, () => {
  console.log("Server is running on port " + process.env.PORT);
});