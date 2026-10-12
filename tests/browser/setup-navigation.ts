export function useRouter() { return { push: (route: string) => { window.setupRoute = route; } }; }
