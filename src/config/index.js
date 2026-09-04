require("dotenv").config();

module.exports = {

  PORT:
    process.env.PORT || 3038,

  MONGODB_URI:
  process.env.MONGODB_URI,

  RABBITMQ_URL:
  process.env.RABBITMQ_URL,

  RABBITMQ_EXCHANGE:
  process.env.RABBITMQ_EXCHANGE || 'campaigns.direct',

  CENTER_SERVICE_URL:
  process.env.CENTER_SERVICE_URL,

  ADMIN_SERVICE_URL:
  process.env.ADMIN_SERVICE_URL,

  // Shared secret for internal (non-UI) calls this service makes to
  // others, and that others make to it — must match INTERNAL_SERVICE_KEY
  // on every service exactly.
  INTERNAL_SERVICE_KEY:
  process.env.INTERNAL_SERVICE_KEY,

  AWS_REGION:
  process.env.AWS_REGION,

  AWS_ACCESS_KEY_ID:
  process.env.AWS_ACCESS_KEY_ID,

  AWS_SECRET_ACCESS_KEY:
  process.env.AWS_SECRET_ACCESS_KEY,

  AWS_S3_BUCKET:
  process.env.AWS_S3_BUCKET,

};
