import mongoose from "mongoose";

const pickupSchema = new mongoose.Schema(
  {
    // 👤 USER INFO
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    userName: {
      type: String,
      required: true
    },
    userPhone: {
      type: String,
      required: true
    },

    // 📍 PICKUP DETAILS (UPDATED FOR GPS)
    address: {
      type: String,
      required: true
    },

    // NEW: Precise GPS Coordinates
    location: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true }
    },

    wasteType: {
      type: String,
      required: true
    },
    pickupDate: {
      type: Date,
      required: true
    },
    timeSlot: {
      type: String,
      required: true
    },
    description: {
      type: String,
      default: ""
    },

    // 🔄 STATUS LIFECYCLE
    status: {
      type: String,
      enum: [
        "Pending",
        "claimed",     // Matches your backend claimMission logic
        "Arrived",
        "Paid",
        "Completed",
        "Cancelled"
      ],
      default: "Pending"
    },

    // 💰 PAYMENT INFO
    isPaid: {
      type: Boolean,
      default: false
    },
    paidAmount: {
      type: Number,
      default: 0
    },
    paymentId: {
      type: String,
      default: null
    },
    paidAt: {
      type: Date,
      default: null
    },

    // 🙋 VOLUNTEER INFO
    assignedVolunteer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    claimedAt: { // Track when the mission was taken
      type: Date,
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

export default mongoose.model("Pickup", pickupSchema);