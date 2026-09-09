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

// Card media flows through the exact same resolvedVariables entries as
// any text variable (see campaign-service's campaigns.js) — per_contact
// reads recipient.variables[name] same as a text var would, it just
// happens to be a URL. So this is really just resolveVariableValue with
// a cardIndex filter, not a separate resolution mechanism.
function resolveCardMediaEntry(campaign, cardIndex) {
  return (campaign.resolvedVariables || []).find((v) => v.component === 'card_media' && v.cardIndex === cardIndex);
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

// One component per dynamic URL button on the *main* template — Meta
// wants each one sent separately (type: 'button', with its own `index`
// identifying which button among the template's own buttons array),
// not bundled together the way header/body parameters are. Only the
// suffix value goes here, never the full URL — Meta reconstructs the
// complete URL server-side from the template's own approved pattern.
function buildButtonParameters(campaign, recipient) {
  return (campaign.resolvedVariables || [])
    .filter((v) => v.component === 'button')
    .map((entry) => {
      const value = resolveVariableValue(entry, recipient);
      return {
        type: 'button',
        sub_type: 'url',
        index: String(entry.buttonIndex),
        parameters: [{ type: 'text', text: value != null && value !== '' ? String(value) : '' }],
      };
    });
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

// One CAROUSEL component covering every card — each card resolves its
// own media + body text completely independently of the others (and of
// the main header/body above), matching how extractTemplateVariables
// tagged them in the first place: card N's {{1}} has nothing to do with
// card M's {{1}}.
function buildCarouselComponent(campaign, recipient) {
  const cards = campaign.template.carousel?.cards;
  if (!cards?.length) return null;

  return {
    type: 'carousel',
    cards: cards.map((card, cardIndex) => {
      const cardComponents = [];

      const mediaEntry = resolveCardMediaEntry(campaign, cardIndex);
      if (mediaEntry) {
        const url = resolveVariableValue(mediaEntry, recipient);
        if (!url) {
          const err = new Error(`No media available for card ${cardIndex + 1} (mode: ${mediaEntry.mode})`);
          err.code = 'MISSING_MEDIA';
          throw err;
        }
        const mediaType = card.header.type.toLowerCase(); // image | video
        cardComponents.push({ type: 'header', parameters: [{ type: mediaType, [mediaType]: { link: url } }] });
      }

      const bodyEntries = (campaign.resolvedVariables || [])
        .filter((v) => v.component === 'card_body' && v.cardIndex === cardIndex)
        .sort((a, b) => Number(a.position) - Number(b.position));
      if (bodyEntries.length) {
        cardComponents.push({
          type: 'body',
          parameters: bodyEntries.map((entry) => {
            const value = resolveVariableValue(entry, recipient);
            return { type: 'text', text: value != null && value !== '' ? String(value) : `[${entry.name}]` };
          }),
        });
      }

      // Same per-button component shape as the main template's own URL
      // buttons above — just scoped to this one card's buttons array,
      // via card_button entries' buttonIndex.
      const cardButtonEntries = (campaign.resolvedVariables || []).filter(
        (v) => v.component === 'card_button' && v.cardIndex === cardIndex
      );
      cardButtonEntries.forEach((entry) => {
        const value = resolveVariableValue(entry, recipient);
        cardComponents.push({
          type: 'button',
          sub_type: 'url',
          index: String(entry.buttonIndex),
          parameters: [{ type: 'text', text: value != null && value !== '' ? String(value) : '' }],
        });
      });

      return { card_index: cardIndex, components: cardComponents };
    }),
  };
}

// A short, readable one-line-per-card summary appended to the stored
// message text — not Meta's actual send format (that's
// buildCarouselComponent above), just what shows in the agent's inbox
// thread so the message isn't just the main body with no indication a
// carousel went out too.
function fillCarouselPreview(campaign, recipient) {
  const cards = campaign.template.carousel?.cards;
  if (!cards?.length) return '';

  return cards
    .map((card, cardIndex) => {
      let text = card.body?.text || '';
      (campaign.resolvedVariables || [])
        .filter((v) => v.component === 'card_body' && v.cardIndex === cardIndex)
        .forEach((entry) => {
          const value = resolveVariableValue(entry, recipient);
          text = text.replace(
            new RegExp(`\\{\\{\\s*${entry.position}\\s*\\}\\}`, 'g'),
            value != null && value !== '' ? String(value) : `[${entry.name}]`
          );
        });
      return `[Card ${cardIndex + 1}] ${text}`;
    })
    .join('\n');
}

// A clean, display-ready shape — separate from the sparse
// buildCarouselComponent above (which only includes what Meta actually
// needs sent, so static card body text/buttons are often just absent
// from it). This always has every card's resolved image/video URL and
// filled body text, plus the card's own (static) buttons, so
// center-service can store it as-is and the inbox thread can render a
// full carousel without reconstructing anything from Meta's sparse
// parameters or re-parsing the preview text.
function buildCarouselDisplay(campaign, recipient) {
  const cards = campaign.template.carousel?.cards;
  if (!cards?.length) return null;

  return cards.map((card, cardIndex) => {
    const mediaEntry = resolveCardMediaEntry(campaign, cardIndex);
    const imageUrl = mediaEntry ? resolveVariableValue(mediaEntry, recipient) : null;

    let bodyText = card.body?.text || '';
    (campaign.resolvedVariables || [])
      .filter((v) => v.component === 'card_body' && v.cardIndex === cardIndex)
      .forEach((entry) => {
        const value = resolveVariableValue(entry, recipient);
        bodyText = bodyText.replace(
          new RegExp(`\\{\\{\\s*${entry.position}\\s*\\}\\}`, 'g'),
          value != null && value !== '' ? String(value) : `[${entry.name}]`
        );
      });

    return {
      mediaType: card.header?.type || null,
      imageUrl: imageUrl || null,
      bodyText,
      // Buttons with a resolved value get their {{1}} filled in for
      // display (so the inbox thread shows the real link, not a
      // placeholder) — buttons with no dynamic part pass through as-is.
      buttons: (card.buttons || []).map((btn, buttonIndex) => {
        if (btn.type !== 'URL') return btn;
        const entry = (campaign.resolvedVariables || []).find(
          (v) => v.component === 'card_button' && v.cardIndex === cardIndex && v.buttonIndex === buttonIndex
        );
        if (!entry) return btn;
        const value = resolveVariableValue(entry, recipient);
        return { ...btn, url: btn.url.replace(new RegExp(`\\{\\{\\s*${entry.position}\\s*\\}\\}`, 'g'), value != null && value !== '' ? String(value) : '') };
      }),
    };
  });
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

  // Multiple separate button components if the template has more than
  // one dynamic URL button — Meta doesn't accept these bundled together
  // the way header/body parameters are.
  components.push(...buildButtonParameters(campaign, recipient));

  const carouselParam = buildCarouselComponent(campaign, recipient);
  if (carouselParam) components.push(carouselParam);

  const headerText = fillHeaderPreview(campaign, recipient);
  const bodyText = fillBodyPreview(campaign, recipient);
  const carouselPreview = fillCarouselPreview(campaign, recipient);
  const previewText = [headerText, bodyText, carouselPreview].filter(Boolean).join('\n\n');

  return { components, previewText, carouselCards: buildCarouselDisplay(campaign, recipient) };
}

module.exports = { buildForRecipient };
