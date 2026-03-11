import mongoose from "mongoose";

const leftoverFoodReportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  placeName: { type: String, required: true },

  // 📍 Location
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },

  // 🍱 Mission Specifics (Matches your new Frontend)
  quantity: { type: Number, required: true },
  foodType: {
    type: String,
    enum: ["Veg", "Non-Veg", "Mix"],
    default: "Veg"
  },

  // ⏳ Time Management
  // This is the USER-INPUTTED expiry from the form
  expiryTime: { type: Date, required: true },

  // This is for the DB to handle auto-status updates (Optional)
  reportedAt: { type: Date, default: Date.now },

  notes: { type: String },

  // 🚦 Lifecycle
  status: {
    type: String,
    // Added 'Delivered' to match your Analysis logic
    enum: ["Available", "Claimed", "Collected", "Delivered", "Expired"],
    default: "Available"
  },

  // 👥 Assignment Tracking (Matches your Pollution/Pickup logic)
  assignedVolunteer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  // claimedBy is used by volunteer claim/unclaim/complete flows
  claimedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },
  volunteerName: { type: String },
  volunteerPhone: { type: String },

  claimedAt: { type: Date },
  completedAt: { type: Date },

  // 📸 Delivery proof photo from volunteer
  deliveryPhoto: { type: String, default: null },

  // ✅ New: Donor confirmation of collection
  donorConfirmedCollection: { type: Boolean, default: false },

  // 🕵️ SECURITY SYSTEM
  isFlagged: { type: Boolean, default: false },
  flagReason: { type: String, default: "" },
  volFlaggedByCitizen: { type: Boolean, default: false },
  volFlagReason: { type: String, default: "" },
  helpRequested: { type: Boolean, default: false },
  helpAt: { type: Date, default: null },
  helpMessage: { type: String, default: "" }



}, { timestamps: true });

/* ❌ REMOVED TTL INDEX: 
  Instead of deleting the data, we want to keep it for 'FoodAnalysis'.
  You can run a Cron job or a simple query to mark status as "Expired" 
  if Date.now() > expiryTime.
*/

const LeftoverFoodReport = mongoose.model(
  "LeftoverFoodReport",
  leftoverFoodReportSchema
);

export default LeftoverFoodReport;