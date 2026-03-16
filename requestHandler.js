import userSchema from "./model/user.model.js";
import Pickup from "./model/pickup.model.js";
import Pollution from "./model/pollution.model.js";
import LeftoverFoodReport from "./model/LeftoverFoodReport.js";
import Notification from "./model/notification.model.js";
import User from "./model/user.model.js";
import DeletionLog from "./model/deletionLog.model.js";
import Review from "./model/review.model.js";
import bcrypt from "bcrypt";
import pkg from "jsonwebtoken";
import crypto from "crypto";
import mongoose from "mongoose";
import Groq from "groq-sdk";
import admin from "./Authentication/firebase.js";



const { sign } = pkg;

// ==========================================
// 1. USER AUTHENTICATION
// ==========================================

export async function displayuser(req, res) {
  try {
    const UserData = await userSchema.find().select("-password");
    res.send(UserData);
  } catch (error) {
    res.status(500).send("Error fetching users");
  }
}

export async function adduser(req, res) {
  try {
    const { name, phone, password } = req.body;
    const formattedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;
    let user = await userSchema.findOne({ phone: formattedPhone });
    if (user) return res.status(409).send("Phone number already exists");

    const hashpass = await bcrypt.hash(password, 10);
    const newUser = await userSchema.create({
      name,
      phone: formattedPhone,
      password: hashpass,
      role: "user"
    });

    await Notification.create({
      recipient: newUser._id,
      type: 'SYSTEM',
      message: `Welcome to E-Karma, ${name}!`,
      link: '/dashboard'
    });

    res.send("User added successfully");
  } catch (error) {
    res.status(500).send("Error creating user");
  }
}

