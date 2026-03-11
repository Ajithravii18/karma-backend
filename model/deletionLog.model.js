import mongoose from "mongoose";

const deletionLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    userName: { type: String },
    userPhone: { type: String },
    userRole: { type: String },
    reason: { type: String, required: true },
    deletedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const DeletionLog = mongoose.model("DeletionLog", deletionLogSchema);
export default DeletionLog;
