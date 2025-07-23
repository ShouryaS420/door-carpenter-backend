import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const login = async (req, res) => {
    console.log(req.body.user);
    console.log(req.body.pass);
    const { user, pass } = req.body;           // make sure body-parser is enabled
    if (user !== process.env.ADMIN_USER) return res.status(401).end();

    const ok = await bcrypt.compare(pass, process.env.ADMIN_HASH);
    if (!ok) return res.status(401).end();

    const token = jwt.sign({ role:"admin" }, process.env.JWT_SECRET, { expiresIn:"12h" });
    res.json({ token });
}