/**
 * Render template body text by replacing {{1}}, {{2}}, etc. with resolved parameter values.
 * Shared pure utility usable by both server (cron/webhooks) and client components.
 */
export function renderTemplateBody(body: string, params: string[]): string {
  if (!body) return '';
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}
