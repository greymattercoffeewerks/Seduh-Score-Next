// Test helpers for the feedback parts (core/feedback.js): press the open confirm panel's or dialog's own button, the
// way a person would, instead of stubbing window.confirm. Tests only; nothing in the app imports it.
export const feedbackButton = (role, root = document) =>
  root.querySelector(`[data-feedback-action="${role}"]`);

// role: 'confirm' | 'cancel'. Throws when nothing is open, so a test cannot "answer" a question that was never asked.
export function answerFeedback(role, root = document) {
  const button = feedbackButton(role, root);
  if (!button) throw new Error(`no open confirm panel or dialog with a ${role} button`);
  button.click();
}

export const openFeedbackText = (root = document) =>
  root.querySelector('.confirm-panel, dialog.dialog')?.textContent ?? null;

// For a test that does not care about the question: answer it when it was asked, do nothing when it was not (a
// refused gate asks nothing).
export function answerIfOpen(role, root = document) {
  feedbackButton(role, root)?.click();
}
