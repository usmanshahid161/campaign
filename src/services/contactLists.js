// services/contactLists.js
const { parse } = require('csv-parse/sync');
const ContactList = require('../models/contactList');
const ContactListEntry = require('../models/contactListEntry');

// Loose but real validation — strips spaces/dashes/parens, then requires
// a leading + and 8-15 digits (E.164's actual bounds). Rejecting garbage
// here is much cheaper than finding out from a failed Meta API call
// later, one row at a time, mid-campaign.
function normalizePhone(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[\s\-().]/g, '');
  const withPlus = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  return /^\+\d{8,15}$/.test(withPlus) ? withPlus : null;
}

async function listContactLists(tenantId) {
  return ContactList.find({ tenantId }).sort({ createdAt: -1 }).lean();
}

async function getContactList(tenantId, id) {
  const list = await ContactList.findOne({ _id: id, tenantId }).lean();
  if (!list) {
    const err = new Error('Contact list not found');
    err.statusCode = 404;
    throw err;
  }
  return list;
}

async function createContactList(tenantId, { name }, userId) {
  if (!name?.trim()) {
    const err = new Error('List name is required');
    err.statusCode = 422;
    throw err;
  }
  try {
    return await ContactList.create({ tenantId, name: name.trim(), createdBy: userId });
  } catch (err) {
    if (err.code === 11000) {
      const dupErr = new Error(`A list named "${name}" already exists`);
      dupErr.statusCode = 409;
      throw dupErr;
    }
    throw err;
  }
}

async function deleteContactList(tenantId, id) {
  const list = await ContactList.findOne({ _id: id, tenantId });
  if (!list) {
    const err = new Error('Contact list not found');
    err.statusCode = 404;
    throw err;
  }
  await ContactListEntry.deleteMany({ listId: id, tenantId });
  await ContactList.deleteOne({ _id: id, tenantId });
  return { deleted: true, id };
}

async function listEntries(tenantId, listId, { page = 1, limit = 50 } = {}) {
  await getContactList(tenantId, listId); // 404s if not found/wrong tenant

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    ContactListEntry.find({ listId, tenantId }).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    ContactListEntry.countDocuments({ listId, tenantId }),
  ]);
  return { items, total, page: Number(page), limit: Number(limit) };
}

// Manual add — one contact at a time, from the UI's "add manually" form.
async function addContact(tenantId, listId, { phone, variables, mediaUrl }) {
  await getContactList(tenantId, listId);

  const normalized = normalizePhone(phone);
  if (!normalized) {
    const err = new Error(`Invalid phone number: ${phone}`);
    err.statusCode = 422;
    throw err;
  }

  try {
    const entry = await ContactListEntry.create({
      listId,
      tenantId,
      phone: normalized,
      variables: variables || {},
      mediaUrl: mediaUrl || null,
    });
    await ContactList.updateOne({ _id: listId }, { $inc: { contactCount: 1 } });
    return entry.toObject();
  } catch (err) {
    if (err.code === 11000) {
      const dupErr = new Error(`${normalized} is already on this list`);
      dupErr.statusCode = 409;
      throw dupErr;
    }
    throw err;
  }
}

async function removeContact(tenantId, listId, entryId) {
  await getContactList(tenantId, listId);
  const result = await ContactListEntry.deleteOne({ _id: entryId, listId, tenantId });
  if (result.deletedCount) {
    await ContactList.updateOne({ _id: listId }, { $inc: { contactCount: -1 } });
  }
  return { deleted: Boolean(result.deletedCount), id: entryId };
}

// CSV bulk import. Expected columns: `phone` (required), `media_url`
// (optional — used later only if the campaign this list gets attached to
// is mediaMode: 'per_contact'), and anything else becomes a named
// template variable (e.g. a `name` column maps to {{1}} if the campaign's
// variableMapping says so — the mapping itself is chosen at
// campaign-creation time, not here, since the same list could be reused
// for different templates later).
async function importCsv(tenantId, listId, buffer) {
  await getContactList(tenantId, listId);

  let rows;
  try {
    rows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    const parseErr = new Error(`Could not parse CSV: ${err.message}`);
    parseErr.statusCode = 422;
    throw parseErr;
  }

  if (!rows.length) {
    const err = new Error('CSV file has no rows');
    err.statusCode = 422;
    throw err;
  }
  if (!('phone' in rows[0])) {
    const err = new Error('CSV must have a "phone" column');
    err.statusCode = 422;
    throw err;
  }

  const seenInFile = new Set();
  const errors = [];
  const toInsert = [];
  let duplicatesInFile = 0;

  rows.forEach((row, i) => {
    const normalized = normalizePhone(row.phone);
    if (!normalized) {
      errors.push({ row: i + 2, reason: `Invalid phone number: "${row.phone}"` }); // +2: header row + 1-index
      return;
    }
    if (seenInFile.has(normalized)) {
      duplicatesInFile += 1;
      return;
    }
    seenInFile.add(normalized);

    const { phone, media_url, ...rest } = row;
    toInsert.push({
      listId,
      tenantId,
      phone: normalized,
      variables: rest,
      mediaUrl: media_url || null,
    });
  });

  // Skip rows that collide with contacts already on this list (not just
  // within the file) — insertMany with ordered:false so one bad/duplicate
  // row doesn't abort the whole batch.
  let inserted = 0;
  let existingDuplicates = 0;
  if (toInsert.length) {
    try {
      const result = await ContactListEntry.insertMany(toInsert, { ordered: false });
      inserted = result.length;
    } catch (err) {
      // BulkWriteError — some succeeded, some hit the unique index
      // (listId+phone) because they were already on the list.
      inserted = err.insertedDocs?.length || err.result?.insertedCount || 0;
      existingDuplicates = toInsert.length - inserted;
    }
  }

  if (inserted) {
    await ContactList.updateOne({ _id: listId }, { $inc: { contactCount: inserted } });
  }

  return {
    totalRows: rows.length,
    imported: inserted,
    invalid: errors.length,
    duplicatesInFile,
    duplicatesAlreadyOnList: existingDuplicates,
    errors: errors.slice(0, 50), // cap — a malformed file shouldn't return thousands of error rows
  };
}

module.exports = {
  listContactLists,
  getContactList,
  createContactList,
  deleteContactList,
  listEntries,
  addContact,
  removeContact,
  importCsv,
  normalizePhone,
};
