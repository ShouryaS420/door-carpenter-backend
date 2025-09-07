// src/middleware/uploadFrames.js
import multer from "multer";
import path from "path";

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(process.cwd(), "uploads/frames"));
    },
    filename: (req, file, cb) => {
        const leadId    = req.params.id;
        const timestamp = Date.now();
        // file.fieldname will be "framePhoto"—we’ll index them in controller
        const ext       = path.extname(file.originalname);
        cb(null, `${leadId}_${timestamp}_${file.originalname}`);
    }
});

// allow up to, say, 20 photos in one request
export const uploadFrames = multer({ storage }).array("framePhotos", 20);
