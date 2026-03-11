import mongoose from "mongoose";

export default async function connection() {
    const db = await mongoose.connect(process.env.MONGO_URI)
    console.log("database connected");
    return db
}