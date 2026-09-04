// services/templateBuilder.js

// Resolves one variable's actual value for one recipient — per_contact
// variables come from that recipient's own data (keyed by the
// variable's name, same name the contact list collected it under);
// shared variables already have their final value baked into the
// campaign itself (resolvedVariables/resolvedMedia — see campaign.js
// and services/campaigns.js, which fills in anything deferred at
// campaign-creation time).
function resolveVariableValue(entry, recipient) {
  if (entry.mode === 'per_contact') {
    return recipient.variables?.[entry.name];
  }
  return entry.value;
}

function resolveMediaUrl(campaign, recipient) {
  const media = campaign.resolvedMedia;
  if (!media?.mode) return null;
  return media.mode === 'per_contact' ? recipient.mediaUrl : media.sharedUrl;
}

function buildHeaderParameter(campaign, recipient) {
  const headerType = campaign.template.header?.type;
  if (!headerType || headerType === 'NONE') return null;

  if (headerType === 'TEXT') {
    const entry = campaign.resolvedVariables?.find((v) => v.component === 'header');
    if (!entry) return null; // static header text, no variable — no parameters block needed
    const value = resolveVariableValue(entry, recipient);
    return { type: 'header', parameters: [{ type: 'text', text: value != null && value !== '' ? String(value) : `[${entry.name}]` }] };
  }

  // IMAGE / VIDEO / DOCUMENT — 'per_contact' with no mediaUrl on this
  // specific recipient (e.g. an incomplete CSV row) is a real,
  // catchable failure, not silently skipped — better to mark this one
  // recipient FAILED than to send a template Meta will reject anyway
  // for a missing required header.
  const url = resolveMediaUrl(campaign, recipient);
  if (!url) {
    const err = new Error(`No media available for this recipient (mode: ${campaign.resolvedMedia?.mode})`);
    err.code = 'MISSING_MEDIA';
    throw err;
  }

  const mediaType = headerType.toLowerCase(); // image | video | document
  return { type: 'header', parameters: [{ type: mediaType, [mediaType]: { link: url } }] };
}

function buildBodyParameter(campaign, recipient) {
  const bodyEntries = (campaign.resolvedVariables || [])
    .filter((v) => v.component === 'body')
    .sort((a, b) => Number(a.position) - Number(b.position));

  if (!bodyEntries.length) return null;

  const parameters = bodyEntries.map((entry) => {
    const value = resolveVariableValue(entry, recipient);
    return { type: 'text', text: value != null && value !== '' ? String(value) : `[${entry.name}]` };
  });

  return { type: 'body', parameters };
}

function fillBodyPreview(campaign, recipient) {
  let text = campaign.template.body.text || '';
  (campaign.resolvedVariables || [])
    .filter((v) => v.component === 'body')
    .forEach((entry) => {
      const value = resolveVariableValue(entry, recipient);
      text = text.replace(
        new RegExp(`\\{\\{\\s*${entry.position}\\s*\\}\\}`, 'g'),
        value != null && value !== '' ? String(value) : `[${entry.name}]`
      );
    });
  return text;
}

function fillHeaderPreview(campaign, recipient) {
  if (campaign.template.header?.type !== 'TEXT') return '';
  const entry = campaign.resolvedVariables?.find((v) => v.component === 'header');
  let text = campaign.template.header.text || '';
  if (entry) {
    const value = resolveVariableValue(entry, recipient);
    text = text.replace(
      new RegExp(`\\{\\{\\s*${entry.position}\\s*\\}\\}`, 'g'),
      value != null && value !== '' ? String(value) : `[${entry.name}]`
    );
  }
  return text;
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

  const headerText = fillHeaderPreview(campaign, recipient);
  const bodyText = fillBodyPreview(campaign, recipient);
  const previewText = headerText ? `${headerText}\n\n${bodyText}` : bodyText;

  return { components, previewText };
}

module.exports = { buildForRecipient };
