// Note actions shared by the WISSEN list (swipe, long press) and the editor ⋯ (A.3 Notizkarte, W3):
// pin/unpin, archive, Markdown export of one note, delete. Every change offers Rückgängig in its toast;
// delete asks first (destructive dialog), like deleting a project.
import { confirmDialog } from '../components/ol-dialog.js';
import { showToast } from '../components/ol-toast.js';
import { t } from '../i18n/de.js';
import type { Note } from '../model.js';
import { deleteNote, restoreNote, setNoteArchived, setNotePinned } from '../repo/notes.js';
import { exportNotesMarkdown } from '../services/notes-export.js';
import { openActionMenu } from './sheets/task.js';

const failed = (): void => showToast(t.toastError);

export async function togglePin(note: Note): Promise<void> {
  const pinned = note.pinned !== 1;
  try {
    await setNotePinned(note.id, pinned);
    showToast(pinned ? t.toastNotePinned : t.toastNoteUnpinned, {
      action: { label: t.actionUndo, onAction: () => void setNotePinned(note.id, !pinned).catch(failed) },
    });
  } catch {
    failed();
  }
}

export async function archiveNote(note: Note): Promise<void> {
  try {
    await setNoteArchived(note.id, true);
    showToast(t.toastNoteArchived, {
      action: {
        label: t.actionUndo,
        onAction: () => void setNoteArchived(note.id, false).then(() => (note.pinned === 1 ? setNotePinned(note.id, true) : undefined)).catch(failed),
      },
    });
  } catch {
    failed();
  }
}

/** Asks, deletes, offers Rückgängig. Resolves to true when the note was deleted. */
export async function deleteNoteAsked(note: Note): Promise<boolean> {
  const ok = await confirmDialog({ title: t.actionConfirmDelete, body: t.confirmDeleteNote, confirmLabel: t.actionDelete, destructive: true });
  if (!ok) return false;
  try {
    const deleted = await deleteNote(note.id);
    if (!deleted) return false;
    showToast(t.toastNoteDeleted, { action: { label: t.actionUndo, onAction: () => void restoreNote(deleted).catch(failed) } });
    return true;
  } catch {
    failed();
    return false;
  }
}

/** ⋯ menu of a note (long press in the list). */
export function openNoteMenu(note: Note): void {
  openActionMenu(note.title || t.wissenUntitled, [
    { label: note.pinned === 1 ? t.noteUnpin : t.notePin, icon: note.pinned === 1 ? 'pin-off' : 'pin', run: () => void togglePin(note) },
    { label: t.noteArchive, icon: 'archive', run: () => void archiveNote(note) },
    { label: t.noteExportMarkdown, icon: 'download', run: () => void exportNotesMarkdown([note], note) },
    { label: t.actionDelete, icon: 'trash-2', danger: true, run: () => void deleteNoteAsked(note) },
  ]);
}
