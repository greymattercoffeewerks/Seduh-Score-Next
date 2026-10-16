// Copies text to the clipboard and says whether it worked. Never throws: a missing Clipboard API (an insecure page,
// an old browser: reading `writeText` off it throws), a permission refusal and a rejected write are all the same
// answer to the caller, "no". What to say about it (select it and copy it by hand) is the caller's words, not this
// module's.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
