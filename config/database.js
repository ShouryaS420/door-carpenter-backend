import mongoose from "mongoose";

export const connectDatabase = async () => {
    try {

        // const {connection} = await mongoose.connect(process.env.MONGO_URI);
        const {connection} = await mongoose
            .connect(process.env.MONGO_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            })
            .then(() => {
                console.log("✅ MongoDB connected");

                // only start server after connection is ready
                app.listen(PORT, () =>
                    console.log(`🚀 Server running on port ${PORT}`)
                );
            })
            .catch((err) => {
                console.error("❌ MongoDB connection error:", err.message);
                process.exit(1);
            });

        console.log(`MongoDB connected: ${connection.host}`);

    } catch (error) {
        console.log(error);
        process.exit(1);
    }
}