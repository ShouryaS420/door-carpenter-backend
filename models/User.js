// models/User.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const { Schema } = mongoose;

const userSchema = new Schema({
    name:       { type: String, required: true },
    email:      { type: String, required: true, unique: true, lowercase: true },
    phone:      { type: String, default: "" },
    password:   { type: String, required: true },
    role:       {
        type: Array,
        default: [],
        // enum: ["Admin","Sales","Operations","Estimator","Installer","Support"]
    },
    createdAt:  { type: Date, default: Date.now }
});

// hash password on save
userSchema.pre("save", async function(next){
    if (!this.isModified("password")) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

// helper to compare
userSchema.methods.comparePassword = function(plain){
    return bcrypt.compare(plain, this.password);
};

export default mongoose.model("User", userSchema);
