import pkg from "jsonwebtoken";
import User from "../model/user.model.js";
const { verify } = pkg;

export default async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    // 1️⃣ Check token exists
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. Please login first.",
      });
    }

    const token = authHeader.split(" ")[1];

    // 2️⃣ Verify token
    const decoded = verify(token, process.env.JWT_SECRET);

    // 3️⃣ Attach user and role to request
    const user = await User.findById(decoded.userID).select("-password");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found. Please login again.",
      });
    }

    req.user = user;
    req.userID = user._id;
    req.role = decoded.role; // 👈 CRITICAL: Attach role from token for Admin/Volunteer checks

    // 4️⃣ Check if account is frozen
    if (user.isFrozen) {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended by an administrator due to policy violations (e.g., false reporting). Please contact support.",
      });
    }

    next();

  } catch (error) {
    console.error("Auth Middleware Error:", error);
    return res.status(401).json({
      success: false,
      message: "Token expired or invalid. Please login again.",
    });
  }
}

// Add this helper at the bottom of auth.js or in a new file

export const isAdmin = (req, res, next) => {
  // Check if role is admin (from token or user object)
  const hasAdminRole = req.role === 'admin' || req.user?.role === 'admin';

  if (!hasAdminRole) {
    return res.status(403).json({
      success: false,
      message: "Access Denied: Admin privileges required."
    });
  }
  next();
};

export const isVolunteer = (req, res, next) => {
  if (req.role !== 'volunteer' && req.role !== 'admin') {
    return res.status(403).json({ message: "Only volunteers can perform this action." });
  }
  next();
};