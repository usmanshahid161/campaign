const mongoose = require("mongoose");
const config = require("./index");

const connectMongoDB = async () => {
  await mongoose.connect(config.MONGODB_URI);
};

module.exports = { connectMongoDB };
