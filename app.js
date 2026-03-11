import "dotenv/config";
import express from "express";
import router from "./router.js";
import connection from "./connection.js";
import cors from "cors";


const app = express();

// 1. Standard JSON parser
app.use(express.json());

// 2. URL-encoded parser (Required for PayU Callback)
app.use(express.urlencoded({ extended: true }));

// 3. Updated CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
 
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (origin === 'null' || origin.includes('payu') || origin.includes('payumoney')) {
      callback(null, true); // Allow PayU callbacks
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// 4. Serve uploaded images
app.use("/uploads", express.static("uploads"));

// 5. Routes (Must come AFTER the parsers and CORS)
app.use("/", router);

const PORT = process.env.PORT || 5000;

connection()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`server started at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database connection failed:", error);
  });