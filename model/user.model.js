import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: { type: String },

  phone: {
    type: String,
    required: true,
    unique: true
  },

  password: {
    type: String,
    required: true
  },

  // ✅ ADD THIS ROLE FIELD
  role: {
    type: String,
    enum: ["user", "volunteer", "admin"],
    default: "user" // Everyone starts as a normal user
  },

  resetOtp: {
    type: String,
  },

  resetOtpExpiry: {
    type: Date,
  },

  isFrozen: {
    type: Boolean,
    default: false
  },

  // ✅ New: Rating Fields for Volunteers
  averageRating: {
    type: Number,
    default: 0
  },
  reviewCount: {
    type: Number,
    default: 0
  }

}, { timestamps: true }); // Adding timestamps is helpful for tracking when users joined

export default mongoose.models.User || mongoose.model("User", userSchema);