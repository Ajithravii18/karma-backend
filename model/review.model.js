import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
    {
        reviewerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        revieweeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        requestId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        requestType: {
            type: String,
            enum: ["pickup", "pollution", "food"],
            required: true
        },
        rating: {
            type: Number,
            min: 0,
            max: 5,
            default: 0
        },
        comment: {
            type: String,
            default: ""
        },
        isReport: {
            type: Boolean,
            default: false
        },
        reportReason: {
            type: String,
            default: ""
        }
    },
    { timestamps: true }
);

export default mongoose.model("Review", reviewSchema);
