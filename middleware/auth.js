// middleware/auth.js
import jwt from "jsonwebtoken";

export const verify = (req,res,next) => {
    if (req.originalUrl.startsWith("/api/auth")) return next();
    // console.log(req.headers);

    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    try{
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    }catch(e) {
        res.status(401).json({ error: e });
    }
}