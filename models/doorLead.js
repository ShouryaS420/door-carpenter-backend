// models/doorLead.js
import mongoose from "mongoose";
const { Schema } = mongoose;

const callLogSchema = new Schema({
    outcome:    String,
    details:    Schema.Types.Mixed,
    loggedAt:   Date,
    loggedBy:   String      // e.g. user.name or userId
}, { _id: false });

const stageMetaSchema = new Schema({
    status:      String,    // e.g. "LEAD_NEW", "MEASURE_BOOKED"…
    responsible: String,    // userId who should update this stage
    uploadedBy:  String,    // userId who actually updated
    updatedAt:   { type: Date, default: Date.now },
    dueAt:       Date,
    overdue:     { type: Boolean, default: false },
    incomplete:  { type: Boolean, default: false },
    reason:      String,
    updatedBy:  String      // e.g. user.name or userId
}, { _id:false });

const taskSchema = new Schema({
    title:       String,
    role:        String,    // e.g. "sales_exec", "ops_coord"
    assignedTo:  String,    // userId
    status:      { type:String, enum:["OPEN","DONE","BLOCKED"], default:"OPEN" },
    dueAt:       Date,
    completedAt: Date,
    blockedReason: String
}, { _id:false });

const measurementSchema = new mongoose.Schema({
    label:       String,    // e.g. “Front Door”, “Patio Set”
    width:       Number,    // in mm
    height:      Number,
    thickness:   Number,
    quantity:    Number,
    notes:       String,
    framePhoto:  Schema.Types.Mixed,
    completedAt: Date
});

const quotationSchema = new mongoose.Schema({
    quoteNo:    String,
    createdAt:  { type: Date, default: Date.now },
    validUpto:  Date,
    fileName:   String,
    metadata:   mongoose.Schema.Types.Mixed  // whatever you want to store for later
}, { _id: false });

const paymentSchema = new Schema({
  referenceId:     String,            // your unique ref used while creating the link
  paymentLinkId:   String,            // rzp paylink id (pl_...)
  shortUrl:        String,            // Razorpay short_url
  description:     String,
  status:          String,            // created | paid | cancelled | failed | pending
  amount:          Number,            // paise
  currency:        String,

  // customer snapshot
  customer: {
    name:   String,
    email:  String,
    contact:String
  },

  // timestamps from Razorpay
  createdAt:       Date,              // when link created
  expiresAt:       Date,              // when link expires (if set)
  paidAt:          Date,              // when payment captured

  // payment details once paid
  paymentId:       String,            // pay_...
  method:          String,            // card | upi | netbanking | wallet ...
  card:            Schema.Types.Mixed, // { network, last4, type, issuer }
  bank:            String,
  vpa:             String,
  fees:            Number,            // fee in paise
  tax:             Number,            // gst on fee in paise

  notes:           Schema.Types.Mixed, // whatever you passed to Razorpay
  raw:             Schema.Types.Mixed  // keep original objects for audit
}, { _id: false });

// models/DoorLead.js  (snippets)
const DesignFileSchema = new mongoose.Schema({
    url: String,
    filename: String,
    mime: String,
}, { _id: false });

const DesignRevisionSchema = new mongoose.Schema({
    version: Number,                 // 1,2,3...
    token: String,                   // unique token for public review
    files: [DesignFileSchema],       // images/pdfs
    notesFromOps: String,            // optional internal note
    createdAt: Date,                 // when sent for approval
    approval: {
        status: { type: String, enum: ["draft","pending","approved","changes"], default: "pending" },
        notes: String,                 // client's feedback
        decidedAt: Date
    },
}, { _id: true });

const DesignSchema = new mongoose.Schema({
    revisions: [DesignRevisionSchema],
    frozen: {                        // set on approval
        revisionId: { type: mongoose.Schema.Types.ObjectId, ref: "DoorLead.design.revisions" },
        version: Number,
        at: Date
    }
}, { _id: false });

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
    status:     { type:String, default:"LEAD_NEW" },
    assignee:  String,      // current userId responsible
    stageMeta:  { type: [stageMetaSchema], default: [] },
    calls:      { type: [callLogSchema],  default: [] },
    tasks:     [taskSchema],
    notified: { type: Boolean, default: false },
    activityLog: [{
        type: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        actor: { type: String, default: "System" },
        details: { type: Schema.Types.Mixed }
    }],
    measurements: [ measurementSchema ],
    quotations: [quotationSchema],
    payments: { type: [paymentSchema], default: [] },
    tracking: {
        token: String,          // public token (random)
        tokenHash: String,      // store hash instead if you prefer
        createdAt: Date,
        revoked: { type:Boolean, default:false }
    },
    design: { type: DesignSchema, default: () => ({ revisions: [] }) },
    createdAt: { type: Date, default: Date.now },
    updatedAt:  { type: Date, default: Date.now }
});

leadSchema.pre("save", function(next) {
    this.updatedAt = Date.now();
    next();
});

const DoorLead = mongoose.model('DoorLead', leadSchema);

export default DoorLead;