export async function login(req, res) {
  try {
    let { phone, password } = req.body;
    phone = phone.startsWith("+91") ? phone : `+91${phone}`;
    const user = await userSchema.findOne({ phone });
    if (!user) return res.status(401).json({ message: "Phone number not found" });

    // 🕵️ Check if account is frozen
    if (user.isFrozen) {
      return res.status(403).json({
        message: "Your account has been frozen for violating community guidelines. Access is denied."
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) return res.status(401).json({ message: "Incorrect password" });

    let role = user.role || "user";

    const token = sign(
      { userID: user._id, role: role },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.status(200).json({
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} login successful`,
      token,
      user: { id: user._id, phone: user.phone, name: user.name, role: role },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
}

export async function getUser(req, res) {
  try {
    if (!req.user) return res.status(404).json({ message: "User not found" });

    // 1. Get the base role from the database
    let role = req.user.role || "user";

    res.status(200).json({
      id: req.user._id,
      name: req.user.name,
      phone: req.user.phone,
      role: role, // Now this sends "admin" to the Navbar
      createdAt: req.user.createdAt,
      averageRating: req.user.averageRating || 0,
      reviewCount: req.user.reviewCount || 0
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
}

// ==========================================
// 1b. PASSWORD RESET (FIREBASE OTP)
// ==========================================

export async function sendResetOtp(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone number is required" });

    const formattedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;
    const user = await userSchema.findOne({ phone: formattedPhone });
    if (!user) return res.status(404).json({ message: "No account found with this phone number" });

    // Phone exists in DB — frontend will now trigger Firebase OTP
    res.status(200).json({ message: "Phone verified. Sending OTP via Firebase." });
  } catch (error) {
    console.error("Send Reset OTP Error:", error);
    res.status(500).json({ message: "Failed to verify phone number" });
  }
}

export async function resetPassword(req, res) {
  try {
    const { phone, newPassword } = req.body;

    if (!phone || !newPassword) {
      return res.status(400).json({ message: "Phone and new password are required" });
    }

    const formattedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;
    const user = await userSchema.findOne({ phone: formattedPhone });

    if (!user) return res.status(404).json({ message: "User not found" });

    // OTP is already verified by Firebase on the frontend
    // Just hash and save the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    await user.save();

    res.status(200).json({ message: "Password reset successfully!" });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ message: "Failed to reset password" });
  }
}

// ==========================================
// 2. SERVICE REPORTING & NOTIFICATIONS
// ==========================================

export async function createPickup(req, res) {
  try {
    const {
      address,
      wasteType,
      pickupDate,
      timeSlot,
      description,
      lat,
      lng
    } = req.body;

    // 1. Create the instance with nested location object
    const pickup = new Pickup({
      userId: req.userID,
      userName: req.user.name,
      userPhone: req.user.phone,
      address,
      wasteType,
      pickupDate,
      timeSlot,
      description,
      location: {
        lat: parseFloat(lat), // Ensure coordinates are stored as Numbers
        lng: parseFloat(lng)
      },
      status: "Pending"
    });

    await pickup.save();

    // 2. Notification logic remains untouched
    const staff = await userSchema.find({ role: { $in: ["admin", "volunteer"] } });
    if (staff.length > 0) {
      const notifications = staff.map(s => ({
        recipient: s._id,
        type: 'PICKUP_ASSIGNED',
        message: `📦 New pickup requested by ${req.user.name}`,
        link: '/admin-dashboard'
      }));
      await Notification.insertMany(notifications);
    }

    res.status(201).json({
      success: true,
      message: "Pickup Scheduled with Exact Location",
      pickup
    });
  } catch (error) {
    console.error("Pickup Creation Error:", error);
    res.status(500).json({ error: error.message });
  }
}

export async function createPollutionReport(req, res) {
  try {
    const { pollutionType, description, lat, lng } = req.body;

    // 1. Process Photos
    const photos = req.files ? req.files.map(file => file.filename) : [];

    // 2. Create the Report in the "Discovery" Column
    const newReport = new Pollution({
      user: req.userID,
      pollutionType,
      description,
      // Ensure lat/lng are stored as numbers for the map to work
      location: {
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      },
      photos,
      status: "Reported" // 🔒 Starts here; hidden from Mission Board until Verified
    });

    await newReport.save();

    // 3. Find Admins for Notification
    const admins = await userSchema.find({ role: "admin" });

    // 4. Generate Notifications
    if (admins.length > 0) {
      const reporterName = req.user?.name || "A user";

      const notifications = admins.map(admin => ({
        recipient: admin._id,
        sender: req.userID,
        type: 'POLLUTION_ALERT',
        message: `🚨 New ${pollutionType} reported by ${reporterName}. Verification required.`,
        link: '/admin-dashboard',
        relatedId: newReport._id,
        onModel: 'Pollution'
      }));

      await Notification.insertMany(notifications);
    }

    res.status(201).json({
      success: true,
      message: "Environmental Report Transmitted to Command Center",
      report: newReport
    });

  } catch (err) {
    console.error("Pollution Submit Error:", err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
}

export async function reportLeftoverFood(req, res) {
  try {
    const { placeName, quantity, foodType, expiryTime, latitude, longitude, notes } = req.body;

    // 1. CREATE THE MISSION
    const food = await LeftoverFoodReport.create({
      userId: req.userID, // From Auth Middleware
      placeName,
      quantity: parseInt(quantity), // Force Number for Analytics
      foodType, // Veg/Non-Veg/Mix
      expiryTime, // ISO string from frontend
      latitude,
      longitude,
      notes,
      status: "Available",
      reportedAt: new Date()
    });

    // 2. SMART NOTIFICATION SYSTEM
    // Fetch only active volunteers to keep it fast
    const volunteers = await userSchema.find({ role: "volunteer" });

    if (volunteers.length > 0) {
      // Create a message that triggers "Urgency"
      const expiryDate = new Date(expiryTime);
      const timeString = expiryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const notifications = volunteers.map(v => ({
        recipient: v._id,
        sender: req.userID,
        type: 'SYSTEM',
        message: `🚨 URGENT: ${quantity} servings of ${foodType} food available at ${placeName}. Fresh until ${timeString}!`,
        relatedId: food._id,
        onModel: 'LeftoverFoodReport',
        link: '/volunteer-portal'
      }));

      // InsertMany is more efficient than individual .create() calls
      await Notification.insertMany(notifications);
    }

    res.status(201).json({
      success: true,
      message: "Food mission dispatched to volunteers!",
      data: food
    });

  } catch (error) {
    console.error("REPORT FOOD ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Server error while processing food report."
    });
  }
}

export async function uploadDeliveryPhoto(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No photo uploaded." });
    }
    // Build the publicly accessible URL using the server's base
    const photoUrl = `${process.env.SERVER_URL}/uploads/${req.file.filename}`;
    res.status(200).json({ success: true, url: photoUrl });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ message: "Failed to save photo." });
  }
}

// ==========================================
// 3. VOLUNTEER & NOTIFICATION ACTIONS
// ==========================================

export async function getVolunteerTasks(req, res) {
  try {
    const volunteerId = req.userID;

    // 1. Fetch actionable tasks concurrently with more generous filters
    const [allPickups, allFood, allPollution] = await Promise.all([
      // Waste: Show unassigned tasks (except completed) plus anything currently/previously assigned to me
      Pickup.find({
        $or: [
          { assignedVolunteer: null, status: { $ne: "Completed" } },
          { assignedVolunteer: volunteerId }
        ]
      }).populate("userId", "phone").lean(),

      // Food: Show available tasks plus those I've already claimed
      LeftoverFoodReport.find({
        $or: [
          { status: { $in: ["Available", "available"] } },
          { claimedBy: volunteerId }
        ]
      }).populate("userId", "phone").lean(),

      // Pollution: Show verified public reports or any task assigned to me (regardless of status)
      Pollution.find({
        $or: [
          { status: "Verified", assignedVolunteer: null },
          { assignedVolunteer: volunteerId }
        ]
      }).populate("user", "phone").lean()
    ]);

    // 2. Format Waste Pickups (Logic updated to handle "Claimed" vs "Pending")
    const formattedWaste = allPickups.map(t => ({
      ...t,
      isWaste: true,
      isFood: false,
      isPollution: false,
      status: t.status || "Pending",
      isMine: t.assignedVolunteer?.toString() === volunteerId?.toString(),
      userPhone: t.userPhone || t.userId?.phone
    }));

    // 3. Format Food Reports (Simple list for claiming or review)
    const formattedFood = allFood.map(f => ({
      ...f,
      isFood: true,
      isWaste: false,
      isPollution: false,
      status: f.status || "Available",
      isMine: String(f.claimedBy) === String(volunteerId),
      userPhone: f.userId?.phone
    }));

    // 4. Format Pollution Reports
    const formattedPollution = allPollution.map(p => ({
      ...p,
      isFood: false,
      isWaste: false,
      isPollution: true,
      status: p.status || "Verified",
      isMine: p.assignedVolunteer?.toString() === volunteerId?.toString(),
      userPhone: p.user?.phone
    }));

    // 5. Combine and Sort by Date
    const combined = [...formattedWaste, ...formattedFood, ...formattedPollution].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    // 6. Final Polish: Attach Review Data
    const finalized = await Promise.all(combined.map(async (t) => {
      const review = await Review.findOne({ requestId: t._id });
      return { ...t, review };
    }));

    res.status(200).json(finalized);

  } catch (error) {
    console.error("Fetch Tasks Error:", error);
    res.status(500).json({ message: "Server error fetching tasks" });
  }
}

export async function confirmArrival(req, res) {
  try {
    const { id } = req.params;
    const volunteerId = req.userID;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid Mission ID" });
    }

    // ATOMIC LOCK: Only update if no one else has claimed it
    const updated = await Pickup.findOneAndUpdate(
      {
        _id: id,
        $or: [
          { assignedVolunteer: { $exists: false } },
          { assignedVolunteer: null },
          { assignedVolunteer: volunteerId }
        ]
      },
      {
        $set: {
          status: "Arrived",
          assignedVolunteer: volunteerId,
          claimedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (!updated) {
      return res.status(409).json({
        message: "This mission has already been claimed by another volunteer."
      });
    }

    // Notification Logic
    if (updated.userId) {
      await Notification.create({
        recipient: updated.userId,
        sender: volunteerId,
        type: 'VOLUNTEER_ARRIVED',
        message: "🚚 Your volunteer has arrived! Please complete the payment to proceed.",
        relatedId: updated._id,
        onModel: 'Pickup'
      });
    }

    res.status(200).json({ success: true, message: "Arrival Confirmed!", task: updated });

  } catch (error) {
    res.status(500).json({ message: "Internal Server Error" });
  }
}

export async function volunteerClaimFood(req, res) {
  try {
    const { id } = req.params;
    const volunteerId = req.userID;

    // 1. Fetch Volunteer info (to fix the "No Phone Info" issue in Admin)
    const volunteer = await User.findById(volunteerId);
    if (!volunteer) {
      return res.status(404).json({ message: "Volunteer profile not found" });
    }

    // 2. Atomic update with Expiry Check
    const food = await LeftoverFoodReport.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ["Available", "available"] },
        // 🔥 NEW: Prevent claiming food that has already passed its expiry time
        expiryTime: { $gt: new Date() }
      },
      {
        $set: {
          status: "Claimed",
          assignedVolunteer: volunteerId, // For volunteer portal / admin dashboard
          claimedBy: volunteerId,         // Used by completeFoodDonation & unclaim
          volunteerName: volunteer.name,   // For Admin Dashboard
          volunteerPhone: volunteer.phone, // For Admin Dashboard
          claimedAt: new Date()
        }
      },
      { returnDocument: "after" } // Replaced deprecated new: true
    );

    // 3. Handle failure cases (Expired or Already Claimed)
    if (!food) {
      const checkStatus = await LeftoverFoodReport.findById(id);
      let errorMsg = "Food not available or already claimed";

      if (checkStatus && new Date(checkStatus.expiryTime) <= new Date()) {
        errorMsg = "❌ Mission failed: This food has already expired.";
      }

      return res.status(400).json({ message: errorMsg });
    }

    // 4. Notify the Donor
    try {
      await Notification.create({
        recipient: food.userId,
        sender: volunteerId,
        type: "FOOD_CLAIMED",
        message: `🍲 Great news! ${volunteer.name} has claimed your food donation and is on the way!`,
        relatedId: food._id,
        onModel: 'LeftoverFoodReport',
        link: "/dashboard"
      });
    } catch (notifErr) {
      console.warn("Notification failed, but claim succeeded:", notifErr);
    }

    res.status(200).json({
      success: true,
      message: "Mission Secured! Check your active tasks.",
      food // Returning the updated object for the frontend
    });

  } catch (error) {
    console.error("Claim Food Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

export async function markFoodCollected(req, res) {
  try {
    const { id } = req.params;
    const volunteerId = req.userID;

    const food = await LeftoverFoodReport.findOneAndUpdate(
      { _id: id, claimedBy: volunteerId, status: "Claimed" },
      { $set: { status: "Collected" } },
      { returnDocument: 'after' }
    );

    if (!food) {
      return res.status(403).json({ message: "Action Denied: Not your mission or already collected." });
    }

    // Updated Notification: Requesting Donor confirmation
    await Notification.create({
      recipient: food.userId,
      sender: volunteerId,
      type: 'SYSTEM',
      message: `🍲 Volunteer has marked your food as collected! Please confirm the collection on your dashboard.`,
      relatedId: food._id,
      onModel: 'LeftoverFoodReport',
      link: '/dashboard'
    }).catch(err => console.log(err));

    res.status(200).json({ success: true, message: "Marked as Collected. Waiting for Donor confirmation." });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
}

export async function confirmFoodCollection(req, res) {
  try {
    const { id } = req.params;
    const userId = req.userID; // Donor ID

    const food = await LeftoverFoodReport.findOneAndUpdate(
      { _id: id, userId: userId, status: "Collected" },
      { $set: { donorConfirmedCollection: true } },
      { returnDocument: 'after' }
    );

    if (!food) {
      return res.status(404).json({ message: "Report not found or not in collected state." });
    }

    // Notify Volunteer
    await Notification.create({
      recipient: food.assignedVolunteer,
      sender: userId,
      type: 'SYSTEM',
      message: `✅ Donor has confirmed the collection of food at ${food.placeName}. You can now proceed to delivery!`,
      relatedId: food._id,
      onModel: 'LeftoverFoodReport',
      link: '/volunteer-portal'
    }).catch(err => console.log(err));

    res.status(200).json({ success: true, message: "Collection Confirmed!" });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
}

export async function markFoodDelivered(req, res) {
  try {
    const { id } = req.params;
    const { deliveryPhoto } = req.body; // 🔥 Received from Frontend after upload
    const volunteerId = req.userID;

    if (!deliveryPhoto) {
      return res.status(400).json({ message: "Proof of delivery photo is required!" });
    }

    const foodCheck = await LeftoverFoodReport.findById(id);
    if (foodCheck && !foodCheck.donorConfirmedCollection) {
      return res.status(403).json({ message: "Action Denied: Donor has not yet confirmed the collection." });
    }

    const food = await LeftoverFoodReport.findOneAndUpdate(
      {
        _id: id,
        assignedVolunteer: volunteerId,
        status: "Collected" // Ensure it's in Collected state
      },
      {
        $set: {
          status: "Delivered",
          deliveryPhoto, // 🔥 Store the proof
          deliveredAt: new Date(),
          completedAt: new Date() // Sync with completeFoodDonation if any
        }
      },
      { returnDocument: "after" } // Replaced deprecated new: true
    );

    if (!food) {
      return res.status(400).json({ message: "Mission not found or already completed." });
    }

    // Notify Donor
    await Notification.create({
      recipient: food.userId,
      sender: volunteerId,
      type: "FOOD_DELIVERED",
      message: `❤️ Success! Your donation has been delivered. View the delivery proof in your history!`,
      relatedId: food._id,
      onModel: 'LeftoverFoodReport'
    });

    res.status(200).json({ success: true, message: "Impact recorded with proof!", food });

  } catch (error) {
    console.error("Delivery Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

export async function getNotifications(req, res) {
  try {
    // 1. Fetch the last 20-30 notifications (Enough to ensure the 'length' increases)
    // 2. We use req.userID directly (ensure your auth middleware sets this)
    const notifications = await Notification.find({
      recipient: req.userID
    })
      .sort({ createdAt: -1 })
      .limit(20); // Increased limit to ensure length-based live sync works

    res.status(200).json(notifications);
  } catch (error) {
    console.error("Notification Fetch Error:", error);
    res.status(500).json({ message: "Error fetching notifications" });
  }
}

export async function markNotificationAsRead(req, res) {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Error" });
  }
}

// ==========================================
// 4. PAYU PAYMENT (FIXED SURL/FURL)
// ==========================================




export async function createPayUOrder(req, res) {
  try {
    const { pickupId, amount } = req.body;

    // Ensure volunteer has arrived
    const pickup = await Pickup.findById(pickupId);
    if (!pickup || pickup.status !== "Arrived") {
      return res.status(400).json({ message: "Payment is only available once the volunteer arrives." });
    }

    // Generate a unique 17-character txnid (max 25 allowed)
    const txnid = `TXN_${Date.now()}`;

    // Store this transaction ID in the pickup document to find it on callback
    await Pickup.findByIdAndUpdate(pickupId, { $set: { paymentId: txnid } });

    const productinfo = "Waste_Pickup_Fee";
    const firstname = req.user.name.split(" ")[0];
    const email = req.user.email || "test@example.com";

    const hashString = `${process.env.PAYU_KEY}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||||||${process.env.PAYU_SALT}`;
    const hash = crypto.createHash("sha512").update(hashString).digest("hex");

    res.status(200).json({
      key: process.env.PAYU_KEY,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      phone: req.user.phone,
      hash,
      surl: `${process.env.SERVER_URL}/api/payment/payu-success`,
      furl: `${process.env.SERVER_URL}/api/payment/payu-failure`,
      action: "https://test.payu.in/_payment" // Test environment endpoint
    });
  } catch (error) {
    console.error("Payment init error:", error);
    res.status(500).json({ message: "Payment initialization failed" });
  }
}

// ----------------------------
// HANDLE PAYU SUCCESS
// ----------------------------
export async function handlePayUSuccess(req, res) {
  try {
    const { txnid, status, amount } = req.body;

    const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/$/, "");

    if (!txnid || status !== "success") {
      return res.redirect(`${frontendUrl}/dashboard?error=payment_failed`);
    }

    // Find pickup by txnid instead of parsing
    const updatedPickup = await Pickup.findOneAndUpdate(
      { paymentId: txnid },
      {
        $set: {
          status: "Paid",
          isPaid: true,
          paidAmount: amount,
          paidAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (!updatedPickup) {
      return res.redirect(`${frontendUrl}/dashboard?error=invalid_id`);
    }

    // Notify volunteer
    if (updatedPickup?.assignedVolunteer) {
      await Notification.create({
        recipient: updatedPickup.assignedVolunteer,
        type: "PAYMENT_RECEIVED",
        message: "💰 Payment received! You can now complete the collection.",
        link: "/volunteer-portal",
        relatedId: updatedPickup._id,
        onModel: 'Pickup'
      }).catch(err => console.error("Volunteer notification failed:", err));
    }

    // Notify user
    if (updatedPickup?.userId) {
      await Notification.create({
        recipient: updatedPickup.userId,
        type: "PAYMENT_SUCCESS",
        message: "💳 Payment Successful! Your volunteer has been notified.",
        link: "/dashboard",
        relatedId: updatedPickup._id,
        onModel: 'Pickup'
      }).catch(err => console.error("User notification failed:", err));
    }

    return res.redirect(`${frontendUrl}/payment-success?txnid=${txnid}`);

  } catch (error) {
    console.error("Critical payment success error:", error);
    const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
    return res.redirect(`${frontendUrl}/dashboard?error=server_error`);
  }
}

// ----------------------------
// HANDLE PAYU FAILURE
// ----------------------------
export async function handlePayUFailure(req, res) {
  try {
    const { txnid, field9 } = req.body;

    console.warn(`Payment failed for TXN: ${txnid}`);

    if (txnid) {
      await Pickup.findOneAndUpdate(
        { paymentId: txnid },
        { $set: { status: "Arrived", paymentId: null } }
      );
    }

    const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
    const errorMessage = field9 || "payment_cancelled";
    res.redirect(`${frontendUrl}/payment-failure?error=${errorMessage}`);

  } catch (error) {
    console.error("Payment failure handler error:", error);
    const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
    res.redirect(`${frontendUrl}/payment-failure?error=server_error`);
  }
}
// ==========================================
// 5. ADMIN OPERATIONS & REVENUE
// ==========================================

export async function getRevenue(req, res) {
  try {
    const { month, year } = req.query;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const result = await Pickup.aggregate([
      { $match: { status: "Completed", isPaid: true, createdAt: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: null, total: { $sum: 50 } } }
    ]);
    res.status(200).json({ totalRevenue: result[0]?.total || 0 });
  } catch (error) {
    res.status(500).json({ totalRevenue: 0 });
  }
}

export async function getGlobalStats(req, res) {
  try {
    const [u, p, po, f] = await Promise.all([
      userSchema.countDocuments(),
      Pickup.countDocuments(),
      Pollution.countDocuments(),
      LeftoverFoodReport.countDocuments()
    ]);
    res.status(200).json({ totalUsers: u, totalPickups: p, totalPollution: po, totalFood: f });
  } catch (error) {
    res.status(500).json({ message: "Error" });
  }
}

export async function getDeletionLogs(req, res) {
  try {
    const logs = await DeletionLog.find().sort("-deletedAt");
    res.status(200).json(logs);
  } catch (error) {
    res.status(500).json({ message: "Error fetching deletion logs" });
  }
}




export async function getAllReports(req, res) {
  try {
    const [pickups, pollution, food] = await Promise.all([
      // 1. We MUST populate 'assignedVolunteer' to get the Name and Phone
      Pickup.find()
        .populate("assignedVolunteer", "name phone")
        .sort({ createdAt: -1 })
        .lean(),

      Pollution.find()
        .populate("user", "name phone")
        .populate("assignedVolunteer", "name phone")
        .sort({ createdAt: -1 })
        .lean(),

      LeftoverFoodReport.find()
        .populate("userId", "name phone")
        .populate("assignedVolunteer", "name phone")
        .populate("claimedBy", "name phone")
        .sort({ createdAt: -1 })
        .lean()
    ]);

    // 2. Fetch all reviews to join with missions
    const reviews = await Review.find().populate("reviewerId", "name role").lean();
    const reviewsMap = reviews.reduce((acc, rev) => {
      const rid = rev.requestId.toString();
      if (!acc[rid]) acc[rid] = [];
      acc[rid].push(rev);
      return acc;
    }, {});

    const all = [
      ...pickups.map(p => ({
        ...p,
        type: 'pickup',
        displayName: p.userName,
        volunteerName: p.assignedVolunteer?.name || null,
        volunteerPhone: p.assignedVolunteer?.phone || null,
        reviews: reviewsMap[p._id.toString()] || []
      })),
      ...pollution.map(p => ({
        ...p,
        type: 'pollution',
        displayName: p.user?.name || "Public User",
        userPhone: p.user?.phone || null,
        volunteerName: p.assignedVolunteer?.name || null,
        volunteerPhone: p.assignedVolunteer?.phone || null,
        reviews: reviewsMap[p._id.toString()] || []
      })),
      ...food.map(f => ({
        ...f,
        type: 'food',
        displayName: f.userId?.name || f.volunteerName || "Donor",
        userPhone: f.userId?.phone || f.volunteerPhone || null,
        volunteerName: f.assignedVolunteer?.name || f.claimedBy?.name || f.volunteerName || null,
        volunteerPhone: f.assignedVolunteer?.phone || f.claimedBy?.phone || f.volunteerPhone || null,
        reviews: reviewsMap[f._id.toString()] || []
      }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json(all);
  } catch (error) {
    res.status(500).json({ message: "Error" });
  }
}

export async function promoteToVolunteer(req, res) {
  try {
    // 1. Assign the next unique Agent ID (volunteer_e101, etc.)
    const existingVolunteers = await userSchema.find({ name: /^volunteer_e/ });
    let nextId = 101;
    if (existingVolunteers.length > 0) {
      const ids = existingVolunteers.map(v => {
        const match = v.name.match(/e(\d+)/);
        return match ? parseInt(match[1]) : 100;
      });
      nextId = Math.max(...ids) + 1;
    }
    const agentName = `volunteer_e${nextId}`;

    // 2. Promote and rename simultaneously
    const user = await userSchema.findOneAndUpdate(
      { phone: req.body.phone },
      {
        role: "volunteer",
        name: agentName
      },
      { returnDocument: 'after' }
    );


    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({
      message: `Promoted successfully! Identity assigned: ${agentName}`,
      user
    });
  } catch (error) {
    res.status(500).json({ message: "Error promoting user" });
  }
}


// ==========================================
// 6. USER DASHBOARD & ACTIVITY
// ==========================================

export async function getDashboardStats(req, res) {
  try {
    const [p, po, f] = await Promise.all([
      Pickup.countDocuments({ userId: req.userID }),
      Pollution.countDocuments({ user: req.userID }),
      LeftoverFoodReport.countDocuments({ userId: req.userID })
    ]);
    res.status(200).json({ totalImpact: p + po + f, breakdown: { pickups: p, pollution: po, food: f } });
  } catch (error) {
    res.status(500).json({ message: "Error" });
  }
}

export async function getUserActivity(req, res) {
  try {
    const [p, po, f] = await Promise.all([
      Pickup.find({ userId: req.userID }).lean(),
      Pollution.find({ user: req.userID }).lean(),
      LeftoverFoodReport.find({ userId: req.userID }).lean()
    ]);
    const activity = [
      ...p.map(x => ({ ...x, activityType: 'Pickup', date: x.createdAt, txnId: x.paymentId })),
      ...po.map(x => ({ ...x, activityType: 'Pollution', date: x.createdAt })),
      ...f.map(x => ({ ...x, activityType: 'Food', date: x.createdAt }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    res.status(200).json(activity);
  } catch (error) {
    res.status(500).json({ message: "Error" });
  }
}

// ==========================================
// 7. REMAINING ROUTE EXPORTS
// ==========================================

export async function chekPhone(req, res) {
  const formattedPhone = req.query.phone.startsWith("+91") ? req.query.phone : `+91${req.query.phone}`;
  const user = await userSchema.findOne({ phone: formattedPhone });
  res.status(200).json({ exists: !!user });
}

export async function getUserPickups(req, res) {
  const pickups = await Pickup.find({ userId: req.userID }).sort("-createdAt").lean();
  const reviews = await Review.find({ reviewerId: req.userID, requestType: "pickup" }).lean();
  const reviewsMap = reviews.reduce((acc, rev) => {
    acc[rev.requestId.toString()] = rev;
    return acc;
  }, {});

  const results = pickups.map(p => ({
    ...p,
    txnId: p.paymentId, // 👈 Ensures the frontend has the correct key for receipt generation
    review: reviewsMap[p._id.toString()] || null
  }));
  res.json(results);
}

export async function getUserPollution(req, res) {
  const pollution = await Pollution.find({ user: req.userID }).sort("-createdAt").lean();
  const reviews = await Review.find({ reviewerId: req.userID, requestType: "pollution" }).lean();
  const reviewsMap = reviews.reduce((acc, rev) => {
    acc[rev.requestId.toString()] = rev;
    return acc;
  }, {});

  const results = pollution.map(p => ({
    ...p,
    review: reviewsMap[p._id.toString()] || null
  }));
  res.json(results);
}

export async function getUserFood(req, res) {
  const food = await LeftoverFoodReport.find({ userId: req.userID }).sort("-createdAt").lean();
  const reviews = await Review.find({ reviewerId: req.userID, requestType: "food" }).lean();
  const reviewsMap = reviews.reduce((acc, rev) => {
    acc[rev.requestId.toString()] = rev;
    return acc;
  }, {});

  const results = food.map(f => ({
    ...f,
    review: reviewsMap[f._id.toString()] || null
  }));
  res.json(results);
}

export async function getAllUsers(req, res) {
  try {
    const users = await userSchema.find().select("-password").lean();

    // Fetch active tasks for all volunteers to determine if they are busy
    const usersWithStatus = await Promise.all(users.map(async (u) => {
      if (u.role === 'volunteer') {
        const [activePickups, activeFood, activePollution] = await Promise.all([
          Pickup.exists({
            assignedVolunteer: u._id,
            status: { $nin: ["Completed", "completed"] }
          }),
          LeftoverFoodReport.exists({
            claimedBy: u._id,
            status: { $nin: ["Delivered", "delivered"] }
          }),
          Pollution.exists({
            assignedVolunteer: u._id,
            status: { $nin: ["Resolved", "resolved"] }
          })
        ]);

        return {
          ...u,
          isBusy: !!(activePickups || activeFood || activePollution)
        };
      }
      return u;
    }));

    res.json(usersWithStatus);
  } catch (error) {
    console.error("Error in getAllUsers:", error);
    res.status(500).json({ message: "Error fetching users" });
  }
}

export async function updateProfile(req, res) {
  try {
    const { name } = req.body;
    const user = await userSchema.findById(req.userID);

    // Safeguard: Volunteers cannot change names to keep identity distinct
    if (user.role === "volunteer" && name && name !== user.name) {
      return res.status(403).json({ message: "Name change restricted for volunteer accounts." });
    }

    const updatedUser = await userSchema.findByIdAndUpdate(
      req.userID,
      { name: name || user.name },
      { returnDocument: 'after' }
    );
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: "Error updating profile" });
  }
}

export async function changePassword(req, res) {
  const user = await userSchema.findById(req.userID);
  user.password = await bcrypt.hash(req.body.newPassword, 10);
  await user.save();
  res.json({ message: "Success" });
}

// --- 📱 PHONE UPDATE SYSTEM (FIREBASE BACKED) ---

// 1. Check if number is available before frontend starts Firebase process
export async function checkPhoneAvailability(req, res) {
  try {
    const { phone } = req.query;
    const formattedPhone = phone.startsWith("+91") ? phone : `+91${phone}`;
    const exists = await userSchema.findOne({ phone: formattedPhone });
    res.status(200).json({ exists: !!exists });
  } catch (error) {
    res.status(500).json({ message: "Error checking phone status" });
  }
}

export async function updatePhoneDirect(req, res) {
  try {
    const { newPhone } = req.body;
    const formattedPhone = newPhone.startsWith("+91") ? newPhone : `+91${newPhone}`;

    // Verify again on backend that it's not taken
    const exists = await userSchema.findOne({ phone: formattedPhone });
    if (exists && exists._id.toString() !== req.userID) {
      return res.status(409).json({ message: "This phone number is already in use by another account." });
    }

    const user = await userSchema.findById(req.userID);
    user.phone = formattedPhone;
    await user.save();

    res.status(200).json({ success: true, message: "Phone number updated successfully!", phone: formattedPhone });
  } catch (error) {
    res.status(500).json({ message: "Phone update failed" });
  }
}

// --- 🗑️ ACCOUNT DELETION SYSTEM (FIREBASE BACKED) ---

export async function deleteAccountDirect(req, res) {
  try {
    const { reason } = req.body;
    const user = await userSchema.findById(req.userID);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ message: "Please provide a valid reason for deletion." });
    }

    // --- 🔥 FIREBASE DELETION (Secondary Safeguard) ---
    // The frontend already deletes auth.currentUser after OTP confirmation.
    // This backend step is a fallback using the Firebase Admin SDK.
    try {
      const firebaseUser = await admin.auth().getUserByPhoneNumber(user.phone);
      await admin.auth().deleteUser(firebaseUser.uid);
      console.log(`[Firebase Admin] Deleted Firebase user UID: ${firebaseUser.uid} (phone: ${user.phone})`);
    } catch (firebaseError) {
      if (firebaseError.code === 'auth/user-not-found') {
        // Expected if the frontend already deleted the Firebase user — not an error
        console.log(`[Firebase Admin] User ${user.phone} not found in Firebase (likely deleted by client). Proceeding.`);
      } else {
        // Log other Firebase errors but do NOT block MongoDB deletion
        console.error(`[Firebase Admin] Deletion failed for ${user.phone}:`, firebaseError.code, firebaseError.message);
      }
    }

    // 1. Log the deletion for Admin Analytics
    await DeletionLog.create({
      userId: user._id,
      userName: user.name,
      userPhone: user.phone,
      userRole: user.role,
      reason: reason
    });

    // 2. Execute Deletion from MongoDB
    await userSchema.findByIdAndDelete(req.userID);

    res.status(200).json({ success: true, message: "Account deleted successfully from both systems." });
  } catch (error) {
    console.error("Deletion Error:", error);
    res.status(500).json({ message: "Account deletion failed" });
  }
}


// 🗑️ ACCOUNT DELETION (Simplified for Firebase)
// (Function was removed here to be cleaner)




export async function deleteReport(req, res) {
  const { type, id } = req.params;
  if (type === 'pickup') await Pickup.findByIdAndDelete(id);
  else if (type === 'pollution') await Pollution.findByIdAndDelete(id);
  else if (type === 'food') await LeftoverFoodReport.findByIdAndDelete(id);
  res.json({ message: "Deleted" });
}

export async function toggleUserFreeze(req, res) {
  try {
    const { id } = req.params;
    const user = await userSchema.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Protect SuperAdmin
    if (user.phone === "+918888855555") {
      return res.status(403).json({ message: "Super Admin account cannot be frozen." });
    }

    user.isFrozen = !user.isFrozen;
    await user.save();

    res.status(200).json({
      success: true,
      message: `Account ${user.isFrozen ? 'Frozen' : 'Unfrozen'} successfully`,
      isFrozen: user.isFrozen
    });
  } catch (error) {
    res.status(500).json({ message: "Action failed" });
  }
}

export async function flagReport(req, res) {

  try {
    const { type, id } = req.params;
    const { reason } = req.body;

    let report;
    if (type === 'pickup') report = await Pickup.findById(id);
    else if (type === 'pollution') report = await Pollution.findById(id);
    else if (type === 'food') report = await LeftoverFoodReport.findById(id);

    if (!report) return res.status(404).json({ message: "Report not found" });

    report.isFlagged = true;
    report.flagReason = reason || "Suspicious Activity Reported by Agent";
    await report.save();

    res.status(200).json({ success: true, message: "Report flagged for Admin review." });
  } catch (error) {
    res.status(500).json({ message: "Flagging failed" });
  }
}



export async function updateFoodReport(req, res) {
  const f = await LeftoverFoodReport.findByIdAndUpdate(
    req.params.id,
    req.body,
    { returnDocument: 'after' } // ✅ Fixed
  );
  res.json(f);
}

export async function updateUserRole(req, res) {
  try {
    const { userId } = req.params;
    const { newRole } = req.body;
    const lowerRole = (newRole || "user").toLowerCase();

    const updateData = { role: lowerRole };

    // 🕵️ If promoting to volunteer, assign the next unique Agent ID
    if (newRole === "volunteer") {
      const existingVolunteers = await userSchema.find({ name: /^volunteer_e/ });
      let nextId = 101;

      if (existingVolunteers.length > 0) {
        const ids = existingVolunteers.map(v => {
          const match = v.name.match(/e(\d+)/);
          return match ? parseInt(match[1]) : 100;
        });
        nextId = Math.max(...ids) + 1;
      }

      updateData.name = `volunteer_e${nextId}`;
    }


    const u = await userSchema.findByIdAndUpdate(
      userId,
      updateData,
      { returnDocument: 'after' }
    );

    if (!u) return res.status(404).json({ message: "User not found" });

    res.json(u);
  } catch (err) {
    res.status(500).json({ message: "Error updating account role" });
  }
}


export async function getPublicFoodFeed(req, res) {
  const f = await LeftoverFoodReport.find({ status: "Available" }).populate("userId", "name").sort("-createdAt");
  res.json(f);
}

export async function updatePollutionStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // 1. ✅ SYNCED STATUSES: Match your new Schema Enum
    const validStatuses = ["Reported", "Verified", "Claimed", "Arrived", "Resolved"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Choose: ${validStatuses.join(", ")}`
      });
    }

    // 2. Update the Report
    const report = await Pollution.findByIdAndUpdate(
      id,
      { status: status },
      { returnDocument: 'after', runValidators: true }
    ).populate("user", "name phone");

    if (!report) {
      return res.status(404).json({ message: "Pollution report not found" });
    }

    // 3. 🔔 Notify the Original Reporter
    if (report.user) {
      await Notification.create({
        recipient: report.user,
        type: 'POLLUTION_ALERT',
        message: `🚨 Your report for ${report.pollutionType} is now: ${status}`,
        link: '/dashboard'
      }).catch(err => console.warn("User notification failed", err));
    }

    // 4. 📢 BROADCAST TO MISSION BOARD (The "Appear" Logic)
    // When Admin clicks 'Verify', it appears on all Volunteer Portals
    if (status === "Verified") {
      const volunteers = await userSchema.find({ role: "volunteer" });

      if (volunteers.length > 0) {
        const volunteerNotifications = volunteers.map(v => ({
          recipient: v._id,
          type: 'SYSTEM',
          message: `🛠️ New cleanup mission: ${report.pollutionType} is ready for claim!`,
          link: '/volunteer-portal'
        }));

        await Notification.insertMany(volunteerNotifications).catch(e => console.error(e));
      }
    }

    res.status(200).json(report);

  } catch (error) {
    console.error("Error in updatePollutionStatus:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

// Inside requestHandler.js
// Unified and Secure Completion Function
export async function completeCollection(req, res) {
  try {
    const { id } = req.params;
    const volunteerId = req.userID; // From Auth Middleware

    // 🔒 THE SECURITY LOCK: 
    // 1. Matches the Task ID
    // 2. Ensures ONLY the volunteer assigned to this task can finish it
    // 3. Ensures status is 'Paid' (User must pay before volunteer can 'Complete')
    const { weight } = req.body;

    const completed = await Pickup.findOneAndUpdate(
      {
        _id: id,
        assignedVolunteer: volunteerId,
        status: "Paid"
      },
      {
        $set: { 
          status: "Completed",
          weight: weight || 0
        }
      },
      { returnDocument: 'after' } // Fixes the Mongoose warning
    );

    // If 'completed' is null, the task wasn't paid or you aren't the assigned volunteer
    if (!completed) {
      return res.status(403).json({
        message: "Action Denied: Either payment is pending or you are not assigned to this mission."
      });
    }

    // 🔔 Notify User that the job is finished
    try {
      await Notification.create({
        recipient: completed.userId,
        sender: volunteerId,
        type: "PICKUP_FINISHED",
        message: "✅ Pickup completed! Your waste has been successfully collected.",
        link: "/dashboard",
        relatedId: completed._id,
        onModel: 'Pickup'
      });
    } catch (notifErr) {
      console.error("Non-critical notification failure:", notifErr);
    }

    res.status(200).json({
      success: true,
      message: "Mission Accomplished!",
      task: completed
    });

  } catch (error) {
    console.error("Completion Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
}

export async function completePickup(req, res) {
  try {

    const { id } = req.params;
    const completed = await Pickup.findByIdAndUpdate(
      id,
      { status: "Completed" },
      { returnDocument: 'after' } // ✅ Fixed
    );

    // Notify the User that their waste is gone!
    await Notification.create({
      recipient: completed.userId,
      type: "PICKUP_COMPLETE",
      message: "🚚 Pickup completed successfully! Thank you for keeping the city clean.",
      link: "/dashboard"
    });

    res.status(200).json({ success: true, message: "Mission Finished!" });
  } catch (error) {
    res.status(500).json({ message: "Failed to complete mission" });
  }
}


// ==========================================
// 8. ADMIN DEEP ANALYSIS
// ==========================================

export async function getSingleReport(req, res) {
  try {
    const { type, id } = req.params;
    let report;

    // Use the Models you already imported at the top
    switch (type) {
      case 'pickup':
        // Populating the user who requested the pickup
        report = await Pickup.findById(id).populate("userId", "name phone email");
        break;
      case 'pollution':
        // Populating the user who reported the pollution
        report = await Pollution.findById(id).populate("user", "name phone email");
        break;
      case 'food':
        // Populating the donor
        report = await LeftoverFoodReport.findById(id).populate("userId", "name phone email");
        break;
      default:
        return res.status(400).json({ message: "Invalid report type" });
    }

    if (!report) {
      return res.status(404).json({ message: "Record not found in database" });
    }

    res.status(200).json(report);
  } catch (error) {
    console.error("Analysis Fetch Error:", error);
    res.status(500).json({ message: "Server error during deep-scan", error: error.message });
  }
}

export async function claimMission(req, res) {
  try {
    const { id } = req.params;
    const volunteerId = req.userID || req.user?.id;

    const busyCheck = await Pickup.findOne({
      assignedVolunteer: volunteerId,
      status: { $in: ["claimed", "arrived", "paid"] }
    });

    if (busyCheck) {
      return res.status(403).json({
        success: false,
        message: "Operation Denied: You already have an active mission."
      });
    }

    const updatedTask = await Pickup.findOneAndUpdate(
      {
        _id: id,
        $or: [
          { assignedVolunteer: { $exists: false } },
          { assignedVolunteer: null }
        ],
        status: { $regex: /^pending$/i }
      },
      {
        $set: {
          assignedVolunteer: volunteerId,
          status: "claimed",
          claimedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (!updatedTask) {
      return res.status(409).json({ message: "This mission was just taken!" });
    }
    res.status(200).json({ success: true, task: updatedTask });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
}

export async function unclaimMission(req, res) {
  try {
    const { id } = req.params;
    const { type } = req.body;
    const volunteerId = req.userID;

    let Model;
    let resetStatus;
    let updateData = { $set: { claimedAt: null } };

    // 1. Determine Model and target fields
    if (type === 'food') {
      Model = LeftoverFoodReport;
      resetStatus = "Available";
      updateData.$set.claimedBy = null;         // Food uses claimedBy
      updateData.$set.assignedVolunteer = null;  // Keep both in sync
    } else {
      Model = Pickup;
      resetStatus = "Pending";
      updateData.$set.assignedVolunteer = null; // Pickup uses assignedVolunteer
    }

    // 2. Execute update ONLY if this volunteer owns the task
    const task = await Model.findOneAndUpdate(
      {
        _id: id,
        $or: [{ assignedVolunteer: volunteerId }, { claimedBy: volunteerId }]
      },
      { ...updateData, $set: { ...updateData.$set, status: resetStatus } },
      { returnDocument: 'after' }
    );

    if (!task) return res.status(404).json({ message: "Mission not found or not assigned to you." });

    res.status(200).json({ success: true, message: "Mission abandoned." });
  } catch (error) {
    res.status(500).json({ message: "Server error during abandon." });
  }
}

export async function adminResetMission(req, res) {
  try {
    const { id } = req.params;
    const { type } = req.body;

    let Model;
    let resetStatus;

    // 1. Map type to correct Model
    switch (type?.toLowerCase()) {
      case 'pollution':
        Model = Pollution;
        resetStatus = "Reported";
        break;
      case 'food':
        Model = LeftoverFoodReport;
        resetStatus = "Available";
        break;
      case 'pickup':
      default:
        Model = Pickup;
        resetStatus = "Pending";
        break;
    }

    // 2. Execute the Atomic Reset
    const updatedTask = await Model.findByIdAndUpdate(
      id,
      {
        $set: {
          status: resetStatus,
          assignedVolunteer: null, // Used by Pickup/Pollution
          claimedBy: null,        // Used by Food
          claimedAt: null
        }
      },
      { returnDocument: 'after' }
    );

    if (!updatedTask) {
      return res.status(404).json({ success: false, message: "Mission ID not found in " + type });
    }

    res.status(200).json({ success: true, message: "Mission returned to board" });

  } catch (error) {
    console.error("CRITICAL RESET ERROR:", error);
    res.status(500).json({ success: false, message: "Internal Server Error during reset" });
  }
}


// 2. Volunteer Completes Cleanup (Uploads Resolved Photos)
export async function resolvePollutionReport(req, res) {
  try {
    const { id } = req.params;
    const volunteerId = req.userID;
    const resolvedPhotos = req.files ? req.files.map(file => file.filename) : [];

    // 1. 🎯 UPDATE THE MISSION STATUS
    const report = await Pollution.findOneAndUpdate(
      { _id: id, assignedVolunteer: volunteerId },
      {
        $set: {
          status: "Resolved",
          resolvedPhotos: resolvedPhotos
        }
      },
      { returnDocument: 'after' }
    );

    if (!report) {
      return res.status(403).json({ message: "Action Denied: Unauthorized or report not found." });
    }

    // 2. 🔥 PERMANENT IMPACT UPDATE (The Statistics Fix)
    // This ensures your "Total Resolved" counter updates in the DB
    try {
      await User.findByIdAndUpdate(volunteerId, {
        $inc: { resolvedTasks: 1 }
      });
    } catch (statsErr) {
      console.error("Non-critical: Failed to increment volunteer impact stats:", statsErr);
    }

    // 3. 🔔 NOTIFY THE REPORTER
    await Notification.create({
      recipient: report.user,
      sender: volunteerId,
      type: 'POLLUTION_ALERT',
      message: `🌳 Great news! The pollution spot you reported (${report.pollutionType}) has been resolved!`,
      link: '/dashboard',
      relatedId: report._id,
      onModel: 'Pollution'
    }).catch(err => console.error("Notification failed", err));

    res.status(200).json({
      success: true,
      message: "Mission Accomplished! Environmental impact recorded.",
      report
    });

  } catch (error) {
    console.error("Resolve Error:", error);
    res.status(500).json({ message: "Error resolving report" });
  }
}
// 1. Claim a Pollution Mission
export const claimPollutionMission = async (req, res) => {
  try {
    const { id } = req.params;
    const volunteerId = req.userID;

    if (!volunteerId) {
      return res.status(401).json({ message: "Unauthorized: Volunteer ID missing" });
    }

    // 🔥 NEW: Fetch the volunteer's profile to get their Name and Phone
    const volunteer = await User.findById(volunteerId);
    if (!volunteer) {
      return res.status(404).json({ message: "Volunteer profile not found" });
    }

    // 🔒 THE SECURITY LOCK (Updated to include Name and Phone)
    const mission = await Pollution.findOneAndUpdate(
      {
        _id: id,
        status: "Verified",
        $or: [
          { assignedVolunteer: { $exists: false } },
          { assignedVolunteer: null }
        ]
      },
      {
        $set: {
          assignedVolunteer: volunteerId,
          status: "Claimed"
        }
      },
      { returnDocument: 'after' } // Replaced deprecated new: true
    );

    if (!mission) {
      const check = await Pollution.findById(id);
      return res.status(400).json({
        message: check
          ? `Mission is already ${check.status}`
          : "Mission no longer available"
      });
    }

    // 🔔 Notification Logic (Keep as is)
    try {
      await Notification.create({
        recipient: mission.user,
        sender: volunteerId,
        type: "MISSION_CLAIMED",
        message: `🙌 A volunteer has claimed your pollution report and is starting the cleanup!`,
        relatedId: mission._id,
        onModel: 'Pollution'
      });
    } catch (notifErr) {
      console.warn("Non-critical notification failure:", notifErr);
    }

    res.status(200).json({
      success: true,
      message: "Mission secured! Move to the site.",
      mission
    });

  } catch (error) {
    console.error("CRITICAL ERROR IN CLAIM:", error);
    res.status(500).json({ message: "Server error during claim" });
  }
};
// 2. Unclaim/Abandon a Pollution Mission
export async function unclaimPollutionMission(req, res) {
  try {
    const { id } = req.params;
    const updated = await Pollution.findOneAndUpdate(
      { _id: id, assignedVolunteer: req.userID },
      { $set: { status: "Verified", assignedVolunteer: null, claimedAt: null } },
      { returnDocument: 'after' }
    );
    if (!updated) return res.status(400).json({ message: "Cannot unclaim this mission." });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
}


export async function completeFoodDonation(req, res) {
  try {
    const { id } = req.params;

    const food = await LeftoverFoodReport.findOneAndUpdate(
      { _id: id, claimedBy: req.userID, status: "Claimed" },
      { $set: { status: "Delivered", completedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!food) return res.status(403).json({ message: "Unauthorized or already delivered." });

    // Notify the donor (User) that their food reached people
    await Notification.create({
      recipient: food.userId,
      type: 'SYSTEM',
      message: `❤️ Success! Your food donation from ${food.placeName} has been delivered.`,
      link: '/dashboard'
    });

    res.status(200).json({ success: true, message: "Delivery confirmed!" });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
}

// ==========================================
// 9. USER REPORTING OPERATIONS
// ==========================================

export async function cancelUserReport(req, res) {
  try {
    const { type, id } = req.params;
    const userId = req.userID;

    let Model;
    let query = {};

    switch (type) {
      case 'food':
        Model = LeftoverFoodReport;
        query = { _id: id, userId: userId, status: { $in: ["Available", "available"] } };
        break;
      case 'pollution':
        Model = Pollution;
        query = { _id: id, user: userId, status: { $in: ["Reported", "Verified"] }, assignedVolunteer: null };
        break;
      case 'pickup':
        Model = Pickup;
        query = { _id: id, userId: userId, status: { $in: ["Pending", "pending"] }, assignedVolunteer: null };
        break;
      default:
        return res.status(400).json({ message: "Invalid report type" });
    }

    const deleted = await Model.findOneAndDelete(query);

    if (!deleted) {
      return res.status(403).json({
        message: "Cannot cancel: Report not found, already claimed by volunteer, or you don't have permission."
      });
    }

    res.status(200).json({ success: true, message: "Report cancelled successfully." });
  } catch (error) {
    console.error("Cancel Report Error:", error);
    res.status(500).json({ message: "Server error during cancellation" });
  }
}

export async function flagVolunteer(req, res) {
  try {
    const { type, id } = req.params;
    const { reason } = req.body;
    const userId = req.userID;

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ message: "Please provide a detailed reason (min 5 characters)." });
    }

    let Model;
    let query = {};

    switch (type) {
      case 'food':
        Model = LeftoverFoodReport;
        query = { _id: id, userId: userId, assignedVolunteer: { $ne: null } };
        break;
      case 'pollution':
        Model = Pollution;
        query = { _id: id, user: userId, assignedVolunteer: { $ne: null } };
        break;
      case 'pickup':
        Model = Pickup;
        query = { _id: id, userId: userId, assignedVolunteer: { $ne: null } };
        break;
      default:
        return res.status(400).json({ message: "Invalid report type" });
    }

    const report = await Model.findOneAndUpdate(
      query,
      {
        $set: {
          volFlaggedByCitizen: true,
          volFlagReason: reason
        }
      },
      { returnDocument: 'after' }
    );

    if (!report) {
      return res.status(404).json({ message: "Report not found, no volunteer assigned, or access denied." });
    }

    const admins = await userSchema.find({ role: { $in: ["admin"] } });
    if (admins.length > 0) {
      const notifications = admins.map(admin => ({
        recipient: admin._id,
        sender: userId,
        type: 'SYSTEM',
        message: `🚩 User flagged volunteer on ${type} report: ${reason.substring(0, 30)}...`,
        link: '/admin-dashboard'
      }));
      await Notification.insertMany(notifications);
    }

    res.status(200).json({ success: true, message: "Security protocol transmitted to Command Center." });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
}

// ==========================================
// 10. REVIEW, RATING & LIVE HELP
// ==========================================

export async function submitReview(req, res) {
  try {
    const { requestId, requestType, revieweeId, rating, comment, isReport, reportReason } = req.body;
    const reviewerId = req.userID;

    if (!requestId || !requestType || !revieweeId || (!rating && !isReport)) {
      return res.status(400).json({ message: "Missing required review/report data" });
    }

    // 0. Security Guard: Prevent Double Reviews from the SAME person
    const existing = await Review.findOne({ requestId, reviewerId });
    if (existing) {
      return res.status(409).json({ message: "You have already logged a review for this mission." });
    }

    // 1. Create Review/Report
    const review = new Review({
      reviewerId,
      revieweeId,
      requestId,
      requestType,
      rating: rating || 0, // 0 if it's only a report
      comment: comment || "",
      isReport: !!isReport,
      reportReason: reportReason || ""
    });
    await review.save();

    // 2. Update Volunteer Stats (if rating is provided)
    if (rating > 0) {
      const volunteer = await User.findById(revieweeId);
      if (volunteer && volunteer.role === 'volunteer') {
        const oldAvg = volunteer.averageRating || 0;
        const oldCount = volunteer.reviewCount || 0;
        const newCount = oldCount + 1;
        const newAvg = (oldAvg * oldCount + rating) / newCount;

        volunteer.averageRating = parseFloat(newAvg.toFixed(1));
        volunteer.reviewCount = newCount;
        await volunteer.save();
      }
    }

    // 3. Notify Reviewee
    await Notification.create({
      recipient: revieweeId,
      type: 'SYSTEM',
      message: isReport
        ? `⚠️ A report has been filed regarding mission #${requestId.slice(-6)}.`
        : `⭐ New completion rating: You received ${rating} stars!`,
      link: '/volunteer-portal'
    });

    res.status(201).json({ success: true, message: isReport ? "Report submitted to HQ" : "Feedback recorded! Thank you." });
  } catch (error) {
    console.error("Submit Review Error:", error);
    res.status(500).json({ message: "Failed to process feedback" });
  }
}

export async function getVolunteerReviews(req, res) {
  try {
    const { volunteerId } = req.params;
    const reviews = await Review.find({ revieweeId: volunteerId, rating: { $gt: 0 } })
      .populate("reviewerId", "name")
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json(reviews);
  } catch (error) {
    res.status(500).json({ message: "Error fetching reviews" });
  }
}

export async function liveHelpRequest(req, res) {
  try {
    const { requestId, requestType, message } = req.body;
    const userId = req.userID;
    const userName = req.user.name;

    if (!message || message.trim().length < 5) {
      return res.status(400).json({ message: "Please provide a brief description of the issue (min 5 characters)." });
    }

    // Update mission status
    let Model;
    if (requestType === 'food') Model = LeftoverFoodReport;
    else if (requestType === 'pollution') Model = Pollution;
    else Model = Pickup;

    // 🛡️ Prevent Double Signals
    const mission = await Model.findById(requestId);
    if (mission?.helpRequested) {
      return res.status(409).json({ message: "A help signal is already active for this mission." });
    }

    await Model.findByIdAndUpdate(requestId, {
      helpRequested: true,
      helpAt: new Date(),
      helpMessage: message
    });

    // Notify all admins
    const admins = await User.find({ role: "admin" });
    if (admins.length > 0) {
      const notifications = admins.map(admin => ({
        recipient: admin._id,
        sender: userId,
        type: 'POLLUTION_ALERT', // Reusing red alert type for visibility
        message: `🆘 URGENT: ${userName} needs Live Help with ${requestType} (#${requestId.slice(-6)}): "${message.substring(0, 50)}..."`,
        link: `/admin-dashboard?requestId=${requestId}`
      }));
      await Notification.insertMany(notifications);
    }

    res.status(200).json({ success: true, message: "Help request transmitted to HQ. Standby." });
  } catch (error) {
    res.status(500).json({ message: "Failed to send help request" });
  }
}

// ==========================================
// 11. ADMIN UNFLAG OPERATION
// ==========================================

export async function unflagReport(req, res) {
  try {
    const { type, id } = req.params;
    const { reviewId } = req.body;

    let Model;
    switch (type) {
      case 'food':
        Model = LeftoverFoodReport;
        break;
      case 'pollution':
        Model = Pollution;
        break;
      case 'pickup':
        Model = Pickup;
        break;
      default:
        return res.status(400).json({ message: "Invalid report type" });
    }

    const targetReport = await Model.findById(id);
    if (!targetReport) return res.status(404).json({ message: "Report not found" });

    // Determine who to notify
    let notifyTarget = null;
    let notifyMsg = "";

    // If this is a review misconduct resolution
    if (reviewId) {
      const review = await Review.findByIdAndUpdate(
        reviewId,
        { $set: { isReport: false } },
        { returnDocument: 'after' }
      );
      if (review) {
        notifyTarget = review.reviewerId;
        notifyMsg = "Your reported misconduct issue has been reviewed and resolved by the Admin team.";
      }
    } else {
      // Legacy flag resolution (on the report model itself)
      if (targetReport.volFlaggedByCitizen) {
        notifyTarget = targetReport.userId || targetReport.user;
        notifyMsg = "Your misconduct report regarding a volunteer has been reviewed and resolved by our security team.";
      } else if (targetReport.isFlagged) {
        notifyTarget = targetReport.assignedVolunteer || targetReport.claimedBy;
        notifyMsg = "Your security flag on a mission has been reviewed and the case is now marked as resolved.";
      }
    }

    // Always clear top-level flags to be safe/consistent
    await Model.findByIdAndUpdate(
      id,
      {
        $set: {
          isFlagged: false,
          flagReason: null,
          volFlaggedByCitizen: false,
          volFlagReason: null
        }
      }
    );

    if (notifyTarget && notifyMsg) {
      const notification = new Notification({
        recipient: notifyTarget,
        sender: req.userID,
        type: 'SYSTEM',
        message: notifyMsg,
        link: '/user-dashboard'
      });
      await notification.save();
    }

    res.status(200).json({ success: true, message: "Report unflagged and reporter notified." });
  } catch (error) {
    console.error("Unflag Report Error:", error);
    res.status(500).json({ message: "Server error during unflag operation" });
  }
}

export async function dismissHelp(req, res) {
  try {
    const { id, type } = req.body;
    let Model;
    if (type === 'food') Model = LeftoverFoodReport;
    else if (type === 'pollution') Model = Pollution;
    else Model = Pickup;

    await Model.findByIdAndUpdate(id, { helpRequested: false });
    res.status(200).json({ success: true, message: "Help session terminated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to dismiss request" });
  }
}

// ==========================================
// 9. AI CHATBOT OPERATIONS
// ==========================================








export async function chatWithGemini(req, res) {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ message: "Prompt is required" });
    }

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `You are the e-Karma Assistant. Strictly provide minimal, direct, and concise replies. 
No conversational filler, empathy, or excessive explanations. 

Platform Context:
1. Waste Pickups (Paid, via PayU).
2. Food Donations (Leftovers for those in need).
3. Pollution Reporting (Image/Map based reports).

Guidelines:
- Only answer e-Karma related queries. 
- For unrelated topics, say: "I only assist with e-Karma environmental services."
- For "how-to" questions, provide direct menu names: "Waste Pickup", "Food Sharing", or "Report Pollution".`
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const reply = completion.choices[0].message.content;

    res.json({
      response: reply
    });

  } catch (error) {
    console.error("Groq AI error:", error);
    res.status(500).json({ message: "AI service error" });
  }
}
