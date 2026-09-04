const jwt = require('jsonwebtoken')
const fs = require('fs')
const path = require('path')
const multer = require('multer');

const publicKey = fs.readFileSync(
  path.join(__dirname, '../../keys/public.pem'),
  'utf8'
)

// Service-to-service calls never have a logged-in user, so they can't
// carry a Bearer JWT. They authenticate instead with this shared secret,
// sent as `x-internal-key`. Keep it out of git — set INTERNAL_SERVICE_KEY
// in .env on every service, matching.
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY

// The platform owner's portal — same shared-secret pattern as
// INTERNAL_SERVICE_KEY above, but yours alone. Must match SUPERADMIN_KEY
// in auth service's .env.
const SUPERADMIN_KEY = process.env.SUPERADMIN_KEY

const authMiddleware = (req, res, next) => {
  try {
    const internalKey = req.headers['x-internal-key']

    if (INTERNAL_SERVICE_KEY && internalKey === INTERNAL_SERVICE_KEY) {
      req.user = { role: 'SYSTEM', service: 'internal' }
      return next()
    }

    const superAdminKey = req.headers['x-superadmin-key']

    if (SUPERADMIN_KEY && superAdminKey === SUPERADMIN_KEY) {
      req.user = { role: 'SUPERADMIN' }
      return next()
    }

    const authHeader = req.headers.authorization

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token is required'
      })
    }

    const [type, token] = authHeader.split(' ')

    if (type !== 'Bearer' || !token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization format'
      })
    }

    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256']
    })

    req.user = decoded
    next()

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Access token expired'
      })
    }

    return res.status(401).json({
      success: false,
      message: 'Invalid access token'
    })
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB — generous for a CSV of numbers
});

module.exports = { authMiddleware, upload }
