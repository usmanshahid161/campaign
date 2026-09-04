// controllers/contactLists.js
const service = require('../services/contactLists');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

exports.list = asyncHandler(async (req, res) => {
  const lists = await service.listContactLists(req.user.tenantId);
  res.status(200).json({ success: true, data: lists });
});

exports.getOne = asyncHandler(async (req, res) => {
  const list = await service.getContactList(req.user.tenantId, req.params.id);
  res.status(200).json({ success: true, data: list });
});

exports.create = asyncHandler(async (req, res) => {
  const list = await service.createContactList(req.user.tenantId, req.body, req.user?.userId);
  res.status(201).json({ success: true, data: list });
});

exports.remove = asyncHandler(async (req, res) => {
  const result = await service.deleteContactList(req.user.tenantId, req.params.id);
  res.status(200).json({ success: true, data: result });
});

exports.listEntries = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const result = await service.listEntries(req.user.tenantId, req.params.id, { page, limit });
  res.status(200).json({ success: true, data: result });
});

exports.addContact = asyncHandler(async (req, res) => {
  const entry = await service.addContact(req.user.tenantId, req.params.id, req.body);
  res.status(201).json({ success: true, data: entry });
});

exports.removeContact = asyncHandler(async (req, res) => {
  const result = await service.removeContact(req.user.tenantId, req.params.id, req.params.entryId);
  res.status(200).json({ success: true, data: result });
});

exports.importCsv = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'CSV file is required' });
  }
  const result = await service.importCsv(req.user.tenantId, req.params.id, req.file.buffer);
  res.status(200).json({ success: true, data: result });
});
