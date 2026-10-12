// Export with notice (D.4.1, C.5, S25): before the download a non-destructive dialog says that the file
// is unencrypted; only "JSON exportieren" in that dialog writes the file (services/transfer exportJson).
// Used by Einstellungen › Daten and the HEUTE card "Daten sichern".
import { confirmDialog } from '../components/ol-dialog.js';
import { showToast } from '../components/ol-toast.js';
import { t } from '../i18n/de.js';
import { exportJson } from '../services/transfer.js';

let running = false;

/**
 * Shows the plaintext notice; on confirmation exports and shows t.toastExported. `button` gets the
 * loading state only after the confirmation. Resolves true when the file was written, false when the
 * dialog was cancelled or the export failed (the error toast is shown here).
 */
export async function exportWithNotice(button?: HTMLElement): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    const confirmed = await confirmDialog({ title: t.exportConfirmTitle, body: t.exportPlaintextHint, confirmLabel: t.exportJson });
    if (!confirmed) return false;
    button?.setAttribute('loading', '');
    try {
      await exportJson();
    } catch (err) {
      console.error(err);
      showToast(t.toastError);
      return false;
    }
    showToast(t.toastExported);
    return true;
  } finally {
    button?.removeAttribute('loading');
    running = false;
  }
}
