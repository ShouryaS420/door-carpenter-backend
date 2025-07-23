// server/routes/upload.js – handles multipart upload, returns URL
import express from "express";
import multer from "multer";
import path from "path";
import { v4 as uuid } from "uuid";


const storage = multer.diskStorage({
destination: path.resolve("uploads"),
    filename: (_req, file, cb) => {
        const unique = uuid() + path.extname(file.originalname || "");
        cb(null, unique);
    }
});
const upload = multer({ storage });

const router = express.Router();
router.post("/", upload.single("file"), (req,res)=>{
    const url = `/uploads/${req.file.filename}`;  // static mapped in app.js
    res.json({ url });
});

export default router;
