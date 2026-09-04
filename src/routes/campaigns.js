const express = require('express');
const router = express.Router();
const controller = require('../controllers/campaigns');
const routingController = require('../controllers/campaignRouting');

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getOne);
router.delete('/:id', controller.remove);

router.post('/:id/schedule', controller.schedule);
router.post('/:id/pause', controller.pause);
router.post('/:id/resume', controller.resume);
router.post('/:id/cancel', controller.cancel);

router.get('/:id/recipients', controller.listRecipients);
router.get('/:id/stats', controller.getStats);

// Internal-only — center-service calls this when a campaign message's
// delivery status changes. Reached via x-internal-key.
router.post('/status-sync', controller.statusSync);

// Internal-only — center-service calls this when reopening a closed
// campaign interaction after a reply. Reached via x-internal-key.
router.get('/:id/routing', routingController.getRouting);

module.exports = router;
