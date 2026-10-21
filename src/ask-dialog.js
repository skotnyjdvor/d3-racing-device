// Styled replacement for window.confirm/prompt. Resolves to true / the entered text, or null when cancelled.
export function createAskDialog(elements) {
  return function askDialog({ title, message = "", confirmLabel, danger = false, input = null }) {
    const dialog = elements.confirmDialog;
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmMessage.hidden = !message;
    elements.confirmSubmit.textContent = confirmLabel;
    elements.confirmSubmit.classList.toggle("danger", danger);
    elements.confirmField.hidden = !input;
    elements.confirmInput.type = input?.type ?? "text";
    elements.confirmInput.autocomplete = input?.type === "password" ? "current-password" : "off";
    elements.confirmInput.value = input?.value ?? "";
    elements.confirmFieldLabel.textContent = input?.label ?? "";
    return new Promise((resolve) => {
      const finish = (result) => {
        elements.confirmForm.removeEventListener("submit", onSubmit);
        elements.confirmCancel.removeEventListener("click", onCancel);
        dialog.removeEventListener("cancel", onCancel);
        dialog.removeEventListener("click", onBackdrop);
        if (dialog.open) dialog.close();
        resolve(result);
      };
      const onSubmit = (event) => {
        event.preventDefault();
        if (!input) return finish(true);
        const value = input.type === "password" ? elements.confirmInput.value : elements.confirmInput.value.trim();
        if (!value) { elements.confirmInput.focus(); return; }
        finish(value);
      };
      const onCancel = (event) => { event?.preventDefault?.(); finish(null); };
      const onBackdrop = (event) => { if (event.target === dialog) finish(null); };
      elements.confirmForm.addEventListener("submit", onSubmit);
      elements.confirmCancel.addEventListener("click", onCancel);
      dialog.addEventListener("cancel", onCancel);
      dialog.addEventListener("click", onBackdrop);
      dialog.showModal();
      if (input) { elements.confirmInput.focus(); elements.confirmInput.select(); }
      else (danger ? elements.confirmCancel : elements.confirmSubmit).focus();
    });
  }
}
