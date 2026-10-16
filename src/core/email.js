// A plausible email, enough to catch a typo before a request. The server (Auth) decides what is deliverable.
// One definition for every screen that asks for an email address and wants to say so before a round trip.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmailShaped = (raw) => EMAIL_SHAPE.test(String(raw ?? '').trim());
