const express = require('express');
const router = express.Router();
const controller = require('../controllers/contactLists');
const { upload } = require('../middleware/middleware');

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getOne);
router.put('/:id', controller.rename);
router.delete('/:id', controller.remove);

router.get('/:id/contacts', controller.listEntries);
router.post('/:id/contacts', controller.addContact);
router.put('/:id/contacts/:entryId', controller.updateContact);
router.delete('/:id/contacts/:entryId', controller.removeContact);

router.post('/:id/import', upload.single('file'), controller.importCsv);
router.get('/:id/coverage', controller.getCoverage);

module.exports = router;
