import mongoose from "mongoose";

const pollutionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    pollutionType: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    // 🔥 UPDATED: Location is now mandatory for mapping
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    address: {
      type: String, // Human-readable address for the UI
    },
    photos: [String], // Original photos from reporter

    // 🔥 NEW: Proof of cleanup photos from volunteer
    resolvedPhotos: [String],

    status: {
      type: String,
      // 🔄 SYNCED STATUSES: Matches your Waste Pickup logic
      enum: ["Reported", "Verified", "Claimed", "Arrived", "Resolved"],
      default: "Reported",
    },

    // 🙋 VOLUNTEER ASSIGNMENT
    assignedVolunteer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },

    // 🕵️ SECURITY SYSTEM
    isFlagged: { type: Boolean, default: false },
    flagReason: { type: String, default: "" },
    volFlaggedByCitizen: { type: Boolean, default: false },
    volFlagReason: { type: String, default: "" },
    helpRequested: { type: Boolean, default: false },
    helpAt: { type: Date, default: null },
    helpMessage: { type: String, default: "" }


  },
  { timestamps: true }
);

export default mongoose.model("Pollution", pollutionSchema);