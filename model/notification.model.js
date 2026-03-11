import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  // The person who will see the notification (User, Volunteer, or Admin)
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // The person/system that triggered it (e.g., the Volunteer who arrived)
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Categorization for Role-Based UI Logic & Live Toasts
  type: {
    type: String,
    enum: [
      'PICKUP_ASSIGNED',   // For Volunteers (When a user requests)
      'VOLUNTEER_ARRIVED', // For Users (Trigger: Mark Arrival)
      'PAYMENT_RECEIVED',  // For Volunteers (Trigger: PayU Success)
      'PAYMENT_SUCCESS',   // For Users (Trigger: PayU Success)
      'PICKUP_FINISHED',   // For Users (Trigger: Confirm Collection)
      'FOOD_CLAIMED',      // For Donors (Volunteer claimed their food)
      'FOOD_DELIVERED',    // For Donors (Volunteer delivered the food)
      'POLLUTION_ALERT',
      'STATUS_UPDATE',
      'SYSTEM'
    ],
    required: true
  },

  // The actual text shown in the dropdown/toast
  message: {
    type: String,
    required: true
  },

  // Click-through link (e.g., "/dashboard" or "/volunteer-portal")
  link: {
    type: String
  },

  // Tracking read/unread status
  isRead: {
    type: Boolean,
    default: false
  },

  // Metadata to store the specific Pickup/Food ID if needed for navigation
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'onModel'
  },
  onModel: {
    type: String,
    enum: ['Pickup', 'Food', 'Pollution', 'LeftoverFoodReport']
  },

  createdAt: {
    type: Date,
    default: Date.now,
    expires: 604800 // Automatically deletes notifications after 7 days
  }
});

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;