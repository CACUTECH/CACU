export async function getCollectionAccountsAction() { const response = await fetch('/test/collection-accounts'); if (!response.ok) throw new Error('Unavailable'); return response.json(); }
