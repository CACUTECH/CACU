export async function readCatalogAction(query: Record<string, unknown>) { const response = await fetch('/test/catalog?' + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))); return response.json(); }
export async function catalogOptionsAction() { return { categories: [], suppliers: [] }; }
export async function mutateCatalogAction(input: unknown) { try {
    const response = await fetch('/test/catalog-mutation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    return await response.json();
}
catch {
    return { success: false as const, error: 'Response unavailable. Retry the original request.', uncertain: true };
} }
export async function readWorkspaceAction(section: string, query: Record<string, unknown>) { const response = await fetch('/test/workspace/' + section + '?' + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))); return response.json(); }
export async function mutateWorkspaceAction(input: unknown) { try {
    const response = await fetch('/test/workspace-mutation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    return await response.json();
}
catch {
    return { success: false as const, error: 'Response unavailable. Retry the original request.', uncertain: true };
} }

export async function acceptInvitationAction() { throw new Error('Live acceptance is disabled in browser tests'); }
