// controllers/userController.js
import mongoose from "mongoose";
import User from "../models/User.js";
import jwt  from "jsonwebtoken";

export const createUser = async (req, res) => {
    console.log(req.body);

    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        
        const { name, email, phone, role, password, } = req.body;

        // Validation: Check if any of the required fields are empty
        if (!name || !email || !phone || !role || !password) {
            return res.status(400).json({ message: 'All fields must be filled.', success: false });
        }

        const newUser = new User(req.body);

        const saveUserDetails = await newUser.save({ session });

        await session.commitTransaction();
        res.status(201).json({ message: "User Created Successfully", success: true, data: saveUserDetails });

    } catch (error) {

        console.error('Transaction error:', error); // Enhanced logging
        await session.abortTransaction();
        res.status(500).json({ message: 'Server error', error: error.message, success: false });

    } finally {
        session.endSession();
    }
};

export const listUsers = async (req, res) => {
    try {
        const user = await User.find();
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user', error: error.message });
    }
};

export const getAllTechnicians = async (req, res) => {
    try {
        const technicians = await User.find({ role: "Technician" }).select("name email phone role");
        res.status(200).json({ success: true, technicians });
    } catch (err) {
        console.error("Error fetching technicians:", err.message);
        res.status(500).json({ success: false, error: "server-error", message: err.message });
    }
};

export const loginUser = async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
        return res.status(401).json({ error: "invalid-credentials" });

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, {
        expiresIn: "356d"
    });
    res.json({ token, user: user });
};
