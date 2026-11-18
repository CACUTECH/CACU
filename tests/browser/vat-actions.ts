// Browser test double for the tax settings server actions (E14 R3 VAT). Purchase and payment forms ask whether VAT or
// WHT applies; in these tests the business charges neither, so the forms look as they did before VAT.
const off = { success: true as const, data: { charging: false, standard_rate: null, wht_enabled: false } };
export async function vatStatusAction() { return off; }
export async function vatAction() { return { success: false as const, error: 'Not available in this test' }; }
export async function saveVatAction() { return { success: false as const, error: 'Not available in this test' }; }
export async function saveVatClassesAction() { return { success: false as const, error: 'Not available in this test' }; }
export async function vatReturnAction() { return { success: false as const, error: 'Not available in this test' }; }
export async function saveWhtCertificateAction() { return { success: false as const, error: 'Not available in this test' }; }
