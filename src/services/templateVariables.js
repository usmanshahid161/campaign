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

  return variables;
}

module.exports = { extractTemplateVariables };
