// models/doorLead.js
import mongoose from "mongoose";
const { Schema } = mongoose;

const leadSchema = new Schema({
    sessionId:  { type: String, required: true, index: true },
    category:   String,
    core:       String,
    finish:     Object,
    hardware:   Object,
    design:     Object,
    size:       Object,
    quantity:   Number,
    contact: {
        name:  String,
        phone: String,
        email: String,
        pin:   String,
        notes: String
    },
    createdAt: { type: Date, default: Date.now }
});

const DoorLead = mongoose.model('DoorLead', leadSchema);

export default DoorLead;
