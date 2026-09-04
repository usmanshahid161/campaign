// services/templateBuilder.js

function fillPlaceholders(text, variables, mapping) {
  if (!text) return text;
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const columnName = mapping?.[n];
    const value = columnName ? variables?.[columnName] : undefined;
    return value != null && value !== '' ? String(value) : `[${n}]`;
  });
}

function buildHeaderParameter(campaign, recipient) {
  const headerType = campaign.template.header?.type;
  if (!headerType || headerType === 'NONE') return null;

  if (headerType === 'TEXT') {
    const filled = fillPlaceholders(campaign.template.header.text, recipient.variables, campaign.variableMapping);
    // Only actually a "parameter" if the header text had a variable —
    // static header text needs no parameters block at all.
    const hasVariable = /\{\{\s*\d+\s*\}\}/.test(campaign.template.header.text || '');
    return hasVariable ? { type: 'header', parameters: [{ type: 'text', text: filled }] } : null;
  }

  // IMAGE / VIDEO / DOCUMENT — media resolved per campaign.mediaMode.
  // 'per_contact' with no mediaUrl on this specific recipient (e.g. an
  // incomplete CSV row) is a real, catchable failure, not silently
  // skipped — better to mark this one recipient FAILED than to send a
  // template Meta will reject anyway for a missing required header.
  const url = campaign.mediaMode === 'shared' ? campaign.sharedMediaUrl : recipient.mediaUrl;
  if (!url) {
    const err = new Error(`No media available for this recipient (mediaMode: ${campaign.mediaMode})`);
    err.code = 'MISSING_MEDIA';
    throw err;
  }

  const mediaType = headerType.toLowerCase(); // image | video | document
  return { type: 'header', parameters: [{ type: mediaType, [mediaType]: { link: url } }] };
}

function buildBodyParameter(campaign, recipient) {
  const vars = [...(campaign.template.body.text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1]);
  if (!vars.length) return null;

  const unique = [...new Set(vars)].sort((a, b) => Number(a) - Number(b));
  const parameters = unique.map((n) => {
    const columnName = campaign.variableMapping?.[n];
    const value = columnName ? recipient.variables?.[columnName] : undefined;
    return { type: 'text', text: value != null && value !== '' ? String(value) : `[${n}]` };
  });

  return { type: 'body', parameters };
}

// Returns { components, previewText } for one recipient — components go
// straight into the message center-service/local-service sends to Meta;
// previewText is the filled, human-readable text stored as the
// message's own text (shown in the thread, same as any other message).
function buildForRecipient(campaign, recipient) {
  const components = [];

  const headerParam = buildHeaderParameter(campaign, recipient);
  if (headerParam) components.push(headerParam);

  const bodyParam = buildBodyParameter(campaign, recipient);
  if (bodyParam) components.push(bodyParam);

  const headerText =
    campaign.template.header?.type === 'TEXT'
      ? fillPlaceholders(campaign.template.header.text, recipient.variables, campaign.variableMapping)
      : '';
  const bodyText = fillPlaceholders(campaign.template.body.text, recipient.variables, campaign.variableMapping);
  const previewText = headerText ? `${headerText}\n\n${bodyText}` : bodyText;

  return { components, previewText };
}

module.exports = { buildForRecipient };
