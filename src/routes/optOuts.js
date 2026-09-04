const express = require('express');
const router = express.Router();
const controller = require('../controllers/campaigns');

router.get('/', controller.listOptOuts);
router.post('/', controller.addOptOut);
router.delete('/:phone', controller.removeOptOut);

module.exports = router;
