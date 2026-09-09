// services/templateVariables.js

function extractPositions(text) {
  const matches = [...(text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(matches)].sort((a, b) => Number(a) - Number(b));
}

// Returns [{ component: 'header'|'body', position: '1', name: 'customer_name' }]
// for every variable the template actually has — including media as a
// pseudo-entry (component: 'media') when the header is IMAGE/VIDEO/DOCUMENT,
// since that needs the exact same shared/per-contact treatment as a real
// {{n}} variable, just without a position number.
function extractTemplateVariables(template) {
  const variables = [];

  const headerType = template.components?.header?.type;
  if (headerType === 'TEXT') {
    const positions = extractPositions(template.components.header.text);
    if (positions.length) {
      variables.push({
        component: 'header',
        position: positions[0], // Meta allows at most one header variable
        name: template.components.header.variableName || `header_1`,
      });
    }
  } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) {
    variables.push({ component: 'media', position: null, name: 'media', mediaType: headerType });
  }

  const bodyPositions = extractPositions(template.components?.body?.text);
  bodyPositions.forEach((pos) => {
    variables.push({
      component: 'body',
      position: pos,
      name: template.components?.body?.variableNames?.[Number(pos) - 1] || `body_${pos}`,
    });
  });

  // A URL button can carry one dynamic {{1}} as a suffix on its URL
  // (Meta only supports it at the end, but this just looks for {{n}}
  // generically same as everywhere else — Meta's own template review
  // is what actually enforces the "must be a suffix" rule). buttonIndex
  // is the button's position among the main buttons array, since
  // templateBuilder.js needs to know exactly which button a resolved
  // value belongs to at send time.
  (template.components?.buttons || []).forEach((button, buttonIndex) => {
    if (button.type !== 'URL') return;
    extractPositions(button.url).forEach((pos) => {
      variables.push({
        component: 'button',
        buttonIndex,
        position: pos,
        name: button.variableName || `button_${buttonIndex + 1}_url`,
      });
    });
  });

  // Carousel cards each carry their own independent variables — a
  // card's {{1}} has nothing to do with the main body's {{1}}, or with
  // another card's {{1}}, so every entry is tagged with which card it
  // belongs to (cardIndex) as well as position, same shared/per-contact
  // treatment as everything else (see campaign-service's campaigns.js,
  // which resolves these the same way it resolves header/body/media).
  (template.carousel?.cards || []).forEach((card, cardIndex) => {
    if (['IMAGE', 'VIDEO'].includes(card.header?.type)) {
      variables.push({
        component: 'card_media',
        cardIndex,
        position: null,
        name: `card_${cardIndex + 1}_media`,
        mediaType: card.header.type,
      });
    }

    extractPositions(card.body?.text).forEach((pos) => {
      variables.push({
        component: 'card_body',
        cardIndex,
        position: pos,
        name: card.body?.variableNames?.[Number(pos) - 1] || `card_${cardIndex + 1}_body_${pos}`,
      });
    });

    (card.buttons || []).forEach((button, buttonIndex) => {
      if (button.type !== 'URL') return;
      extractPositions(button.url).forEach((pos) => {
        variables.push({
          component: 'card_button',
          cardIndex,
          buttonIndex,
          position: pos,
          name: button.variableName || `card_${cardIndex + 1}_button_${buttonIndex + 1}_url`,
        });
      });
    });
  });

  return variables;
}

module.exports = { extractTemplateVariables };
