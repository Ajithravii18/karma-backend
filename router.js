import { Router } from "express";
import * as rh from "./requestHandler.js";
import authMiddleware, { isAdmin, isVolunteer } from "./Authentication/auth.js";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

// ==========================================
// 🔥 FIX: RESTORED MULTER CONFIGURATION
// ==========================================
const uploadDir = "uploads/";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ==========================================
// 1. PUBLIC ROUTES
// ==========================================
router.get("/", rh.displayuser);
router.get("/api/check-phone", rh.chekPhone);
router.post("/register", rh.adduser);
router.post("/login", rh.login);
router.post("/send-reset-otp", rh.sendResetOtp);
router.post("/reset-password", rh.resetPassword);
router.get("/api/food/public-feed", rh.getPublicFoodFeed);


// ==========================================
// 2. USER PROFILE & STATS
// ==========================================
router.get("/me", authMiddleware, rh.getUser);
router.get("/api/user-stats", authMiddleware, rh.getDashboardStats);
router.get("/api/my-pickups", authMiddleware, rh.getUserPickups);
router.get("/api/my-pollution", authMiddleware, rh.getUserPollution);
router.get("/api/my-food", authMiddleware, rh.getUserFood);
router.get("/api/user/my-activity", authMiddleware, rh.getUserActivity);

// ==========================================
// 3. SERVICE ACTIONS
// ==========================================
router.post("/schedule-pickup", authMiddleware, rh.createPickup);

// Pollution report using 'upload' variable defined above
router.post(
  "/report-pollution",
  authMiddleware,
  upload.array("photos", 4),
  rh.createPollutionReport
);

router.post("/report-leftover-food", authMiddleware, rh.reportLeftoverFood);
router.patch("/api/food/donor-confirm/:id", authMiddleware, rh.confirmFoodCollection);

// Delivery proof photo upload (saves to local /uploads)
router.post("/api/upload-delivery-photo", authMiddleware, upload.single("photo"), rh.uploadDeliveryPhoto);

// ==========================================
// 4. VOLUNTEER OPERATIONS
// ==========================================
router.get("/api/volunteer/tasks", authMiddleware, rh.getVolunteerTasks);
router.patch("/api/volunteer/confirm-arrival/:id", authMiddleware, isVolunteer, rh.confirmArrival);
router.patch("/api/food/volunteer-claim/:id", authMiddleware, rh.volunteerClaimFood);
router.patch("/api/food/volunteer-collected/:id", authMiddleware, isVolunteer, rh.markFoodCollected);
// Volunteer marks task as finished
router.patch("/api/volunteer/complete-collection/:id", authMiddleware, rh.completeCollection);
router.patch("/api/volunteer/claim-pickup/:id", authMiddleware, isVolunteer, rh.claimMission);
router.patch("/api/volunteer/unclaim-mission/:id", authMiddleware, isVolunteer, rh.unclaimMission);
router.patch("/api/food/complete/:id", authMiddleware, isVolunteer, rh.markFoodDelivered);

router.patch("/api/volunteer/claim-pollution/:id", authMiddleware, isVolunteer, rh.claimPollutionMission);
router.patch("/api/volunteer/unclaim-pollution/:id", authMiddleware, isVolunteer, rh.unclaimPollutionMission);
router.patch("/api/volunteer/resolve-pollution/:id", authMiddleware, isVolunteer, rh.resolvePollutionReport);
router.patch("/api/volunteer/flag-report/:type/:id", authMiddleware, isVolunteer, rh.flagReport);


// ==========================================
// 5. PAYMENT OPERATIONS
// ==========================================
router.post("/api/payment/payu-order", authMiddleware, rh.createPayUOrder);
router.post("/api/payment/payu-success", rh.handlePayUSuccess);
router.post("/api/payment/payu-failure", rh.handlePayUFailure);

// ==========================================
// 6. ADMIN OPERATIONS (🛡️ Role Protected)
// ==========================================
router.get("/api/admin/all-reports", authMiddleware, isAdmin, rh.getAllReports);
router.get("/api/admin/global-stats", authMiddleware, isAdmin, rh.getGlobalStats);
router.get("/api/admin/deletion-logs", authMiddleware, isAdmin, rh.getDeletionLogs);
router.delete("/api/admin/report/:type/:id", authMiddleware, isAdmin, rh.deleteReport);
router.post("/api/admin/promote-volunteer", authMiddleware, isAdmin, rh.promoteToVolunteer);
router.get("/api/admin/revenue", authMiddleware, isAdmin, rh.getRevenue);
router.put("/api/food/update/:id", authMiddleware, isAdmin, rh.updateFoodReport);
router.patch("/api/admin/update-role/:userId", authMiddleware, isAdmin, rh.updateUserRole);
router.get("/api/users", authMiddleware, isAdmin, rh.getAllUsers);
router.patch("/api/admin/pollution/status/:id", authMiddleware, isAdmin, rh.updatePollutionStatus);
// Add this line under your other Admin routes
router.get("/api/admin/report/:type/:id", authMiddleware, isAdmin, rh.getSingleReport);
router.patch("/api/admin/reset-mission/:id", authMiddleware, isAdmin, rh.adminResetMission);
router.patch("/api/admin/freeze-user/:id", authMiddleware, isAdmin, rh.toggleUserFreeze);
router.patch("/api/admin/unflag-report/:type/:id", authMiddleware, isAdmin, rh.unflagReport);
router.post("/api/admin/dismiss-help", authMiddleware, isAdmin, rh.dismissHelp);


// ==========================================

// 7. ACCOUNT MANAGEMENT

// ==========================================

// Add these to the "Requires Token" or "Account Management" section

router.put("/api/update-profile", authMiddleware, rh.updateProfile);

router.put("/api/change-password", authMiddleware, rh.changePassword);


// Phone Update (Firebase Backed)

router.get("/api/check-phone-availability", authMiddleware, rh.checkPhoneAvailability);

router.patch("/api/update-phone", authMiddleware, rh.updatePhoneDirect);



// Account Deletion (Firebase Backed)

router.delete("/api/delete-account", authMiddleware, rh.deleteAccountDirect);



// Add these to the "Requires Token" or "Account Management" section

router.get("/api/notifications", authMiddleware, rh.getNotifications);

router.patch("/api/notifications/read/:id", authMiddleware, rh.markNotificationAsRead);



// ==========================================

// 8. USER REPORTING OPERATIONS

// ==========================================

router.delete("/api/user/cancel-report/:type/:id", authMiddleware, rh.cancelUserReport);

router.patch("/api/user/flag-volunteer/:type/:id", authMiddleware, rh.flagVolunteer);
router.post("/api/user/submit-review", authMiddleware, rh.submitReview);
router.get("/api/volunteer/reviews/:volunteerId", rh.getVolunteerReviews);
router.post("/api/user/live-help", authMiddleware, rh.liveHelpRequest);



// ==========================================
// 9. AI CHATBOT OPERATIONS
// ==========================================

router.post("/api/chatbot/gemini", rh.chatWithGemini);



export default router;
