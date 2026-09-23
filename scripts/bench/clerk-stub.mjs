// Stand-ins for Next/Clerk server APIs so tRPC routers can run in a plain Node script.
export const auth = async () => ({ userId: null });
export const currentUser = async () => null;
export const clerkClient = async () => ({});
export default {};
